export type ScrapeLeague = "nba" | "wnba" | "ncaa";

export interface LeagueConfig {
  slug: ScrapeLeague;
  label: string;
  bioSource: string;
  /** Stats identity source used for linkTo matching (NBA only). */
  linkSource: string | null;
  playersPath: string;
  slugFilter: (slug: string) => boolean;
  checkpointPath: string;
  logPath: string;
  linkCachePath: string;
  slugCachePath: string;
}

export const LEAGUE_CONFIG: Record<ScrapeLeague, LeagueConfig> = {
  nba: {
    slug: "nba",
    label: "NBA",
    bioSource: "basketball-reference",
    linkSource: "balldontlie",
    playersPath: "players",
    slugFilter: () => true,
    checkpointPath: "scrape-bio-backfill.checkpoint.json",
    logPath: "scrape-bio-backfill.log",
    linkCachePath: "bref-to-bdl.cache.json",
    slugCachePath: "bref-player-slugs.cache.json",
  },
  wnba: {
    slug: "wnba",
    label: "WNBA",
    bioSource: "basketball-reference-wnba",
    linkSource: null,
    playersPath: "wnba/players",
    slugFilter: (slug) => slug.endsWith("w"),
    checkpointPath: "scrape-bio-wnba-backfill.checkpoint.json",
    logPath: "scrape-bio-wnba-backfill.log",
    linkCachePath: "bref-wnba-link.cache.json",
    slugCachePath: "bref-wnba-player-slugs.cache.json",
  },
  ncaa: {
    slug: "ncaa",
    label: "NCAA D-I Men's",
    bioSource: "usbasket-ncaa-d1",
    linkSource: "usbasket-ncaa-d1",
    playersPath: "cbb/players",
    slugFilter: () => true,
    checkpointPath: "scrape-bio-ncaa-backfill.checkpoint.json",
    logPath: "scrape-bio-ncaa-backfill.log",
    linkCachePath: "ncaa-cbb-slug.cache.json",
    slugCachePath: "ncaa-player-external-ids.cache.json",
  },
};

export function getLeagueConfig(league: ScrapeLeague): LeagueConfig {
  return LEAGUE_CONFIG[league];
}

export function parseLeague(value: string | undefined): ScrapeLeague {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "nba") return "nba";
  if (normalized === "wnba") return "wnba";
  if (normalized === "ncaa") return "ncaa";
  throw new Error(`Invalid league: ${value}. Use "nba", "wnba", or "ncaa".`);
}
