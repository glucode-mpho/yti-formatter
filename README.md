# YTI Voice Recorder (Next.js + Gemini)

Voice-first standup recorder that turns natural speech into a clean Y / T / I update.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file:

```bash
cp .env.local.example .env.local
```

3. Add your Gemini key in `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash
DEFAULT_STANDUP_NAME=Your Name
```

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- Browser microphone recording
- Gemini-based transcript + Y/T/I structuring
- Filler cleanup and bullet normalization
- Markdown export (`ytis/YYYY-MM-DD_yti.md`)
- Clipboard copy
- Local history (`data/history.json`) with recent entries in UI

## Notes

- Use Chrome or Edge for best microphone support.
- All generated files are local to this repo.
