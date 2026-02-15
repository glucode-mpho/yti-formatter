import { randomUUID } from "node:crypto";

import { formatStandup, normalizeSections, parseModelPayload, toMarkdown } from "@/lib/standup";
import { saveStandupEntry } from "@/lib/storage";
import { StandupEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

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

function parseRawTranscript(rawJsonText: string, fallbackText: string): string {
  if (!rawJsonText.trim()) {
    return fallbackText;
  }
  try {
    const parsed = JSON.parse(rawJsonText) as { rawTranscript?: unknown };
    if (typeof parsed.rawTranscript === "string" && parsed.rawTranscript.trim().length > 0) {
      return parsed.rawTranscript.trim();
    }
  } catch {
    return fallbackText;
  }
  return fallbackText;
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
    const mimeType = file.type || "audio/webm";
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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

    const modelSections = parseModelPayload(rawModelText);
    const rawTranscript = parseRawTranscript(rawModelText, "No speech detected.");
    const sections = normalizeSections(modelSections, rawTranscript);
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
