export type RecorderEngine = "none" | "media-recorder" | "web-audio";

const PREFERRED_AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  for (const candidate of PREFERRED_AUDIO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function toWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const wavBuffer = new ArrayBuffer(44 + totalLength * 2);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + totalLength * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, totalLength * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

export function fileExtensionForAudioBlob(blob: Blob): "wav" | "m4a" | "webm" {
  if (blob.type.includes("wav")) {
    return "wav";
  }
  if (blob.type.includes("mp4")) {
    return "m4a";
  }
  return "webm";
}

export function readableMicrophoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone access denied by browser or OS. Check site permissions and system microphone privacy settings.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "Microphone is busy or blocked by another app (for example Zoom/Teams).";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Microphone start failed.";
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
