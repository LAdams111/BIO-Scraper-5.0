import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { HcPlayerStatus } from "../types.js";

export const DEFAULT_CHECKPOINT = "scrape-bio-backfill.checkpoint.json";
export const DEFAULT_LOG = "scrape-bio-backfill.log";
export const DEFAULT_LINK_CACHE = "bref-to-bdl.cache.json";

export interface BioCheckpoint {
  version: 1;
  completedSlugs: string[];
  updatedAt: string;
}

export interface LinkCache {
  version: 1;
  mappings: Record<string, string>;
  updatedAt: string;
}

export function loadCheckpoint(path: string): BioCheckpoint | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as BioCheckpoint;
    if (raw.version !== 1 || !Array.isArray(raw.completedSlugs)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveCheckpoint(path: string, checkpoint: BioCheckpoint): void {
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

export function ensureCheckpoint(checkpoint: BioCheckpoint | null): BioCheckpoint {
  return (
    checkpoint ?? {
      version: 1,
      completedSlugs: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

export function markSlugComplete(
  checkpoint: BioCheckpoint,
  slug: string,
  path: string,
): BioCheckpoint {
  if (!checkpoint.completedSlugs.includes(slug)) {
    checkpoint.completedSlugs.push(slug);
  }
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  return checkpoint;
}

export function loadLinkCache(path: string): LinkCache {
  if (!existsSync(path)) {
    return { version: 1, mappings: {}, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as LinkCache;
    if (raw.version !== 1 || typeof raw.mappings !== "object") {
      return { version: 1, mappings: {}, updatedAt: new Date().toISOString() };
    }
    return raw;
  } catch {
    return { version: 1, mappings: {}, updatedAt: new Date().toISOString() };
  }
}

export function saveLinkCache(path: string, cache: LinkCache): void {
  cache.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function appendLog(path: string, line: string): void {
  writeFileSync(path, `${line}\n`, { flag: "a" });
}

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildBdlLookup(
  players: HcPlayerStatus[],
): Map<string, HcPlayerStatus[]> {
  const byName = new Map<string, HcPlayerStatus[]>();

  for (const player of players) {
    const key = normalizeName(player.displayName);
    const existing = byName.get(key) ?? [];
    existing.push(player);
    byName.set(key, existing);
  }

  return byName;
}

export function matchBdlExternalId(
  displayName: string,
  birthDate: string | null,
  byName: Map<string, HcPlayerStatus[]>,
): string | null {
  const key = normalizeName(displayName);
  const candidates = byName.get(key);
  if (!candidates?.length) return null;

  if (birthDate) {
    const dobMatches = candidates.filter((c) => c.birthDate === birthDate);
    if (dobMatches.length === 1) return dobMatches[0].externalId;
    if (dobMatches.length > 1) return null;
  }

  if (candidates.length === 1) return candidates[0].externalId;
  return null;
}
