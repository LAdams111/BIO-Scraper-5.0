import type { BrefPlayerBio } from "./types.js";
import { heightToCm, normalizePosition, weightToKg } from "./utils/physical.js";
import { backoffMs, parseRetryAfterMs, sleep } from "./utils/rateLimiter.js";

const USER_AGENT = "Mozilla/5.0 (compatible; HoopCentralBioScraper/1.0; +https://github.com/hoopcentral)";

const COUNTRY_BY_FLAG: Record<string, string> = {
  us: "United States",
  ca: "Canada",
  au: "Australia",
  fr: "France",
  de: "Germany",
  es: "Spain",
  it: "Italy",
  gb: "United Kingdom",
  uk: "United Kingdom",
  cn: "China",
  jp: "Japan",
  br: "Brazil",
  mx: "Mexico",
  ng: "Nigeria",
  za: "South Africa",
  rs: "Serbia",
  hr: "Croatia",
  gr: "Greece",
  tr: "Turkey",
  lt: "Lithuania",
  lv: "Latvia",
  ee: "Estonia",
  pl: "Poland",
  ua: "Ukraine",
  ru: "Russia",
  ar: "Argentina",
  ve: "Venezuela",
  pr: "Puerto Rico",
  do: "Dominican Republic",
  ht: "Haiti",
  sn: "Senegal",
  cm: "Cameroon",
  cd: "Democratic Republic of the Congo",
  cg: "Republic of the Congo",
  sd: "Sudan",
  ss: "South Sudan",
  nz: "New Zealand",
  kr: "South Korea",
  tw: "Taiwan",
  ph: "Philippines",
  in: "India",
  il: "Israel",
  jo: "Jordan",
  lb: "Lebanon",
  eg: "Egypt",
  ge: "Georgia",
  ba: "Bosnia and Herzegovina",
  me: "Montenegro",
  mk: "North Macedonia",
  si: "Slovenia",
  cz: "Czech Republic",
  sk: "Slovakia",
  hu: "Hungary",
  ro: "Romania",
  bg: "Bulgaria",
  fi: "Finland",
  se: "Sweden",
  no: "Norway",
  dk: "Denmark",
  nl: "Netherlands",
  be: "Belgium",
  ch: "Switzerland",
  at: "Austria",
  pt: "Portugal",
  ir: "Iran",
  iq: "Iraq",
  sa: "Saudi Arabia",
  ae: "United Arab Emirates",
  pa: "Panama",
  cu: "Cuba",
  jm: "Jamaica",
  tt: "Trinidad and Tobago",
  bs: "Bahamas",
  vi: "U.S. Virgin Islands",
};

export class BrefClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrefClientError";
  }
}

function countryFromFlagClass(className: string): string | null {
  const match = /\bf-([a-z]{2})\b/.exec(className);
  if (!match) return null;
  const code = match[1];
  return COUNTRY_BY_FLAG[code] ?? code.toUpperCase();
}

function cleanLocationText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+[a-z]{2}\s*$/i, "")
    .trim();
}

function parseBornParagraph(text: string): { hometown: string | null; country: string | null } {
  const inMatch = /\bin\s+(.+)$/i.exec(text.replace(/\s+/g, " ").trim());
  if (!inMatch) return { hometown: null, country: null };

  let location = cleanLocationText(inMatch[1]);
  location = location.replace(/\s*us\s*$/i, "").trim();
  location = location.replace(/,\s*$/, "").trim();

  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { hometown: null, country: null };

  if (parts.length >= 3) {
    return {
      hometown: parts.slice(0, -1).join(", "),
      country: parts[parts.length - 1],
    };
  }

  return { hometown: location, country: null };
}

function parseJsonLdBirthPlace(html: string): { hometown: string | null; country: string | null } {
  const match = /"birthPlace"\s*:\s*"([^"]+)"/.exec(html);
  if (!match) return { hometown: null, country: null };

  const parts = match[1].split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { hometown: null, country: null };
  if (parts.length === 1) return { hometown: parts[0], country: null };

  return {
    hometown: parts.slice(0, -1).join(", "),
    country: parts[parts.length - 1] ?? null,
  };
}

export class BrefClient {
  private lastRequestAt = 0;
  private cooldownUntil = 0;

  constructor(
    private readonly requestDelayMs: number,
    private readonly indexDelayMs = 4000,
  ) {}

  private async throttle(minDelayMs = this.requestDelayMs): Promise<void> {
    const now = Date.now();
    if (now < this.cooldownUntil) {
      await sleep(this.cooldownUntil - now);
    }

    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < minDelayMs) {
      await sleep(minDelayMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async applyRateLimitCooldown(response: Response, attempt: number): Promise<void> {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    const waitMs = retryAfterMs ?? backoffMs(attempt);
    this.cooldownUntil = Date.now() + waitMs;
    console.error(`[bref] rate limited (${response.status}), waiting ${Math.round(waitMs / 1000)}s...`);
    await sleep(waitMs);
  }

  async fetchHtml(url: string, retries = 8): Promise<string> {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      await this.throttle();

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
          },
        });
      } catch (error) {
        if (attempt === retries) {
          const message = error instanceof Error ? error.message : String(error);
          throw new BrefClientError(message);
        }
        await sleep(backoffMs(attempt, 2000));
        continue;
      }

      if (response.status === 429 || response.status === 503) {
        if (attempt < retries) {
          await this.applyRateLimitCooldown(response, attempt);
          continue;
        }
      } else if (response.status >= 500) {
        if (attempt < retries) {
          await sleep(backoffMs(attempt, 3000));
          continue;
        }
      }

      if (!response.ok) {
        throw new BrefClientError(`BRef fetch failed (${response.status}): ${url}`);
      }

      return await response.text();
    }

    throw new BrefClientError(`Failed to fetch ${url}`);
  }

  playerUrl(slug: string): string {
    const letter = slug.slice(0, 1).toLowerCase();
    return `https://www.basketball-reference.com/players/${letter}/${slug}.html`;
  }

  indexUrl(letter: string): string {
    return `https://www.basketball-reference.com/players/${letter.toLowerCase()}/`;
  }

  async listSlugsForLetter(letter: string): Promise<string[]> {
    const html = await this.fetchHtml(this.indexUrl(letter));
    const slugs = new Set<string>();

    for (const match of html.matchAll(/data-append-csv="([a-z0-9]+)"/gi)) {
      slugs.add(match[1].toLowerCase());
    }

    for (const match of html.matchAll(/href="\/players\/[a-z]\/([a-z0-9]+)\.html"/gi)) {
      slugs.add(match[1].toLowerCase());
    }

    return [...slugs].sort();
  }

  async listAllSlugs(): Promise<string[]> {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const all = new Set<string>();

    for (const letter of letters) {
      await this.throttle(this.indexDelayMs);
      const slugs = await this.listSlugsForLetter(letter);
      for (const slug of slugs) all.add(slug);
      console.log(`[index] ${letter.toUpperCase()}: ${slugs.length} players`);
    }

    return [...all].sort();
  }

  async parsePlayerPage(slug: string, html?: string): Promise<BrefPlayerBio> {
    const pageHtml = html ?? (await this.fetchHtml(this.playerUrl(slug)));
    const { load } = await import("cheerio");
    const $ = load(pageHtml);

    const displayName =
      $("#meta h1 span").first().text().trim() ||
      $("#meta h1").first().text().trim() ||
      slug;

    const birthDate = $("#necro-birth").attr("data-birth")?.trim() || null;

    let position: string | null = null;
    $("#meta p").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (/^Position:/i.test(text)) {
        position = text.replace(/^Position:\s*/i, "").split("▪")[0]?.trim() || null;
      }
    });

    let heightRaw: string | null = null;
    let weightRaw: string | null = null;
    $("#meta p").each((_, el) => {
      const heightSpan = $(el).find("span").first().text().trim();
      const weightSpan = $(el).find("span").eq(1).text().trim();
      if (/^\d-\d/.test(heightSpan) && /lb/i.test(weightSpan)) {
        heightRaw = heightSpan;
        weightRaw = weightSpan.replace(/lb/i, "").trim();
      }
    });

    let hometown: string | null = null;
    let country: string | null = null;

    $("#meta p").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!/^Born:/i.test(text)) return;

      const flagClass = $(el).find("[class*='f-i']").attr("class") ?? "";
      country = countryFromFlagClass(flagClass);

      const bornText = text.replace(/\s+[a-z]{2}\s*$/i, "").trim();
      const bornLocation = parseBornParagraph(bornText);
      hometown = bornLocation.hometown;
      if (!country) country = bornLocation.country;
    });

    if (!hometown || !country) {
      const jsonLd = parseJsonLdBirthPlace(pageHtml);
      hometown = hometown ?? jsonLd.hometown;
      country = country ?? jsonLd.country;
    }

    let jerseyNumber: string | null = null;
    const jerseyText = $(".uni_holder > a.default svg.jersey text").first().text().trim();
    if (jerseyText) jerseyNumber = jerseyText;

    const headshotUrl =
      $("#meta .media-item img").first().attr("src")?.trim() ||
      $('meta[property="og:image"]').attr("content")?.trim() ||
      null;

    return {
      slug,
      displayName,
      birthDate,
      position: normalizePosition(position),
      heightCm: heightToCm(heightRaw),
      weightKg: weightToKg(weightRaw),
      jerseyNumber,
      hometown,
      country,
      headshotUrl,
    };
  }
}
