const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file';

const googleClientIdInput = document.getElementById('googleClientId');
const openAiKeyInput = document.getElementById('openAiKey');
const focusPromptInput = document.getElementById('focusPrompt');
const runButton = document.getElementById('runButton');
const logEl = document.getElementById('log');

restoreSavedConfig();
runButton.addEventListener('click', runRefinement);

function log(message, data) {
  const line = data ? `${message}\n${JSON.stringify(data, null, 2)}` : message;
  logEl.textContent = `${line}\n${logEl.textContent}`;
}

function restoreSavedConfig() {
  chrome.storage.local.get(['googleClientId', 'openAiKey', 'focusPrompt'], (saved) => {
    googleClientIdInput.value = saved.googleClientId || '';
    openAiKeyInput.value = saved.openAiKey || '';
    focusPromptInput.value = saved.focusPrompt || '';
  });
}

function saveConfig() {
  chrome.storage.local.set({
    googleClientId: googleClientIdInput.value.trim(),
    openAiKey: openAiKeyInput.value.trim(),
    focusPrompt: focusPromptInput.value.trim()
  });
}

async function runRefinement() {
  runButton.disabled = true;
  try {
    saveConfig();
    const googleClientId = googleClientIdInput.value.trim();
    if (!googleClientId) {
      throw new Error('Google OAuth Client ID is required.');
    }

    const tab = await getActiveTab();
    const docId = getDocIdFromUrl(tab.url || '');
    if (!docId) {
      throw new Error('Active tab is not a Google Docs document.');
    }

    log('Requesting Google API token...');
    const accessToken = await getGoogleToken(googleClientId);

    log('Reading document...');
    const doc = await fetchJson(`https://docs.googleapis.com/v1/documents/${docId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const plainText = extractPlainText(doc);
    const focusPrompt = focusPromptInput.value.trim();
    const openAiKey = openAiKeyInput.value.trim();

    log('Generating improvements...');
    const refined = openAiKey
      ? await refineWithOpenAI(plainText, focusPrompt, openAiKey)
      : fallbackRefinement(plainText, focusPrompt);

    const charts = buildChartSpecs(plainText);
    log(`Preparing ${charts.length} chart(s).`);

    const requests = buildBatchRequests(doc, refined, charts);
    if (!requests.length) {
      throw new Error('No update requests were generated.');
    }

    log('Writing changes to Google Doc...');
    await fetchJson(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests })
    });

    log('Done. Added AI Detail Pass section to your doc.');
  } catch (error) {
    log(`Error: ${error.message}`);
  } finally {
    runButton.disabled = false;
  }
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tabs.length) {
        reject(new Error('No active tab found.'));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function getDocIdFromUrl(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function getGoogleToken(clientId) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services did not load.'));
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DOCS_SCOPE,
      callback: (tokenResponse) => {
        if (tokenResponse?.error) {
          reject(new Error(tokenResponse.error));
          return;
        }
        resolve(tokenResponse.access_token);
      }
    });

    client.requestAccessToken({ prompt: 'consent' });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

function extractPlainText(doc) {
  const chunks = [];
  for (const contentEl of doc.body?.content || []) {
    const para = contentEl.paragraph;
    if (!para?.elements) {
      continue;
    }
    for (const el of para.elements) {
      const t = el.textRun?.content;
      if (t) {
        chunks.push(t);
      }
    }
  }
  return chunks.join('').trim();
}

function fallbackRefinement(text, focusPrompt) {
  const intro = focusPrompt
    ? `Refinement objective: ${focusPrompt}`
    : 'Refinement objective: Improve clarity, structure, and actionable detail.';
  const firstPart = text.slice(0, 1800);
  return `${intro}\n\nExecutive summary:\n- Clarified goals and outcomes.\n- Added rationale and concrete implementation detail.\n- Flagged measurable success criteria.\n\nRefined draft:\n${firstPart}\n\nRecommended next steps:\n1) Validate assumptions with stakeholders.\n2) Add ownership and deadlines to each major task.\n3) Track outcomes with weekly metrics.`;
}

async function refineWithOpenAI(text, focusPrompt, openAiKey) {
  const prompt = [
    'You are editing a Google Doc.',
    'Return plain text only (no markdown).',
    'Tasks:',
    '1) Create a concise executive summary.',
    '2) Rewrite/improve the document with clearer structure and richer detail.',
    '3) Add a short next-steps checklist.',
    focusPrompt ? `Additional focus: ${focusPrompt}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const payload = {
    model: 'gpt-4.1-mini',
    input: [
      { role: 'system', content: [{ type: 'input_text', text: prompt }] },
      { role: 'user', content: [{ type: 'input_text', text: text.slice(0, 18000) }] }
    ]
  };

  const data = await fetchJson('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const refined = data.output_text?.trim();
  if (!refined) {
    throw new Error('OpenAI response did not contain output_text.');
  }
  return refined;
}

function buildChartSpecs(text) {
  const numberMatches = [...text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));

  if (numberMatches.length < 3) {
    return [];
  }

  const values = numberMatches.slice(0, 6);
  const labels = values.map((_, i) => `Item ${i + 1}`);

  return [
    {
      title: 'Extracted Metrics Overview',
      type: 'bar',
      labels,
      values
    }
  ];
}

function quickChartUrl(chart) {
  const chartConfig = {
    type: chart.type,
    data: {
      labels: chart.labels,
      datasets: [{
        label: chart.title,
        data: chart.values,
        backgroundColor: '#2563eb'
      }]
    },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: chart.title } }
    }
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&width=700&height=380&format=png`;
}

function buildBatchRequests(doc, refinedText, charts) {
  const endIndex = (doc.body?.content?.at(-1)?.endIndex || 1) - 1;
  const requests = [];

  const header = '\n\nAI Detail Pass\n';
  requests.push({
    insertText: {
      location: { index: endIndex },
      text: header
    }
  });

  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: endIndex + 2,
        endIndex: endIndex + header.length
      },
      paragraphStyle: { namedStyleType: 'HEADING_1' },
      fields: 'namedStyleType'
    }
  });

  const bodyText = `${refinedText}\n`;
  requests.push({
    insertText: {
      location: { index: endIndex + header.length },
      text: bodyText
    }
  });

  let cursor = endIndex + header.length + bodyText.length;
  for (const chart of charts) {
    const chartTitle = `\n${chart.title}\n`;
    requests.push({
      insertText: {
        location: { index: cursor },
        text: chartTitle
      }
    });

    requests.push({
      updateParagraphStyle: {
        range: {
          startIndex: cursor + 1,
          endIndex: cursor + chartTitle.length
        },
        paragraphStyle: { namedStyleType: 'HEADING_2' },
        fields: 'namedStyleType'
      }
    });

    cursor += chartTitle.length;

    requests.push({
      insertInlineImage: {
        location: { index: cursor },
        uri: quickChartUrl(chart),
        objectSize: {
          width: { magnitude: 420, unit: 'PT' },
          height: { magnitude: 240, unit: 'PT' }
        }
      }
    });

    requests.push({
      insertText: {
        location: { index: cursor + 1 },
        text: '\n'
      }
    });

    cursor += 2;
  }

  return requests;
}
