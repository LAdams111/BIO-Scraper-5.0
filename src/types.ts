export interface BrefPlayerBio {
  slug: string;
  displayName: string;
  birthDate: string | null;
  position: string | null;
  heightCm: number | null;
  weightKg: number | null;
  jerseyNumber: string | null;
  hometown: string | null;
  country: string | null;
  headshotUrl: string | null;
}

export interface HoopCentralBioPayload {
  source: string;
  externalId: string;
  player: {
    displayName: string;
    birthDate?: string | null;
    position?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
    jerseyNumber?: string | null;
    hometown?: string | null;
    country?: string | null;
    headshotUrl?: string | null;
  };
  linkTo?: {
    source: string;
    externalId: string;
  };
}

export interface HoopCentralBioResponse {
  ok: true;
  playerId: number;
  created: {
    player: boolean;
    identity: boolean;
  };
  linkedVia: "linkTo" | "identity" | "fuzzy" | "created";
}

export interface HcPlayerStatus {
  playerId: number;
  externalId: string;
  displayName: string;
  birthDate: string | null;
  seasons: Array<{
    seasonLabel: string;
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
  }>;
}

import type { ScrapeLeague } from "./league.js";

export interface ScrapeOptions {
  league: ScrapeLeague;
  backfill: boolean;
  dryRun: boolean;
  resume: boolean;
  limit?: number;
  playerSlug?: string;
  requestDelayMs: number;
  indexDelayMs: number;
  checkpointPath: string;
  logPath: string;
  linkCachePath: string;
  slugCachePath: string;
}

export interface ScrapeSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  linked: number;
  created: number;
}
