"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fileExtensionForAudioBlob,
  pickRecordingMimeType,
  readableMicrophoneError,
  RecorderEngine,
  toWavBlob,
} from "@/lib/audio";
import { StandupEntry } from "@/lib/types";

type Phase = "idle" | "recording" | "processing" | "done" | "error";
type InputMode = "voice" | "text";
const DEFAULT_DISPLAY_NAME = "Mpho Ndlela";
const SESSION_API_KEY_KEY = "yti.api_key";
const SESSION_DISPLAY_NAME_KEY = "yti.display_name";

function secondsToClock(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function YtiRecorder() {
  const [displayName, setDisplayName] = useState(DEFAULT_DISPLAY_NAME);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("Ready to capture your standup.");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [result, setResult] = useState<StandupEntry | null>(null);
  const [history, setHistory] = useState<StandupEntry[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>("voice");
  const [textDraft, setTextDraft] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recorderEngineRef = useRef<RecorderEngine>("none");
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(16000);
  const timerRef = useRef<number | null>(null);

  const isBusy = phase === "recording" || phase === "processing";
  const hasResult = result !== null;

  const statusPillClass = useMemo(() => {
    if (phase === "recording") {
      return "status-pill recording";
    }
    if (phase === "processing") {
      return "status-pill processing";
    }
    if (phase === "error") {
      return "status-pill error";
    }
    return "status-pill";
  }, [phase]);

  useEffect(() => {
    void loadHistory();
    try {
      const storedDisplayName = sessionStorage.getItem(SESSION_DISPLAY_NAME_KEY);
      if (storedDisplayName?.trim()) {
        setDisplayName(storedDisplayName.trim());
      }

      const storedApiKey = sessionStorage.getItem(SESSION_API_KEY_KEY);
      if (storedApiKey?.trim()) {
        const restoredKey = storedApiKey.trim();
        setApiKey(restoredKey);
        setApiKeyDraft(restoredKey);
        setIsApiKeyModalOpen(false);
      }
    } catch {
      // Ignore storage failures.
    }
    return () => {
      stopTimer();
      cleanupStream();
      cleanupAudioGraph();
    };
  }, []);

  useEffect(() => {
    try {
      const trimmed = displayName.trim();
      if (trimmed) {
        sessionStorage.setItem(SESSION_DISPLAY_NAME_KEY, trimmed);
      } else {
        sessionStorage.removeItem(SESSION_DISPLAY_NAME_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [displayName]);

  useEffect(() => {
    try {
      if (apiKey) {
        sessionStorage.setItem(SESSION_API_KEY_KEY, apiKey);
      } else {
        sessionStorage.removeItem(SESSION_API_KEY_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [apiKey]);

  function openApiKeyModal() {
    if (phase === "recording" || phase === "processing") {
      return;
    }
    setApiKeyDraft(apiKey);
    setApiKeyError("");
    setShowApiKey(false);
    setIsApiKeyModalOpen(true);
  }

  function applyApiKey() {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) {
      setApiKeyError("Gemini API key is required to continue.");
      return;
    }

    setApiKey(trimmed);
    setApiKeyDraft(trimmed);
    setApiKeyError("");
    setShowApiKey(false);
    setIsApiKeyModalOpen(false);
    setStatusText("Ready to capture your standup.");
  }

  function logout() {
    if (phase === "recording" || phase === "processing") {
      return;
    }

    stopTimer();
    cleanupAudioGraph();
    cleanupStream();
    recorderRef.current = null;
    recorderEngineRef.current = "none";

    setApiKey("");
    setApiKeyDraft("");
    setApiKeyError("");
    setShowApiKey(false);
    setDisplayName(DEFAULT_DISPLAY_NAME);
    setResult(null);
    setHistory([]);
    setRecordingSeconds(0);
    setPhase("idle");
    setStatusText("Logged out. Add your Gemini API key to continue.");
    setIsApiKeyModalOpen(true);

    try {
      sessionStorage.removeItem(SESSION_API_KEY_KEY);
      sessionStorage.removeItem(SESSION_DISPLAY_NAME_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  async function loadHistory() {
    try {
      const response = await fetch("/api/history?limit=7", { method: "GET" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { entries?: StandupEntry[] };
      setHistory(payload.entries ?? []);
    } catch {
      // Non-fatal for UI.
    }
  }

  function startTimer() {
    stopTimer();
    setRecordingSeconds(0);
    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((current) => current + 1);
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function cleanupStream() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }

  function cleanupAudioGraph() {
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current.onaudioprocess = null;
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    pcmChunksRef.current = [];
  }

  async function tryStartWebAudioRecorder(stream: MediaStream): Promise<boolean> {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return false;
    }

    const audioContext = new AudioContextCtor();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    pcmChunksRef.current = [];

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      pcmChunksRef.current.push(new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    sourceNodeRef.current = source;
    processorNodeRef.current = processor;
    sampleRateRef.current = audioContext.sampleRate;
    recorderEngineRef.current = "web-audio";
    return true;
  }

  async function requestMicrophoneStream(): Promise<MediaStream> {
    const candidates: MediaStreamConstraints[] = [
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      { audio: true },
    ];

    let lastError: unknown = null;
    for (const constraints of candidates) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
        if (error instanceof DOMException) {
          if (error.name === "NotAllowedError" || error.name === "SecurityError") {
            break;
          }

          if (error.name === "NotReadableError" || error.name === "AbortError") {
            await wait(180);
          }
        }
      }
    }

    throw lastError || new Error("Microphone stream request failed.");
  }

  async function startRecording() {
    if (phase === "processing" || isApiKeyModalOpen) {
      return;
    }
    if (!apiKey.trim()) {
      setApiKeyDraft(apiKey);
      setApiKeyError("Gemini API key is required to start recording.");
      setIsApiKeyModalOpen(true);
      setStatusText("Add your Gemini API key to continue.");
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support microphone capture.");
      }
      if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        throw new Error(`Microphone capture requires HTTPS or localhost. Current origin: ${window.location.origin}`);
      }

      cleanupAudioGraph();
      cleanupStream();
      chunksRef.current = [];

      const stream = await requestMicrophoneStream();
      streamRef.current = stream;

      let started = false;

      if (typeof MediaRecorder !== "undefined") {
        try {
          const mimeType = pickRecordingMimeType();
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          recorderRef.current = recorder;
          recorderEngineRef.current = "media-recorder";

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          recorder.onstop = () => {
            stopTimer();
            const blob = new Blob(chunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            });
            cleanupStream();
            if (blob.size === 0) {
              setPhase("error");
              setStatusText("No audio captured. Try again.");
              return;
            }
            void submitAudio(blob);
          };

          recorder.start(250);
          started = true;
        } catch {
          recorderRef.current = null;
          recorderEngineRef.current = "none";
        }
      }

      if (!started) {
        started = await tryStartWebAudioRecorder(stream);
      }

      if (!started) {
        throw new Error("Recording is not supported in this browser.");
      }

      startTimer();
      setPhase("recording");
      setStatusText(
        recorderEngineRef.current === "web-audio"
          ? "Recording... fallback audio mode active."
          : "Recording... press stop when done.",
      );
    } catch (error) {
      setPhase("error");
      setStatusText(readableMicrophoneError(error));
      recorderEngineRef.current = "none";
      recorderRef.current = null;
      cleanupAudioGraph();
      cleanupStream();
    }
  }

  function stopRecording() {
    if (recorderEngineRef.current === "web-audio") {
      stopTimer();
      setPhase("processing");
      setStatusText("Transcribing...");

      const blob = toWavBlob(pcmChunksRef.current, sampleRateRef.current);
      cleanupAudioGraph();
      cleanupStream();
      recorderEngineRef.current = "none";

      if (blob.size === 0) {
        setPhase("error");
        setStatusText("No audio captured. Try again.");
        return;
      }
      void submitAudio(blob);
      return;
    }

    const recorder = recorderRef.current;
    if (recorderEngineRef.current !== "media-recorder" || !recorder || recorder.state === "inactive") {
      return;
    }
    recorder.stop();
    setPhase("processing");
    setStatusText("Transcribing...");
  }

  async function submitAudio(blob: Blob) {
    setPhase("processing");
    setStatusText("Transcribing...");

    const statusTimer = window.setTimeout(() => {
      setStatusText("Structuring standup...");
    }, 1400);

    try {
      const formData = new FormData();
      const extension = fileExtensionForAudioBlob(blob);
      formData.append("audio", blob, `standup-${Date.now()}.${extension}`);
      formData.append("displayName", displayName);
      const userApiKey = apiKey.trim();
      if (!userApiKey) {
        setApiKeyDraft("");
        setApiKeyError("Gemini API key is required to submit audio.");
        setIsApiKeyModalOpen(true);
        throw new Error("Missing Gemini API key.");
      }

      const response = await fetch("/api/standup", {
        method: "POST",
        headers: { "x-gemini-api-key": userApiKey },
        body: formData,
      });

      const payload = (await response.json()) as { entry?: StandupEntry; error?: string };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error || "Failed to create standup.");
      }

      setResult(payload.entry);
      setHistory((current) => [payload.entry!, ...current.filter((item) => item.id !== payload.entry!.id)].slice(0, 7));
      setPhase("done");
      setStatusText("Saved ✓");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Standup processing failed.";
      setPhase("error");
      setStatusText(message);
    } finally {
      window.clearTimeout(statusTimer);
      recorderRef.current = null;
      recorderEngineRef.current = "none";
      cleanupAudioGraph();
      cleanupStream();
    }
  }

  async function submitText() {
    const trimmed = textDraft.trim();
    if (!trimmed) {
      setPhase("error");
      setStatusText("Type something before submitting.");
      return;
    }
    if (!apiKey.trim()) {
      setApiKeyDraft("");
      setApiKeyError("Gemini API key is required to format text.");
      setIsApiKeyModalOpen(true);
      setStatusText("Add your Gemini API key to continue.");
      return;
    }

    setPhase("processing");
    setStatusText("Formatting your standup...");

    try {
      const response = await fetch("/api/standup-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": apiKey.trim(),
        },
        body: JSON.stringify({ text: trimmed, displayName }),
      });

      const payload = (await response.json()) as { entry?: StandupEntry; error?: string };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error || "Failed to create standup.");
      }

      setResult(payload.entry);
      setHistory((current) =>
        [payload.entry!, ...current.filter((item) => item.id !== payload.entry!.id)].slice(0, 7),
      );
      setTextDraft("");
      setPhase("done");
      setStatusText("Saved ✓");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Standup processing failed.";
      setPhase("error");
      setStatusText(message);
    }
  }

  async function copyToClipboard() {
    if (!result) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.formattedText);
      setStatusText("Copied to clipboard ✓");
    } catch {
      setStatusText("Clipboard write blocked by browser.");
    }
  }

  function downloadMarkdown() {
    if (!result) {
      return;
    }
    const blob = new Blob([result.markdownContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.markdownFileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <main className="page-shell" aria-hidden={isApiKeyModalOpen}>
        <div className="ambient-circle ambient-one" />
        <div className="ambient-circle ambient-two" />
        <div className="ambient-circle ambient-three" />

        <header className="hero reveal delay-1">
          <p className="kicker">Gemini-Powered Daily Standup</p>
          <nav className="hero-nav" aria-label="Primary">
            <Link href="/">Recorder</Link>
            <Link href="/about">About</Link>
            <Link href="/how-it-works">How It Works</Link>
          </nav>
          <h1>YTI Voice Recorder</h1>
          <p className="subhead">Speak naturally. Get a clean Yesterday / Today / Impediments update instantly.</p>
        </header>

        <section className="main-grid">
          <article className="panel reveal delay-2">
            <div className="panel-header">
              <h2>Record</h2>
              <span className={statusPillClass}>{statusText}</span>
            </div>

            <label className="label" htmlFor="display-name">
              Display name
            </label>
            <input
              id="display-name"
              className="name-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              disabled={phase === "processing"}
            />
            <div className="api-key-summary">
              <p className="muted">Gemini API key connected</p>
              <div className="api-key-summary-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={openApiKeyModal}
                  disabled={phase === "processing" || phase === "recording"}
                >
                  Update key
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={logout}
                  disabled={phase === "processing" || phase === "recording"}
                >
                  Logout
                </button>
              </div>
            </div>

            <div className="mode-switcher">
              <button
                className={`mode-tab ${inputMode === "voice" ? "active" : ""}`}
                type="button"
                onClick={() => setInputMode("voice")}
                disabled={phase === "recording" || phase === "processing"}
              >
                🎙 Voice
              </button>
              <button
                className={`mode-tab ${inputMode === "text" ? "active" : ""}`}
                type="button"
                onClick={() => setInputMode("text")}
                disabled={phase === "recording" || phase === "processing"}
              >
                ✏️ Type It
              </button>
            </div>

            {inputMode === "voice" ? (
              <>
                <div className="record-row">
                  <button
                    className={`record-button ${phase === "recording" ? "live" : ""}`}
                    onClick={phase === "recording" ? stopRecording : startRecording}
                    disabled={phase === "processing" || isApiKeyModalOpen}
                  >
                    {phase === "recording" ? "Stop" : "Record"}
                  </button>

                  <div className="timer-block">
                    <p className="timer-label">Duration</p>
                    <p className="timer-value">{secondsToClock(recordingSeconds)}</p>
                  </div>
                </div>

                <p className="helper-text">API key is required before recording. Use Chrome or Edge for best capture.</p>
              </>
            ) : (
              <>
                <textarea
                  className="text-input-area"
                  value={textDraft}
                  onChange={(event) => setTextDraft(event.target.value)}
                  placeholder="Yesterday I fixed the login bug and merged PR #42. Today I'm going to start working on the settings page. No blockers."
                  disabled={phase === "processing"}
                  rows={5}
                />
                <div className="text-submit-row">
                  <button
                    className="format-button"
                    type="button"
                    onClick={submitText}
                    disabled={phase === "processing" || isApiKeyModalOpen || !textDraft.trim()}
                  >
                    {phase === "processing" ? "Formatting…" : "Format"}
                  </button>
                </div>
                <p className="helper-text">Describe your standup casually — Gemini will structure it into Y / T / I format.</p>
              </>
            )}
          </article>

          <article className="panel reveal delay-3">
            <div className="panel-header">
              <h2>Output</h2>
              <p className="muted">{hasResult ? result.markdownFileName : "No standup yet"}</p>
            </div>

            <pre className="output">{result?.formattedText ?? "Your formatted standup will appear here."}</pre>

            <div className="action-row">
              <button className="ghost-button" onClick={copyToClipboard} disabled={!hasResult || isBusy}>
                Copy
              </button>
              <button className="ghost-button" onClick={downloadMarkdown} disabled={!hasResult || isBusy}>
                Download .md
              </button>
            </div>
          </article>
        </section>

        <section className="panel history reveal delay-4">
          <div className="panel-header">
            <h2>Recent Standups</h2>
            <p className="muted">Last 7 entries</p>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <p className="empty">No standups saved yet.</p>
            ) : (
              history.map((entry) => (
                <button
                  key={entry.id}
                  className="history-item"
                  onClick={() => setResult(entry)}
                  disabled={phase === "processing"}
                >
                  <div>
                    <p className="history-date">{entry.dateISO}</p>
                    <p className="history-name">{entry.displayName}</p>
                  </div>
                  <p className="history-preview">{entry.formattedText.replace(/\s+/g, " ").slice(0, 110)}...</p>
                </button>
              ))
            )}
          </div>
        </section>
      </main>

      {isApiKeyModalOpen && (
        <div className="api-key-modal-overlay" role="presentation">
          <section className="api-key-modal" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
            <p className="kicker">Before You Start</p>
            <h2 id="api-key-title">Add your Gemini API key</h2>
            <p className="api-key-copy">Enter your key to enable recording and Y/T/I formatting.</p>

            <label className="label" htmlFor="modal-api-key">
              Gemini API key
            </label>
            <input
              id="modal-api-key"
              className="name-input"
              value={apiKeyDraft}
              onChange={(event) => {
                setApiKeyDraft(event.target.value);
                if (apiKeyError) {
                  setApiKeyError("");
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyApiKey();
                }
              }}
              placeholder="AIza..."
              type={showApiKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />

            {apiKeyError ? (
              <p className="api-key-error" role="alert">
                {apiKeyError}
              </p>
            ) : (
              <p className="api-key-hint">The key usually starts with AIza.</p>
            )}

            <div className="api-key-actions">
              <button className="ghost-button" type="button" onClick={() => setShowApiKey((current) => !current)}>
                {showApiKey ? "Hide key" : "Show key"}
              </button>
              <button className="modal-button" type="button" onClick={applyApiKey}>
                Continue
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
