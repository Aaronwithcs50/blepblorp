# Page Question AI Chrome Extension (Manifest V3, Groq)

Chrome extension that scans the current page for questions, sends context and visible controls to Groq, and then uses an injected page automator to select matching answers and optionally advance to the next page.

## Web Store readiness changes

To make this publishable in the Chrome Web Store, this version avoids remote code execution:
- It **does not** run AI-returned JavaScript via `eval`/`new Function`.
- Groq returns visible answer labels only, and the extension runs its own packaged page automator with `chrome.scripting.executeScript`.
- The automator logs its actions to the page console, selects matching radio/checkbox/button/dropdown answers, fills nearby text inputs, and optionally clicks the next/continue button.

This aligns better with Chrome Web Store policies around remotely hosted/dynamic code behavior while still letting the extension perform the in-page clicks automatically.

## Groq integration

- Endpoint: `POST https://api.groq.com/openai/v1/chat/completions`
- Configurable model + API key in Options page.

References:
- https://console.groq.com/docs/overview
- https://console.groq.com/docs/api-reference

## Features

- Trigger via toolbar button or shortcut (`Ctrl+Shift+Y` / `Cmd+Shift+Y`)
- Scrapes visible text, lightweight DOM outline, and nearby code blocks
- Structured JSON contract from model:
  - `{ questions: [{ text, answer }] }`
- Uses one built-in respondent personality: reliable, attentive, consistent, calm, cooperative, detail-oriented, moderate, and believable
- Answers are applied by packaged extension code, not AI-generated JavaScript
- Matching answers → radio/checkbox/button/dropdown selection
- Free-text answers → nearby text field fill
- Overlay badge summarizing actions and counts
- Optional Auto-Next mode for survey flows (clicks likely next/continue button after answering)

## Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/`
4. Open extension options and set:
   - Groq model (default: `llama-3.3-70b-versatile`)
   - `GROQ_API_KEY`
   - (Optional) enable **Auto-Next mode**
