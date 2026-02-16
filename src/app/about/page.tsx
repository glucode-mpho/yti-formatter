import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="page-shell about-shell">
      <header className="hero reveal delay-1">
        <p className="kicker">About</p>
        <nav className="hero-nav" aria-label="Primary">
          <Link href="/">Recorder</Link>
          <Link href="/about">About</Link>
          <Link href="/how-it-works">How It Works</Link>
        </nav>
        <h1>How YTI Voice Recorder Works</h1>
        <p className="subhead">
          The app captures speech in your browser, sends audio to a server route, structures Y/T/I with Gemini, and
          saves local history plus markdown output.
        </p>
      </header>

      <section className="panel reveal delay-2">
        <h2>Flow</h2>
        <ol className="about-list">
          <li>Record audio from your microphone in the browser.</li>
          <li>Upload audio to `/api/standup`.</li>
          <li>Gemini returns structured standup JSON.</li>
          <li>App normalizes bullets and creates formatted Y/T/I text.</li>
          <li>Server writes markdown file and updates `data/history.json`.</li>
          <li>UI shows result and supports copy or download.</li>
        </ol>
      </section>

      <section className="panel reveal delay-3">
        <h2>Design Goals</h2>
        <ul className="about-list">
          <li>Fast developer workflow with minimal typing.</li>
          <li>Readable, modular TypeScript code with clear boundaries.</li>
          <li>Resilient recording with MediaRecorder and Web Audio fallback.</li>
          <li>Local artifact storage for daily continuity and auditability.</li>
        </ul>
      </section>
    </main>
  );
}
