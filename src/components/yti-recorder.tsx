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

function secondsToClock(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function YtiRecorder() {
  const [displayName, setDisplayName] = useState("Mpho Ndlela");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("Ready to capture your standup.");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [result, setResult] = useState<StandupEntry | null>(null);
  const [history, setHistory] = useState<StandupEntry[]>([]);

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
    return () => {
      stopTimer();
      cleanupStream();
      cleanupAudioGraph();
    };
  }, []);

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

  async function startRecording() {
    if (phase === "processing") {
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support microphone capture.");
      }
      if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        throw new Error("Microphone capture requires HTTPS or localhost.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cleanupAudioGraph();

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

      const response = await fetch("/api/standup", {
        method: "POST",
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
    <main className="page-shell">
      <div className="ambient-circle ambient-one" />
      <div className="ambient-circle ambient-two" />
      <div className="ambient-circle ambient-three" />

      <header className="hero reveal delay-1">
        <p className="kicker">Gemini-Powered Daily Standup</p>
        <nav className="hero-nav" aria-label="Primary">
          <Link href="/">Recorder</Link>
          <Link href="/about">About</Link>
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

          <div className="record-row">
            <button
              className={`record-button ${phase === "recording" ? "live" : ""}`}
              onClick={phase === "recording" ? stopRecording : startRecording}
              disabled={phase === "processing"}
            >
              {phase === "recording" ? "Stop" : "Record"}
            </button>

            <div className="timer-block">
              <p className="timer-label">Duration</p>
              <p className="timer-value">{secondsToClock(recordingSeconds)}</p>
            </div>
          </div>

          <p className="helper-text">Use Chrome or Edge for the most reliable in-browser microphone capture.</p>
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
  );
}
