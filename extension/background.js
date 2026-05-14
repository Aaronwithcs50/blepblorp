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
  const scan = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_PAGE' }).catch(() => null);
  const pagePayload = scan?.payload;
  if (!pagePayload?.visibleText) return;

  const aiResult = await requestGroq(pagePayload);
  const questions = Array.isArray(aiResult?.questions) ? aiResult.questions : [];
  const outcomes = [];

  for (const q of questions) {
    if (q.answerType === 'code') {
      await chrome.scripting.executeScript({
        target: { tabId },
        args: [q.answer],
        func: (code) => {
          try {
            // eslint-disable-next-line no-new-func
            const runner = new Function(code);
            const output = runner();
            console.log('[AI Answer][code] Executed snippet result:', output);
          } catch (error) {
            console.error('[AI Answer][code] Failed to execute snippet:', error);
          }
        }
      });
      outcomes.push({ text: q.text, action: 'code-executed' });
      continue;
    }

    const [{ result: copyStatus }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [q.answer],
      func: async (textAnswer) => {
        try {
          await navigator.clipboard.writeText(textAnswer);
          return { copied: true };
        } catch {
          return { copied: false };
        }
      }
    });

    if (!copyStatus?.copied) {
      await chrome.scripting.executeScript({
        target: { tabId },
        args: [q.answer],
        func: (textAnswer) => {
          const panel = document.createElement('div');
          panel.style.cssText = 'position:fixed;bottom:12px;right:12px;max-width:360px;background:#111;color:#fff;padding:10px;border-radius:8px;z-index:2147483647;font:12px/1.4 sans-serif;white-space:pre-wrap;';
          panel.textContent = `Clipboard denied. Answer:\n${textAnswer}`;
          document.body.appendChild(panel);
          setTimeout(() => panel.remove(), 10000);
        }
      });
      outcomes.push({ text: q.text, action: 'panel-fallback' });
    } else {
      outcomes.push({ text: q.text, action: 'copied' });
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    args: [outcomes],
    func: (results) => {
      const old = document.getElementById('__aiq_overlay');
      if (old) old.remove();
      const badge = document.createElement('div');
      badge.id = '__aiq_overlay';
      badge.style.cssText = 'position:fixed;top:12px;right:12px;background:#0f172a;color:#fff;padding:10px 12px;border-radius:10px;z-index:2147483647;font:12px/1.4 sans-serif;max-width:420px;white-space:pre-wrap;';
      const items = results.map((r, i) => `${i + 1}. ${r.action} — ${r.text}`).join('\n');
      badge.textContent = `Questions found: ${results.length}\n${items || 'No actions taken.'}`;
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

  const systemPrompt = 'You detect questions from webpage context and answer them. Return strict JSON only in the shape {"questions":[{"text":"...","answerType":"code"|"text","answer":"..."}]}. For answerType code, answer must be runnable JavaScript only. For answerType text, provide plain text.';
  const userPrompt = JSON.stringify(pagePayload);

  const res = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq request failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{"questions":[]}');
}
