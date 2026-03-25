# Docs Detail Refiner (Chrome Extension)

A browser extension that works on the current Google Doc tab and appends an **AI Detail Pass** section with:

- A refined and expanded rewrite of the document.
- Action-oriented next steps.
- Auto-generated chart images (when numeric values are found in the source text).

## What this does

1. Detects the active Google Doc (`docs.google.com/document/d/...`).
2. Requests a Google OAuth token in-browser (you provide your own OAuth Client ID).
3. Reads the current document through the Google Docs API.
4. Refines the text:
   - With OpenAI (if API key provided), or
   - With a built-in fallback refinement template.
5. Appends the generated output to the end of the document.
6. Inserts charts using QuickChart image URLs when numeric metrics are detected.

## Setup

1. Clone/open this repo.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder.

## Google OAuth setup

Create an OAuth Client ID in Google Cloud Console and enable the **Google Docs API**.

In the extension popup, set:

- **Google OAuth Client ID** (required)
- **OpenAI API Key** (optional, for better rewrite quality)
- **Focus prompt** (optional)

## Usage

1. Open any Google Doc you can edit.
2. Click the extension icon.
3. Fill credentials.
4. Click **Refine Current Doc**.

The extension appends a new section titled **AI Detail Pass** to your doc.

## Notes

- The tool appends content instead of replacing the original text.
- Charts are generated from numeric values found in the document text.
- You can remove generated content manually in Google Docs if needed.
