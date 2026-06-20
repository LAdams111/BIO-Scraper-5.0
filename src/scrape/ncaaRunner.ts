import type { AppConfig } from "../config.js";
import { BrefClient, BrefRateLimitError } from "../brefClient.js";
import { CbbClient } from "../cbbClient.js";
import { IngestClient } from "../ingestClient.js";
import { getLeagueConfig } from "../league.js";
import type { BrefPlayerBio, HoopCentralBioPayload, ScrapeOptions, ScrapeSummary } from "../types.js";
import {
  appendLog,
  ensureCheckpoint,
  loadCheckpoint,
  loadLinkCache,
  markSlugComplete,
  saveLinkCache,
} from "./checkpoint.js";
import {
  extractNbaSlugFromHeadshot,
  isBioComplete,
} from "../utils/bio.js";
import { UsbasketClient, UsbasketRateLimitError } from "../usbasketClient.js";
import type { UsbasketPlayerBio } from "../usbasket/playerMeta.js";

function bioToPayload(
  bio: UsbasketPlayerBio & { jerseyNumber?: string | null },
  bioSource: string,
): HoopCentralBioPayload {
  return {
    source: bioSource,
    externalId: bio.externalId,
    player: {
      displayName: bio.displayName,
      birthDate: bio.birthDate,
      position: bio.position,
      heightCm: bio.heightCm,
      weightKg: bio.weightKg,
      jerseyNumber: bio.jerseyNumber ?? null,
      hometown: bio.hometown,
      country: bio.country,
    },
  };
}

function mergeWithSportsReference(
  usb: UsbasketPlayerBio,
  sr: BrefPlayerBio | null,
): UsbasketPlayerBio & { jerseyNumber?: string | null } {
  if (!sr) {
    return usb;
  }

  return {
    externalId: usb.externalId,
    displayName: usb.displayName || sr.displayName,
    birthDate: usb.birthDate ?? sr.birthDate,
    position: usb.position ?? sr.position,
    heightCm: usb.heightCm ?? sr.heightCm,
    weightKg: usb.weightKg ?? sr.weightKg,
    hometown: usb.hometown ?? sr.hometown,
    country: usb.country ?? sr.country,
    jerseyNumber: usb.jerseyNumber ?? sr.jerseyNumber,
  };
}

async function resolveSportsReferenceBio(
  displayName: string,
  profileHeadshotUrl: string | null,
  nbaClient: BrefClient,
  cbbClient: CbbClient,
  slugCache: Record<string, string>,
): Promise<BrefPlayerBio | null> {
  const nbaSlug = extractNbaSlugFromHeadshot(profileHeadshotUrl);
  if (nbaSlug) {
    try {
      return await nbaClient.parsePlayerPage(nbaSlug);
    } catch {
      /* fall through */
    }
  }

  const cachedSlug = slugCache[displayName];
  if (cachedSlug) {
    try {
      if (cachedSlug.includes("-")) {
        return await cbbClient.parsePlayerPage(cachedSlug);
      }
      return await nbaClient.parsePlayerPage(cachedSlug);
    } catch {
      delete slugCache[displayName];
    }
  }

  const cbbSlug = await cbbClient.resolveSlugByName(displayName);
  if (!cbbSlug) return null;

  slugCache[displayName] = cbbSlug;
  return cbbClient.parsePlayerPage(cbbSlug);
}

export async function runNcaaScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ summary: ScrapeSummary }> {
  const league = getLeagueConfig("ncaa");
  const usb = new UsbasketClient(options.requestDelayMs);
  const nbaClient = new BrefClient(options.requestDelayMs, options.indexDelayMs);
  const cbbClient = new CbbClient(options.requestDelayMs, options.indexDelayMs);
  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  console.log(
    `NCAA pacing: ${options.requestDelayMs}ms between USBasket/Sports Reference pages (+ jitter).`,
  );
  console.log("Bio source: USBasket player profiles (same IDs as your stats ingest).");
  console.log("");

  let checkpoint = ensureCheckpoint(
    options.resume ? loadCheckpoint(options.checkpointPath) : null,
  );
  const slugCache = loadLinkCache(options.linkCachePath).mappings;

  console.log(`Loading ${league.linkSource} player list from Hoop Central...`);
  const status = await ingest.getCompletionStatus(league.linkSource!);
  const players = status.players;
  console.log(`Found ${players.length} NCAA players with stats.`);

  const completed = new Set(checkpoint.completedSlugs);
  let pending = players.filter((player) => !completed.has(player.externalId));

  if (options.playerSlug) {
    pending = pending.filter(
      (player) =>
        player.externalId === options.playerSlug ||
        String(player.playerId) === options.playerSlug,
    );
  }

  if (options.limit) {
    pending = pending.slice(0, options.limit);
  }

  console.log(
    `Players to process: ${pending.length} (${completed.size} already in checkpoint)`,
  );

  const summary: ScrapeSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: completed.size,
    linked: 0,
    created: 0,
  };

  for (const player of pending) {
    summary.processed += 1;
    const label = `[${summary.processed}/${pending.length}] ${player.externalId}`;

    try {
      const profile = await ingest.getPlayerProfile(player.playerId);

      if (isBioComplete(profile)) {
        console.log(`${label}: ${profile.name} — skipped (bio already complete)`);
        appendLog(options.logPath, `SKIP-COMPLETE ${player.externalId}: ${profile.name}`);
        summary.skipped += 1;
        if (options.resume) {
          checkpoint = markSlugComplete(checkpoint, player.externalId, options.checkpointPath);
        }
        continue;
      }

      const usbBio = await usb.parsePlayerBio(
        player.externalId,
        player.displayName,
        profile.position,
      );

      const needsJersey = !profile.jerseyNumber || profile.jerseyNumber.trim() === "";
      const needsSrFallback =
        (needsJersey && !usbBio.jerseyNumber) ||
        !usbBio.birthDate ||
        !usbBio.hometown ||
        !usbBio.heightCm ||
        !usbBio.weightKg ||
        !usbBio.position;

      let merged = mergeWithSportsReference(usbBio, null);
      if (needsSrFallback) {
        const srBio = await resolveSportsReferenceBio(
          profile.name,
          profile.headshotUrl,
          nbaClient,
          cbbClient,
          slugCache,
        );
        merged = mergeWithSportsReference(usbBio, srBio);
      }

      console.log(
        `${label}: ${merged.displayName} ← usbasket/${player.externalId}` +
          (merged.jerseyNumber ? ` #${merged.jerseyNumber}` : "") +
          (merged.birthDate ? ` DOB ${merged.birthDate}` : "") +
          (merged.hometown ? ` from ${merged.hometown}` : ""),
      );

      const payload = bioToPayload(merged, league.linkSource!);

      if (options.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        appendLog(options.logPath, `DRY-RUN ${player.externalId}: ${profile.name}`);
      } else {
        const result = await ingest.sendPlayerBio(payload);

        if (result.playerId !== player.playerId) {
          throw new Error(
            `Bio ingest updated player ${result.playerId} but completion-status expects ${player.playerId} ` +
              `(linkedVia=${result.linkedVia}) — refusing to continue for this player`,
          );
        }
        if (result.linkedVia === "created" || result.created.player) {
          throw new Error(
            `Bio ingest created a new player ${result.playerId} instead of updating existing ${player.playerId}`,
          );
        }

        appendLog(
          options.logPath,
          `OK ${player.externalId}: ${profile.name} → playerId=${result.playerId} linkedVia=${result.linkedVia}`,
        );
        if (result.linkedVia === "identity") summary.linked += 1;
        if (result.created.identity) summary.created += 1;
      }

      saveLinkCache(options.linkCachePath, {
        version: 1,
        mappings: slugCache,
        updatedAt: new Date().toISOString(),
      });

      summary.succeeded += 1;
      if (options.resume) {
        checkpoint = markSlugComplete(checkpoint, player.externalId, options.checkpointPath);
      }
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label}: FAILED — ${message}`);
      appendLog(options.logPath, `FAIL ${player.externalId}: ${message}`);

      if (error instanceof BrefRateLimitError || error instanceof UsbasketRateLimitError) {
        console.error(
          "\nStopping backfill — rate limit reached. Wait 1–2 hours, then resume with --resume.",
        );
        break;
      }
    }
  }

  return { summary };
}

export function printNcaaSummary(summary: ScrapeSummary, dryRun: boolean): void {
  console.log("");
  console.log(dryRun ? "NCAA dry-run complete." : "NCAA scrape complete.");
  console.log(`Processed: ${summary.processed}`);
  console.log(`Succeeded: ${summary.succeeded}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Skipped:   ${summary.skipped} (checkpoint + already complete)`);
  if (!dryRun) {
    console.log(`Linked:    ${summary.linked}`);
    console.log(`Identities created: ${summary.created}`);
  }
}
