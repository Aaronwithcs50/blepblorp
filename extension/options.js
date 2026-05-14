const modelEl = document.getElementById('model');
const apiKeyEl = document.getElementById('apiKey');
const statusEl = document.getElementById('status');

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    groqModel: modelEl.value.trim(),
    groqApiKey: apiKeyEl.value.trim()
  });
  statusEl.textContent = 'Saved.';
  setTimeout(() => (statusEl.textContent = ''), 1500);
});

(async function init() {
  const data = await chrome.storage.sync.get(['groqModel', 'groqApiKey']);
  modelEl.value = data.groqModel || 'llama-3.3-70b-versatile';
  apiKeyEl.value = data.groqApiKey || '';
})();
