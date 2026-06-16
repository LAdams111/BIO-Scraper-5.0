#!/usr/bin/env node
import { loadConfig } from "./config.js";
import {
  DEFAULT_CHECKPOINT,
  DEFAULT_LINK_CACHE,
  DEFAULT_LOG,
} from "./scrape/checkpoint.js";
import { DEFAULT_SLUG_CACHE } from "./scrape/slugCache.js";
import { printSummary, runScrape } from "./scrape/runner.js";
import type { ScrapeOptions } from "./types.js";

function printUsage(): void {
  console.log(`BIO-Scraper — Basketball Reference → Hoop Central bio ingest

Usage:
  npm run scrape -- [options]

Options:
  --backfill             Crawl BRef A–Z index and ingest all NBA players
  --dry-run              Parse and log payload; do not POST
  --resume               Skip slugs in checkpoint file (default with --backfill)
  --limit <n>            Cap players processed (testing)
  --player-slug <slug>   Single player test (e.g. curryst01)
  --delay <ms>           Delay between BRef requests (default 3500)
  --fresh                Ignore checkpoint and reprocess all
  --help                 Show this help

Examples:
  npm run scrape:dry-run -- --player-slug curryst01
  npm run scrape -- --player-slug curryst01
  npm run scrape:dry-run -- --backfill --limit 5
  npm run scrape:backfill -- --resume
`);
}

function parseArgs(argv: string[]): ScrapeOptions & { showHelp: boolean } {
  let backfill = false;
  let dryRun = false;
  let resume = false;
  let fresh = false;
  let limit: number | undefined;
  let playerSlug: string | undefined;
  let requestDelayMs: number | undefined;
  let showHelp = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        showHelp = true;
        break;
      case "--backfill":
        backfill = true;
        resume = true;
        requestDelayMs = requestDelayMs ?? 3500;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--resume":
        resume = true;
        break;
      case "--fresh":
        fresh = true;
        break;
      case "--limit": {
        const value = argv[++i];
        if (!value) throw new Error("--limit requires a value");
        limit = Number.parseInt(value, 10);
        if (Number.isNaN(limit) || limit <= 0) throw new Error(`Invalid limit: ${value}`);
        break;
      }
      case "--player-slug": {
        const value = argv[++i];
        if (!value) throw new Error("--player-slug requires a value");
        playerSlug = value.trim().toLowerCase();
        break;
      }
      case "--delay": {
        const value = argv[++i];
        if (!value) throw new Error("--delay requires a value");
        requestDelayMs = Number.parseInt(value, 10);
        if (Number.isNaN(requestDelayMs) || requestDelayMs < 0) {
          throw new Error(`Invalid delay: ${value}`);
        }
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!showHelp && !backfill && !playerSlug) {
    showHelp = true;
  }

  return {
    backfill,
    dryRun,
    resume: fresh ? false : resume,
    limit,
    playerSlug,
    requestDelayMs: requestDelayMs ?? 3500,
    checkpointPath: DEFAULT_CHECKPOINT,
    logPath: DEFAULT_LOG,
    linkCachePath: DEFAULT_LINK_CACHE,
    slugCachePath: DEFAULT_SLUG_CACHE,
    showHelp,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    printUsage();
    process.exit(0);
  }

  const config = loadConfig();
  const { showHelp: _showHelp, ...scrapeOptions } = args;

  console.log("Starting BIO-Scraper");
  console.log(`Target: ${config.hoopCentralApiUrl}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "live ingest"}`);
  console.log("");

  const { summary } = await runScrape(config, {
    ...scrapeOptions,
    requestDelayMs: scrapeOptions.requestDelayMs ?? config.requestDelayMs,
  });

  printSummary(summary, args.dryRun);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
