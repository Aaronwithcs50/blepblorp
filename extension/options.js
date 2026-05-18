const modelEl = document.getElementById('model');
const apiKeyEl = document.getElementById('apiKey');
const autoNextEl = document.getElementById('autoNext');
const statusEl = document.getElementById('status');

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    groqModel: modelEl.value.trim(),
    groqApiKey: apiKeyEl.value.trim(),
    autoNext: autoNextEl.checked
  });
  statusEl.textContent = 'Saved.';
  setTimeout(() => (statusEl.textContent = ''), 1500);
});

(async function init() {
  const data = await chrome.storage.sync.get(['groqModel', 'groqApiKey', 'autoNext']);
  modelEl.value = data.groqModel || 'llama-3.3-70b-versatile';
  apiKeyEl.value = data.groqApiKey || '';
  autoNextEl.checked = Boolean(data.autoNext);
})();
