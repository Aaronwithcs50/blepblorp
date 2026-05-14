function collectPagePayload() {
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'SCAN_PAGE') return;
  sendResponse({ ok: true, payload: collectPagePayload() });
});

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
