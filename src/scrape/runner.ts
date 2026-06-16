import type { AppConfig } from "../config.js";
import { BrefClient, BrefRateLimitError } from "../brefClient.js";
import { IngestClient } from "../ingestClient.js";
import type {
  BrefPlayerBio,
  HoopCentralBioPayload,
  ScrapeOptions,
  ScrapeSummary,
} from "../types.js";
import {
  appendLog,
  buildBdlLookup,
  ensureCheckpoint,
  loadCheckpoint,
  loadLinkCache,
  markSlugComplete,
  matchBdlExternalId,
  saveCheckpointSlugs,
  saveLinkCache,
} from "./checkpoint.js";
import { loadSlugCache, saveSlugCache } from "./slugCache.js";

function bioToPayload(
  bio: BrefPlayerBio,
  linkTo?: { source: string; externalId: string },
): HoopCentralBioPayload {
  const payload: HoopCentralBioPayload = {
    source: "basketball-reference",
    externalId: bio.slug,
    player: {
      displayName: bio.displayName,
      birthDate: bio.birthDate,
      position: bio.position,
      heightCm: bio.heightCm,
      weightKg: bio.weightKg,
      jerseyNumber: bio.jerseyNumber,
      hometown: bio.hometown,
      country: bio.country,
      headshotUrl: bio.headshotUrl,
    },
  };

  if (linkTo) payload.linkTo = linkTo;
  return payload;
}

export async function runScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ summary: ScrapeSummary }> {
  const bref = new BrefClient(options.requestDelayMs, options.indexDelayMs);
  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  if (options.backfill) {
    console.log(
      `BRef pacing: ${options.requestDelayMs}ms between player pages, ` +
        `${options.indexDelayMs}ms between index letters (+ jitter, slows further after 429).`,
    );
    console.log("");
  }

  let checkpoint = ensureCheckpoint(
    options.resume ? loadCheckpoint(options.checkpointPath) : null,
  );

  let slugs: string[];
  if (options.playerSlug) {
    slugs = [options.playerSlug.toLowerCase()];
  } else if (options.backfill) {
    const cachedSlugs =
      loadSlugCache(options.slugCachePath) ?? checkpoint.allSlugs ?? null;

    if (cachedSlugs?.length) {
      console.log(`Using saved BRef slug index (${cachedSlugs.length} players).`);
      slugs = cachedSlugs;
    } else {
      console.log("Crawling BRef player index A–Z...");
      try {
        slugs = await bref.listAllSlugs();
      } catch (error) {
        if (error instanceof BrefRateLimitError) {
          throw new Error(
            `${error.message}\n\nBRef is temporarily rate limiting this IP. ` +
              "Wait 1–2 hours before resuming. Your completed players are saved in the checkpoint.",
          );
        }
        throw error;
      }
      saveSlugCache(options.slugCachePath, slugs);
      checkpoint = saveCheckpointSlugs(checkpoint, slugs, options.checkpointPath);
      console.log(`Cached ${slugs.length} player slugs.`);
    }
  } else {
    throw new Error("Specify --backfill or --player-slug");
  }

  const completed = new Set(checkpoint.completedSlugs);
  let pending = slugs.filter((slug) => !completed.has(slug));

  if (options.limit) {
    pending = pending.slice(0, options.limit);
  }

  console.log(
    `Players to process: ${pending.length} (${completed.size} already in checkpoint)`,
  );

  let hcStatusLoaded = false;
  let byName = new Map<string, import("../types.js").HcPlayerStatus[]>();
  const linkCache = loadLinkCache(options.linkCachePath);

  const summary: ScrapeSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: completed.size,
    linked: 0,
    created: 0,
  };

  for (const slug of pending) {
    summary.processed += 1;
    const label = `[${summary.processed}/${pending.length}] ${slug}`;

    try {
      const bio = await bref.parsePlayerPage(slug);
      console.log(`${label}: ${bio.displayName}`);

      let linkTo: { source: string; externalId: string } | undefined;
      const cachedBdlId = linkCache.mappings[slug];
      if (cachedBdlId) {
        linkTo = { source: "balldontlie", externalId: cachedBdlId };
      } else {
        if (!hcStatusLoaded) {
          console.log("Loading balldontlie completion status from Hoop Central...");
          const status = await ingest.getCompletionStatus("balldontlie");
          byName = buildBdlLookup(status.players);
          hcStatusLoaded = true;
          console.log(`Cached ${status.players.length} balldontlie player(s) for linking.`);
        }

        const matchedId = matchBdlExternalId(bio.displayName, bio.birthDate, byName);
        if (matchedId) {
          linkTo = { source: "balldontlie", externalId: matchedId };
          linkCache.mappings[slug] = matchedId;
          saveLinkCache(options.linkCachePath, linkCache);
        }
      }

      const payload = bioToPayload(bio, linkTo);

      if (options.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        appendLog(options.logPath, `DRY-RUN ${slug}: ${bio.displayName}`);
      } else {
        const result = await ingest.sendPlayerBio(payload);
        appendLog(
          options.logPath,
          `OK ${slug}: ${bio.displayName} → playerId=${result.playerId} linkedVia=${result.linkedVia}`,
        );
        if (result.linkedVia === "linkTo" || result.linkedVia === "fuzzy") {
          summary.linked += 1;
        }
        if (result.created.player) summary.created += 1;
      }

      summary.succeeded += 1;
      if (options.resume) {
        checkpoint = markSlugComplete(checkpoint, slug, options.checkpointPath);
      }
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label}: FAILED — ${message}`);
      appendLog(options.logPath, `FAIL ${slug}: ${message}`);

      if (error instanceof BrefRateLimitError) {
        console.error(
          "\nStopping backfill — BRef rate limit reached. Wait 1–2 hours, then resume with --resume.",
        );
        break;
      }
    }
  }

  return { summary };
}

export function printSummary(summary: ScrapeSummary, dryRun: boolean): void {
  console.log("");
  console.log(dryRun ? "Dry-run complete." : "Scrape complete.");
  console.log(`Processed: ${summary.processed}`);
  console.log(`Succeeded: ${summary.succeeded}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Skipped:   ${summary.skipped} (checkpoint)`);
  if (!dryRun) {
    console.log(`Linked:    ${summary.linked}`);
    console.log(`Created:   ${summary.created}`);
  }
}
