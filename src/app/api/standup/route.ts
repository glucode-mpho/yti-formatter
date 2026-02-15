import { randomUUID } from "node:crypto";

import { formatStandup, normalizeSections, parseModelEnvelope, toMarkdown } from "@/lib/standup";
import { saveStandupEntry } from "@/lib/storage";
import { StandupEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
const DEFAULT_MODEL = "gemini-2.0-flash";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

type GeminiPart = {
  text?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

const STANDUP_PROMPT = `
You are formatting a developer daily standup.
Analyze the audio and produce JSON only with these keys:
{
  "rawTranscript": "string",
  "yesterday": ["string"],
  "today": ["string"],
  "impediments": ["string"]
}

Rules:
- Keep output concise and action oriented.
- Remove filler words.
- If no impediments are mentioned, set impediments to ["None"].
- If section markers are missing, infer from context.
- Do not include markdown.
- Do not include extra keys.
`.trim();

function getDateISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDisplayName(input: FormDataEntryValue | null): string {
  const raw = (typeof input === "string" ? input : "").trim();
  if (raw.length > 0) {
    return raw;
  }
  return process.env.DEFAULT_STANDUP_NAME?.trim() || "Developer";
}

function collectText(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("").trim();
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Missing GEMINI_API_KEY in environment." }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("audio");
    const displayName = getDisplayName(formData.get("displayName"));

    if (!(file instanceof File)) {
      return Response.json({ error: "No audio file received." }, { status: 400 });
    }

    const audioBuffer = Buffer.from(await file.arrayBuffer());
    if (audioBuffer.byteLength === 0) {
      return Response.json({ error: "Audio file is empty." }, { status: 400 });
    }
    if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
      return Response.json(
        { error: `Audio file is too large. Max supported size is ${MAX_AUDIO_BYTES / (1024 * 1024)}MB.` },
        { status: 413 },
      );
    }

    const mimeType = file.type || "audio/webm";
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

    const modelResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: STANDUP_PROMPT },
                {
                  inlineData: {
                    mimeType,
                    data: audioBuffer.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!modelResponse.ok) {
      const failure = await modelResponse.text();
      return Response.json(
        { error: "Gemini request failed.", details: failure.slice(0, 1200) },
        { status: 502 },
      );
    }

    const payload = (await modelResponse.json()) as GeminiResponse;
    const rawModelText = collectText(payload);

    const modelEnvelope = parseModelEnvelope(rawModelText);
    const rawTranscript = modelEnvelope.rawTranscript ?? "No speech detected.";
    const sections = normalizeSections(modelEnvelope.sections, rawTranscript);
    const formattedText = formatStandup(displayName, sections);

    const dateISO = getDateISO();
    const markdownFileName = `${dateISO}_yti.md`;
    const markdownContent = toMarkdown(dateISO, formattedText);

    const entry: StandupEntry = {
      id: randomUUID(),
      dateISO,
      displayName,
      rawTranscript,
      formattedText,
      markdownContent,
      markdownFileName,
      sections,
      createdAt: new Date().toISOString(),
    };

    await saveStandupEntry(entry);

    return Response.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
