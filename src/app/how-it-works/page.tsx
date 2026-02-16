import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <main className="page-shell about-shell">
      <header className="hero reveal delay-1">
        <p className="kicker">How It Works</p>
        <nav className="hero-nav" aria-label="Primary">
          <Link href="/">Recorder</Link>
          <Link href="/about">About</Link>
          <Link href="/how-it-works">How It Works</Link>
        </nav>
        <h1>How Your Data Is Handled</h1>
        <p className="subhead">
          This page explains what is captured, where it goes, what is stored, and what is cleared when you log out.
        </p>
      </header>

      <section className="panel reveal delay-2">
        <h2>Request Flow</h2>
        <ol className="about-list">
          <li>Your browser records your microphone audio only after you click Record.</li>
          <li>The app sends audio and your Gemini key to `/api/standup` for processing.</li>
          <li>The server calls Gemini to structure Y/T/I output.</li>
          <li>The formatted standup is returned to the browser and shown on screen.</li>
        </ol>
      </section>

      <section className="panel reveal delay-3">
        <h2>What We Store</h2>
        <ul className="about-list">
          <li>Your Gemini API key and display name are kept in `sessionStorage` for this browser session.</li>
          <li>Generated standups are saved on the server in `ytis/*.md` and `data/history.json`.</li>
          <li>The app does not intentionally write your Gemini API key to server files.</li>
        </ul>
      </section>

      <section className="panel reveal delay-4">
        <h2>Logout Behavior</h2>
        <ul className="about-list">
          <li>Clicking Logout clears `sessionStorage` data, including the Gemini API key.</li>
          <li>Logout also clears current in-memory UI state and requires key re-entry.</li>
          <li>Server artifacts already created (history and markdown files) remain unless explicitly removed.</li>
        </ul>
      </section>

      <section className="panel reveal delay-4">
        <h2>What We Do Not Do</h2>
        <ul className="about-list">
          <li>This app does not sell, farm, or broker your standup content.</li>
          <li>This app does not intentionally persist Gemini API keys to server storage.</li>
          <li>No ad-tech or profiling layer is built into this repository.</li>
        </ul>
      </section>
    </main>
  );
}
