# Page Question AI Chrome Extension (Manifest V3, Groq)

Chrome extension that scans the current page for questions, sends the page context to Groq, and performs one action per detected question:
- execute JavaScript in-page for code answers
- copy plain-text answers to clipboard (with on-page fallback if denied)

## Groq integration

This extension uses Groq's OpenAI-compatible Chat Completions endpoint:
- Base path: `https://api.groq.com/openai/v1`
- Endpoint used: `POST /chat/completions`

Reference: https://console.groq.com/docs and https://console.groq.com/docs/api-reference

## Features

- Trigger via toolbar button or shortcut (`Ctrl+Shift+Y` / `Cmd+Shift+Y`)
- Content script scrapes:
  - visible text
  - DOM outline
  - surrounding code context (`pre`, `code`)
- Background service worker calls Groq (API key stored in `chrome.storage.sync`)
- Strict structured model output contract:
  - `{ questions: [{ text, answerType: "code"|"text", answer }] }`
- Per-question independent processing + sequential queue behavior
- Clipboard fallback panel if write permission is denied
- On-page overlay with question count and actions taken

## Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/`
4. Open extension options and set:
   - Groq model (default: `llama-3.3-70b-versatile`)
   - `GROQ_API_KEY`

## Security note

AI-provided JavaScript is executed in the page context for `answerType: "code"`.
Use cautiously and only on trusted pages.
