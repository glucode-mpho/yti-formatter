# YTI Voice Recorder

A Next.js app that records your standup voice note and converts it into clean Y/T/I format using Gemini.

## Stack

- Next.js 16 + TypeScript
- Gemini API (server-side route)
- Browser audio recording (MediaRecorder with Web Audio fallback)
- Local markdown/history persistence

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.local.example .env.local
```

3. Add your key in `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash
DEFAULT_STANDUP_NAME=Your Name
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000` and allow microphone access.

## Scripts

- `npm run dev` - start local development server
- `npm run lint` - run ESLint
- `npm run build` - production build check
- `npm run start` - run production server

## Output

- Markdown files: `ytis/YYYY-MM-DD_yti.md`
- Local history: `data/history.json`

## CI

GitHub Actions workflow is defined in `.github/workflows/test.yml` and runs lint + build on push and pull requests.
