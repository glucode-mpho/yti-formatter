import { randomUUID } from "node:crypto";

import { formatStandup, normalizeSections, parseModelEnvelope, toMarkdown } from "@/lib/standup";
import { saveStandupEntry } from "@/lib/storage";
import { StandupEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const DEFAULT_MODEL = "gemini-2.0-flash";

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

const TEXT_STANDUP_PROMPT = `
You are formatting a developer daily standup.
The user has typed a casual, conversational description of their work.
Analyze the text and produce JSON only with these keys:
{
  "rawTranscript": "string",
  "yesterday": ["string"],
  "today": ["string"],
  "impediments": ["string"]
}

Rules:
- "rawTranscript" should be the original text the user provided.
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

function getDisplayName(input: string | undefined): string {
  const raw = (input ?? "").trim();
  if (raw.length > 0) {
    return raw;
  }
  return process.env.DEFAULT_STANDUP_NAME?.trim() || "Developer";
}

function collectText(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("").trim();
}

function getApiKey(request: Request): string | null {
  const headerKey = request.headers.get("x-gemini-api-key")?.trim();
  if (headerKey) {
    return headerKey;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const bearerToken = authorization.slice("bearer ".length).trim();
    if (bearerToken) {
      return bearerToken;
    }
  }

  const envKey = process.env.GEMINI_API_KEY?.trim();
  return envKey || null;
}

type TextStandupBody = {
  text?: string;
  displayName?: string;
};

export async function POST(request: Request): Promise<Response> {
  const apiKey = getApiKey(request);
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Missing Gemini API key. Set GEMINI_API_KEY on the server or provide x-gemini-api-key in the request.",
      },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json()) as TextStandupBody;
    const userText = (body.text ?? "").trim();
    const displayName = getDisplayName(body.displayName);

    if (!userText) {
      return Response.json({ error: "No text provided." }, { status: 400 });
    }

    if (userText.length > 10_000) {
      return Response.json(
        { error: "Text is too long. Please keep it under 10,000 characters." },
        { status: 413 },
      );
    }

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
                { text: TEXT_STANDUP_PROMPT },
                { text: userText },
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
    const rawTranscript = modelEnvelope.rawTranscript ?? userText;
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
