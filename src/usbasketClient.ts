import { parseUsbasketBioFromHtml, type UsbasketPlayerBio } from "./usbasket/playerMeta.js";
import { resolveJerseyFromRosters } from "./usbasket/rosterJersey.js";
import { backoffMs, jitterMs, parseRetryAfterMs, sleep } from "./utils/rateLimiter.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; HoopCentralBioScraper/1.0; +https://github.com/hoopcentral)";

export class UsbasketClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsbasketClientError";
  }
}

export class UsbasketRateLimitError extends UsbasketClientError {}

export function usbasketPlayerUrl(playerId: string, displayName: string): string {
  const slug = displayName
    .trim()
    .replace(/&quote;/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^0-9a-z-]/gi, "-")
    .replace(/-+$/, "")
    .replace(/^-+/, "");
  return `https://basketball.usbasket.com/player/${slug}/${playerId}`;
}

export class UsbasketClient {
  private lastRequestAt = 0;
  private cooldownUntil = 0;
  private penaltyDelayMs = 0;

  constructor(private readonly requestDelayMs: number) {}

  private effectiveDelay(): number {
    return this.requestDelayMs + this.penaltyDelayMs + jitterMs(1000);
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    if (now < this.cooldownUntil) {
      await sleep(this.cooldownUntil - now);
    }

    const elapsed = Date.now() - this.lastRequestAt;
    const targetDelay = this.effectiveDelay();
    if (elapsed < targetDelay) {
      await sleep(targetDelay - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  async fetchHtml(url: string, retries = 6): Promise<string> {
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
          throw new UsbasketClientError(message);
        }
        await sleep(backoffMs(attempt, 2000));
        continue;
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
        const waitMs = retryAfterMs ?? backoffMs(attempt);
        this.cooldownUntil = Date.now() + waitMs;
        this.penaltyDelayMs = Math.min(15_000, this.penaltyDelayMs + 2000);
        if (attempt < retries) continue;
        throw new UsbasketRateLimitError(`USBasket rate limited (${response.status}): ${url}`);
      }

      if (!response.ok) {
        throw new UsbasketClientError(`USBasket fetch failed (${response.status}): ${url}`);
      }

      return await response.text();
    }

    throw new UsbasketClientError(`Failed to fetch ${url}`);
  }

  async parsePlayerBio(
    externalId: string,
    displayName: string,
    fallbackPosition?: string | null,
  ): Promise<UsbasketPlayerBio> {
    const html = await this.fetchHtml(usbasketPlayerUrl(externalId, displayName));
    const bio = parseUsbasketBioFromHtml(html, externalId, displayName, fallbackPosition ?? null);

    if (!bio.jerseyNumber) {
      const rosterJersey = await resolveJerseyFromRosters(
        (url) => this.fetchHtml(url),
        html,
        externalId,
      );
      if (rosterJersey) {
        bio.jerseyNumber = rosterJersey;
      }
    }

    return bio;
  }
}
