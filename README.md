# Page Question AI Chrome Extension (Manifest V3, Groq)

Chrome extension that scans the current page for questions, sends context to Groq, and handles each question independently.

## Web Store readiness changes

To make this publishable in the Chrome Web Store, this version avoids remote code execution:
- It **does not** run AI-returned JavaScript via `eval`/`new Function`.
- For `answerType: "code"`, it copies the suggested snippet to clipboard (or shows it in-page) and logs it for manual review.

This aligns better with Chrome Web Store policies around remotely hosted/dynamic code behavior.

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
  - `{ questions: [{ text, answerType: "code"|"text", answer }] }`
- `text` answers → clipboard copy with floating panel fallback
- `code` answers → copy/log/display for manual execution
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
