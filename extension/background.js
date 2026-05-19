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
  try {
    const [{ result: pagePayload }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectPagePayload
    });

    if (!pagePayload?.visibleText) {
      await tryShowError(tabId, 'No visible page content found to analyze.');
      return;
    }

    const settings = await chrome.storage.sync.get(['autoNext']);
    const aiResult = await requestGroq(pagePayload);
    const questions = Array.isArray(aiResult?.questions) ? aiResult.questions : [];
    const outcomes = [];

    for (const q of questions) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        args: [q],
        func: answerQuestionOnPage
      });

      outcomes.push({
        text: q.text || q.question || q.prompt || 'Question',
        action: result?.action || 'not-found',
        detail: result?.detail || ''
      });
    }

    const [{ result: nextClicked }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [Boolean(settings.autoNext)],
      func: clickNextButton
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      args: [outcomes, Boolean(nextClicked)],
      func: showRunSummary
    });
  } catch (error) {
    console.error('[AI Answer] Run failed:', error);
    const message = error?.message || String(error) || 'Unknown error';
    await tryShowError(tabId, message);
  }
}

async function tryShowError(tabId, message) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [String(message || 'Unknown error')],
      func: showRunError
    });
  } catch {
    // Ignore pages where injection is blocked (e.g., chrome:// URLs).
  }
}

function collectPagePayload() {
  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getVisibleText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const out = [];
    let node;
    while ((node = walker.nextNode())) out.push(node.nodeValue.trim());
    return out.join('\n');
  }

  function controlLabel(el) {
    const labels = [];
    if (el.id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLabel?.innerText) labels.push(explicitLabel.innerText.trim());
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel?.innerText) labels.push(wrappingLabel.innerText.trim());
    if (el.getAttribute('aria-label')) labels.push(el.getAttribute('aria-label').trim());
    if (el.getAttribute('placeholder')) labels.push(el.getAttribute('placeholder').trim());
    if (el.value && !['radio', 'checkbox'].includes(el.type)) labels.push(el.value.trim());
    if (el.innerText) labels.push(el.innerText.trim());
    return [...new Set(labels.filter(Boolean))].join(' ').slice(0, 240);
  }

  const visibleText = getVisibleText(document.body).slice(0, 80000);
  const codeBlocks = [...document.querySelectorAll('pre, code')]
    .map((el) => el.innerText.trim())
    .filter(Boolean)
    .slice(0, 40);

  const domOutline = [...document.querySelectorAll('h1,h2,h3,p,li,pre,code,button,label,legend')]
    .filter(isVisible)
    .slice(0, 400)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || '').trim().slice(0, 240)
    }));

  const controls = [...document.querySelectorAll('input, textarea, select, button, [role="radio"], [role="checkbox"], [role="button"], [role="option"]')]
    .filter(isVisible)
    .slice(0, 500)
    .map((el, index) => ({
      index,
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || el.getAttribute('role') || '').toLowerCase(),
      name: (el.getAttribute('name') || '').slice(0, 120),
      id: (el.id || '').slice(0, 120),
      label: controlLabel(el),
      checked: Boolean(el.checked),
      options: el.tagName === 'SELECT'
        ? [...el.options].map((option) => option.text.trim()).filter(Boolean).slice(0, 80)
        : []
    }));

  return {
    title: document.title,
    url: location.href,
    visibleText,
    domOutline,
    controls,
    codeContext: codeBlocks
  };
}

function answerQuestionOnPage(question) {
  const wanted = normalizeText(question.answer || question.selectedOption || question.option || '');
  const questionText = normalizeText(question.text || question.question || question.prompt || '');
  console.log('[AI Answer] Running page automator for:', { question, wanted });

  if (!wanted) return { action: 'missing-answer', detail: 'AI returned no answer text.' };

  const exactResult = clickMatchingChoice(wanted);
  if (exactResult) return exactResult;

  const selectResult = chooseMatchingSelectOption(wanted);
  if (selectResult) return selectResult;

  const nearbyResult = fillNearbyInput(questionText, question.answer || question.selectedOption || question.option || '');
  if (nearbyResult) return nearbyResult;

  return { action: 'not-found', detail: `No visible control matched "${wanted}".` };

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textFor(el) {
    const parts = [];
    if (el.id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLabel?.innerText) parts.push(explicitLabel.innerText);
    }
    const label = el.closest('label');
    if (label?.innerText) parts.push(label.innerText);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const labelledByEl = document.getElementById(id);
        if (labelledByEl?.innerText) parts.push(labelledByEl.innerText);
      });
    }
    ['aria-label', 'value', 'placeholder', 'title'].forEach((attr) => {
      const value = el.getAttribute(attr);
      if (value) parts.push(value);
    });
    if (el.innerText) parts.push(el.innerText);
    return normalizeText([...new Set(parts.filter(Boolean))].join(' '));
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clickElement(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus?.();
    el.click();
  }

  function scoreText(text) {
    if (!text) return 0;
    if (text === wanted) return 100;
    if (text.includes(wanted)) return 85;
    if (wanted.includes(text) && text.length >= 2) return 65;
    return 0;
  }

  function clickMatchingChoice(answerText) {
    const candidates = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], button, [role="radio"], [role="checkbox"], [role="option"], [role="button"]')]
      .filter((el) => isVisible(el) && !el.disabled)
      .map((el) => ({ el, label: textFor(el), score: scoreText(textFor(el)) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) return null;
    clickElement(candidates[0].el);
    return { action: 'selected', detail: candidates[0].label || answerText };
  }

  function chooseMatchingSelectOption(answerText) {
    for (const select of [...document.querySelectorAll('select')].filter(isVisible)) {
      const option = [...select.options].find((item) => {
        const text = normalizeText(item.text || item.label || item.value);
        return text === answerText || text.includes(answerText) || answerText.includes(text);
      });
      if (!option) continue;
      select.value = option.value;
      dispatchInputEvents(select);
      return { action: 'selected', detail: option.text || option.value };
    }
    return null;
  }

  function fillNearbyInput(promptText, answerText) {
    const fields = [...document.querySelectorAll('textarea, input:not([type]), input[type="text"], input[type="email"], input[type="number"], input[type="search"], input[type="tel"], input[type="url"]')]
      .filter((el) => isVisible(el) && !el.disabled && !el.readOnly);

    if (!fields.length) return null;

    const scored = fields
      .map((el) => {
        const container = el.closest('label, fieldset, form, section, article, div') || el.parentElement;
        const context = normalizeText(`${textFor(el)} ${container?.innerText || ''}`);
        let score = 1;
        if (promptText && context.includes(promptText.slice(0, 80))) score += 20;
        if (!el.value) score += 5;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score);

    const field = scored[0].el;
    field.scrollIntoView({ block: 'center', inline: 'center' });
    field.focus();
    field.value = answerText;
    dispatchInputEvents(field);
    return { action: 'filled', detail: String(answerText).slice(0, 120) };
  }
}

function clickNextButton(autoNextEnabled) {
  if (!autoNextEnabled) return false;
  const candidates = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button]'));
  const ranked = candidates
    .filter((el) => !el.disabled && el.offsetParent !== null)
    .map((el) => {
      const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
      let score = 0;
      if (/^next$/.test(label)) score = 100;
      else if (/^(continue|proceed|submit|finish|done)$/.test(label)) score = 90;
      else if (/(next|continue|proceed|submit|finish|done)/.test(label)) score = 80;
      else if (/(start|go)/.test(label)) score = 40;
      return { el, label, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return false;
  console.log('[AI Answer] Auto-Next clicking:', ranked[0].label, ranked[0].el);
  ranked[0].el.scrollIntoView({ block: 'center', inline: 'center' });
  ranked[0].el.click();
  return true;
}

function showRunSummary(results, didAutoNext) {
  const old = document.getElementById('__aiq_overlay');
  if (old) old.remove();
  const badge = document.createElement('div');
  badge.id = '__aiq_overlay';
  badge.style.cssText = 'position:fixed;top:12px;right:12px;background:#0f172a;color:#fff;padding:10px 12px;border-radius:10px;z-index:2147483647;font:12px/1.4 sans-serif;max-width:420px;white-space:pre-wrap;';
  const items = results.map((r, i) => `${i + 1}. ${r.action}${r.detail ? ` (${r.detail})` : ''} — ${r.text}`).join('\n');
  const nextLine = didAutoNext ? '\nAuto-Next: clicked' : '';
  badge.textContent = `Questions found: ${results.length}\n${items || 'No actions taken.'}${nextLine}`;
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 12000);
}

function showRunError(message) {
  const old = document.getElementById('__aiq_overlay');
  if (old) old.remove();
  const badge = document.createElement('div');
  badge.id = '__aiq_overlay';
  badge.style.cssText = 'position:fixed;top:12px;right:12px;background:#7f1d1d;color:#fff;padding:10px 12px;border-radius:10px;z-index:2147483647;font:12px/1.4 sans-serif;max-width:420px;white-space:pre-wrap;';
  badge.textContent = `AI run failed:\n${message}`;
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 12000);
}

async function requestGroq(pagePayload) {
  const settings = await chrome.storage.sync.get(['groqApiKey', 'groqModel']);
  const apiKey = settings.groqApiKey;
  const model = settings.groqModel || DEFAULT_MODEL;
  if (!apiKey) throw new Error('Missing GROQ API key. Set it in extension options.');

  const systemPrompt = `You detect questions from webpage context and choose the best visible answer for the page automator to select. Return strict JSON only in the shape {"questions":[{"text":"...","answer":"..."}]}.

Use exactly one consistent respondent personality: a reliable, attentive, consistent, calm, reasonable, cooperative, detail-oriented person with moderate and believable opinions. Prefer internally consistent, realistic answers, avoid contradictions, avoid extreme or impossible claims, and read attention checks carefully. If a question asks for demographics or factual identity details, answer truthfully from the available page/context rather than inventing a fake identity.

Important automation rule: the "answer" value should be the exact visible option label to click whenever the page has radio buttons, checkboxes, dropdown options, or buttons. For free-text fields, provide the concise text to enter. Do not return JavaScript code.`;

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
