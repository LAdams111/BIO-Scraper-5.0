#!/usr/bin/env node
import { loadConfig, BACKFILL_PLAYER_DELAY_MS, BACKFILL_INDEX_DELAY_MS, DEFAULT_PLAYER_DELAY_MS } from "./config.js";
import { getLeagueConfig, parseLeague } from "./league.js";
import { printNcaaSummary, runNcaaScrape } from "./scrape/ncaaRunner.js";
import { printSummary, runScrape } from "./scrape/runner.js";
import type { ScrapeOptions } from "./types.js";

function printUsage(): void {
  console.log(`BIO-Scraper — Basketball Reference → Hoop Central bio ingest

Usage:
  npm run scrape -- [options]

Options:
  --league <nba|wnba|ncaa>  League to scrape (default: nba)
  --backfill             Crawl BRef A–Z index and ingest all players (nba/wnba)
                         or process all Hoop Central NCAA players missing bios (ncaa)
  --dry-run              Parse and log payload; do not POST
  --resume               Skip slugs in checkpoint file (default with --backfill)
  --limit <n>            Cap players processed (testing)
  --player-slug <slug>   Single player test (BRef slug, or NCAA usbasket externalId)
  --delay <ms>           Delay between BRef player pages (backfill default: 6000)
  --fresh                Ignore checkpoint and reprocess all
  --help                 Show this help

Examples:
  npm run scrape:dry-run -- --player-slug curryst01
  npm run scrape -- --player-slug curryst01
  npm run scrape:dry-run -- --league wnba --player-slug digginsk01w
  npm run scrape:dry-run -- --backfill --limit 5
  npm run scrape:backfill -- --resume
  npm run scrape:wnba-backfill -- --resume
  npm run scrape:ncaa-backfill -- --resume
  npm run scrape:dry-run -- --league ncaa --backfill --limit 5
`);
}

function parseArgs(argv: string[]): ScrapeOptions & { showHelp: boolean } {
  let league = "nba" as ScrapeOptions["league"];
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
      case "--league": {
        const value = argv[++i];
        if (!value) throw new Error("--league requires a value");
        league = parseLeague(value);
        break;
      }
      case "--backfill":
        backfill = true;
        resume = true;
        requestDelayMs = requestDelayMs ?? BACKFILL_PLAYER_DELAY_MS;
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

  const leagueConfig = getLeagueConfig(league);

  return {
    league,
    backfill,
    dryRun,
    resume: fresh ? false : resume,
    limit,
    playerSlug,
    requestDelayMs:
      requestDelayMs ?? (backfill ? BACKFILL_PLAYER_DELAY_MS : DEFAULT_PLAYER_DELAY_MS),
    indexDelayMs: BACKFILL_INDEX_DELAY_MS,
    checkpointPath: leagueConfig.checkpointPath,
    logPath: leagueConfig.logPath,
    linkCachePath: leagueConfig.linkCachePath,
    slugCachePath: leagueConfig.slugCachePath,
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
  const leagueConfig = getLeagueConfig(scrapeOptions.league);

  console.log("Starting BIO-Scraper");
  console.log(`League: ${leagueConfig.label}`);
  console.log(`Target: ${config.hoopCentralApiUrl}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "live ingest"}`);
  console.log("");

  const runOptions = {
    ...scrapeOptions,
    requestDelayMs:
      scrapeOptions.requestDelayMs ??
      (scrapeOptions.backfill ? BACKFILL_PLAYER_DELAY_MS : config.requestDelayMs),
    indexDelayMs: scrapeOptions.indexDelayMs ?? config.indexDelayMs,
  };

  if (scrapeOptions.league === "ncaa") {
    const { summary } = await runNcaaScrape(config, runOptions);
    printNcaaSummary(summary, args.dryRun);
    process.exit(summary.failed > 0 ? 1 : 0);
    return;
  }

  const { summary } = await runScrape(config, runOptions);

  printSummary(summary, args.dryRun);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
