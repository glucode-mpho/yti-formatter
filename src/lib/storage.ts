import { promises as fs } from "node:fs";
import path from "node:path";

import { StandupEntry } from "@/lib/types";

const HISTORY_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(HISTORY_DIR, "history.json");
const YTIS_DIR = path.join(process.cwd(), "ytis");

async function ensurePaths(): Promise<void> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.mkdir(YTIS_DIR, { recursive: true });
}

async function readAllHistory(): Promise<StandupEntry[]> {
  await ensurePaths();
  try {
    const content = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStandupEntry);
  } catch {
    return [];
  }
}

async function writeAllHistory(entries: StandupEntry[]): Promise<void> {
  await ensurePaths();
  await fs.writeFile(HISTORY_FILE, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export async function saveStandupEntry(entry: StandupEntry): Promise<void> {
  await ensurePaths();
  await fs.writeFile(path.join(YTIS_DIR, entry.markdownFileName), entry.markdownContent, "utf8");
  const existing = await readAllHistory();
  const next = [entry, ...existing].slice(0, 200);
  await writeAllHistory(next);
}

export async function getRecentStandups(limit = 7): Promise<StandupEntry[]> {
  const all = await readAllHistory();
  return all.slice(0, limit);
}

function isStandupEntry(value: unknown): value is StandupEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<StandupEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.dateISO === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.rawTranscript === "string" &&
    typeof candidate.formattedText === "string" &&
    typeof candidate.markdownContent === "string" &&
    typeof candidate.markdownFileName === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.sections === "object" &&
    candidate.sections !== null
  );
}
