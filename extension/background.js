const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) await runFlow(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'run-page-ai') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await runFlow(tab.id);
});

async function runFlow(tabId) {
  const [{ result: pagePayload }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      function getVisibleText(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
            if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });

        const out = [];
        let node;
        while ((node = walker.nextNode())) out.push(node.nodeValue.trim());
        return out.join('\n');
      }

      const visibleText = getVisibleText(document.body).slice(0, 80000);
      const codeBlocks = [...document.querySelectorAll('pre, code')]
        .map((el) => el.innerText.trim())
        .filter(Boolean)
        .slice(0, 40);

      const domOutline = [...document.querySelectorAll('h1,h2,h3,p,li,pre,code,button,label')]
        .slice(0, 400)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').trim().slice(0, 240)
        }));

      return {
        title: document.title,
        url: location.href,
        visibleText,
        domOutline,
        codeContext: codeBlocks
      };
    }
  });

  if (!pagePayload?.visibleText) return;

  const settings = await chrome.storage.sync.get(['autoNext']);
  const aiResult = await requestGroq(pagePayload);
  const questions = Array.isArray(aiResult?.questions) ? aiResult.questions : [];
  const outcomes = [];

  for (const q of questions) {
    if (q.answerType === 'code') {
      const snippet = String(q.answer || '').trim();
      const [{ result: copyStatus }] = await chrome.scripting.executeScript({
        target: { tabId },
        args: [snippet],
        func: async (codeSnippet) => {
          try {
            await navigator.clipboard.writeText(codeSnippet);
            return { copied: true };
          } catch {
            return { copied: false };
          }
        }
      });

      await chrome.scripting.executeScript({
        target: { tabId },
        args: [snippet, !!copyStatus?.copied],
        func: (codeSnippet, copied) => {
          console.log('[AI Answer][code] Suggested JavaScript snippet:\n', codeSnippet);
          const panel = document.createElement('div');
          panel.style.cssText = 'position:fixed;bottom:12px;right:12px;max-width:420px;background:#111;color:#fff;padding:10px;border-radius:8px;z-index:2147483647;font:12px/1.4 sans-serif;white-space:pre-wrap;';
          panel.textContent = copied
            ? 'Code answer copied to clipboard and logged to console. Review before running manually.'
            : `Code answer (manual copy needed):\n${codeSnippet}`;
          document.body.appendChild(panel);
          setTimeout(() => panel.remove(), 11000);
        }
      });

      outcomes.push({ text: q.text, action: copyStatus?.copied ? 'code-copied' : 'code-panel-fallback' });
      continue;
    }

    const textAnswer = String(q.answer || '').trim();
    const [{ result: copyStatus }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [textAnswer],
      func: async (answerText) => {
        try {
          await navigator.clipboard.writeText(answerText);
          return { copied: true };
        } catch {
          return { copied: false };
        }
      }
    });

    if (!copyStatus?.copied) {
      await chrome.scripting.executeScript({
        target: { tabId },
        args: [textAnswer],
        func: (answerText) => {
          const panel = document.createElement('div');
          panel.style.cssText = 'position:fixed;bottom:12px;right:12px;max-width:360px;background:#111;color:#fff;padding:10px;border-radius:8px;z-index:2147483647;font:12px/1.4 sans-serif;white-space:pre-wrap;';
          panel.textContent = `Clipboard denied. Answer:\n${answerText}`;
          document.body.appendChild(panel);
          setTimeout(() => panel.remove(), 10000);
        }
      });
      outcomes.push({ text: q.text, action: 'panel-fallback' });
    } else {
      outcomes.push({ text: q.text, action: 'copied' });
    }
  }

  const [{ result: nextClicked }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [Boolean(settings.autoNext)],
    func: (autoNextEnabled) => {
      if (!autoNextEnabled) return false;
      const candidates = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button]'));
      const ranked = candidates
        .filter((el) => !el.disabled && el.offsetParent !== null)
        .map((el) => {
          const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
          let score = 0;
          if (/^next$/.test(label)) score = 100;
          else if (/(next|continue|proceed|submit|finish|done)/.test(label)) score = 80;
          else if (/(start|go)/.test(label)) score = 40;
          return { el, label, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (!ranked.length) return false;
      ranked[0].el.click();
      return true;
    }
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    args: [outcomes, Boolean(nextClicked)],
    func: (results, didAutoNext) => {
      const old = document.getElementById('__aiq_overlay');
      if (old) old.remove();
      const badge = document.createElement('div');
      badge.id = '__aiq_overlay';
      badge.style.cssText = 'position:fixed;top:12px;right:12px;background:#0f172a;color:#fff;padding:10px 12px;border-radius:10px;z-index:2147483647;font:12px/1.4 sans-serif;max-width:420px;white-space:pre-wrap;';
      const items = results.map((r, i) => `${i + 1}. ${r.action} — ${r.text}`).join('\n');
      const nextLine = didAutoNext ? '\nAuto-Next: clicked' : '';
      badge.textContent = `Questions found: ${results.length}\n${items || 'No actions taken.'}${nextLine}`;
      document.body.appendChild(badge);
      setTimeout(() => badge.remove(), 12000);
    }
  });
}

async function requestGroq(pagePayload) {
  const settings = await chrome.storage.sync.get(['groqApiKey', 'groqModel']);
  const apiKey = settings.groqApiKey;
  const model = settings.groqModel || DEFAULT_MODEL;
  if (!apiKey) throw new Error('Missing GROQ API key. Set it in extension options.');

  const systemPrompt = 'You detect questions from webpage context and answer them. Return strict JSON only in the shape {"questions":[{"text":"...","answerType":"code"|"text","answer":"..."}]}. For answerType code, provide a JavaScript snippet as plain text for manual review. For answerType text, provide plain text.';

  const res = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(pagePayload) }
      ]
    })
  });

  if (!res.ok) throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{"questions":[]}');
}
