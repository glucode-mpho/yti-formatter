import { StandupSections } from "@/lib/types";

const FILLER_WORDS = ["basically", "just", "like", "um", "uh", "so yeah"];
const ACRONYMS = ["ui", "pr", "api", "qa", "sdk", "ios", "android", "db", "sql", "ci", "cd"];

function sentenceCase(value: string): string {
  const clean = value.trim();
  if (!clean) {
    return clean;
  }
  return clean[0].toUpperCase() + clean.slice(1);
}

function normalizeAcronyms(value: string): string {
  let next = value;
  for (const acronym of ACRONYMS) {
    next = next.replace(new RegExp(`\\b${acronym}\\b`, "gi"), acronym.toUpperCase());
  }
  return next;
}

export function normalizeBullet(value: string, section: keyof StandupSections): string | null {
  let next = value.replace(/\s+/g, " ").trim();
  if (!next) {
    return null;
  }

  for (const filler of FILLER_WORDS) {
    next = next.replace(new RegExp(`\\b${filler}\\b`, "gi"), " ");
  }

  next = next
    .replace(/^(i|we)\s+(was|were|am|are|have|had|did|currently|will)\s+/i, "")
    .replace(/^(i|we)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!next) {
    return null;
  }

  const lower = next.toLowerCase();

  if (section === "impediments" && /\b(no impediments|no blockers|none|nothing blocking|not blocked)\b/i.test(lower)) {
    return "None";
  }

  if (/\b(worked|working) on (the )?ui\b/i.test(lower)) {
    return "Refactored UI";
  }

  if (lower.startsWith("working on ")) {
    next = `Advance ${next.slice("working on ".length).trim()}`;
  } else if (lower.startsWith("helping with ")) {
    next = `Assist with ${next.slice("helping with ".length).trim()}`;
  }

  next = sentenceCase(next);
  next = normalizeAcronyms(next);
  return next;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function normalizeSections(input: Partial<StandupSections>, rawTranscript: string): StandupSections {
  const result: StandupSections = {
    yesterday: [],
    today: [],
    impediments: [],
  };

  const sectionOrder: Array<keyof StandupSections> = ["yesterday", "today", "impediments"];
  for (const section of sectionOrder) {
    const source = input[section] ?? [];
    for (const item of source) {
      const cleaned = normalizeBullet(item, section);
      if (cleaned) {
        result[section].push(cleaned);
      }
    }
    result[section] = dedupe(result[section]);
  }

  if (result.yesterday.length === 0 && result.today.length === 0 && rawTranscript.trim()) {
    const fallback = normalizeBullet(rawTranscript, "today");
    if (fallback) {
      result.today.push(fallback);
    }
  }

  if (result.impediments.length === 0) {
    result.impediments.push("None");
  }

  return result;
}

export function formatStandup(displayName: string, sections: StandupSections): string {
  const lines: string[] = [displayName, "", "Y:", ""];
  lines.push(...toBullets(sections.yesterday));
  lines.push("", "T:", "");
  lines.push(...toBullets(sections.today));
  lines.push("", "I:", "");
  lines.push(...toBullets(sections.impediments));
  return `${lines.join("\n").trim()}\n`;
}

export function toMarkdown(dateISO: string, formattedText: string): string {
  return `# Daily Standup - ${dateISO}\n\n${formattedText.trim()}\n`;
}

function toBullets(items: string[]): string[] {
  if (items.length === 0) {
    return ["* None"];
  }
  return items.map((item) => `* ${item}`);
}

export function parseModelPayload(raw: string): Partial<StandupSections> {
  return parseModelEnvelope(raw).sections;
}

export function parseModelEnvelope(raw: string): {
  rawTranscript: string | null;
  sections: Partial<StandupSections>;
} {
  const parsed = parseModelObject(raw);
  if (!parsed) {
    return { rawTranscript: null, sections: {} };
  }

  const rawTranscript =
    typeof parsed.rawTranscript === "string" && parsed.rawTranscript.trim().length > 0
      ? parsed.rawTranscript.trim()
      : null;

  return {
    rawTranscript,
    sections: {
      yesterday: parseArray(parsed.yesterday ?? parsed.y),
      today: parseArray(parsed.today ?? parsed.t),
      impediments: parseArray(parsed.impediments ?? parsed.i),
    },
  };
}

function parseArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
}

function parseModelObject(raw: string): Record<string, unknown> | null {
  const direct = parseObject(raw);
  if (direct) {
    return direct;
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!fencedMatch?.[1]) {
    return null;
  }

  return parseObject(fencedMatch[1]);
}

function parseObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
