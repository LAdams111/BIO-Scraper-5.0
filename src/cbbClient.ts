import { BrefClient, BrefClientError } from "./brefClient.js";
import type { BrefPlayerBio } from "./types.js";
import { nameToCbbSlugCandidates } from "./utils/bio.js";
import { normalizeName } from "./scrape/checkpoint.js";

export class CbbClient extends BrefClient {
  constructor(requestDelayMs: number, indexDelayMs = 10_000) {
    super(requestDelayMs, indexDelayMs, "cbb/players", () => true, {
      baseUrl: "https://www.sports-reference.com",
      flatPlayerPaths: true,
      indexSuffix: "-index.html",
    });
  }

  protected override extractSlugsFromIndexHtml(html: string): string[] {
    const slugs = new Set<string>();
    const pathPattern = this.playersPath.replace("/", "\\/");

    for (const match of html.matchAll(
      new RegExp(`href="/${pathPattern}/([a-z0-9-]+)\\.html"`, "gi"),
    )) {
      const slug = match[1].toLowerCase();
      if (!slug.endsWith("-index")) this.addSlug(slugs, slug);
    }

    return [...slugs].sort();
  }

  async resolveSlugByName(displayName: string): Promise<string | null> {
    for (const slug of nameToCbbSlugCandidates(displayName)) {
      try {
        const bio = await this.parsePlayerPage(slug);
        if (normalizeName(bio.displayName) === normalizeName(displayName)) {
          return slug;
        }
      } catch (error) {
        if (error instanceof BrefClientError) continue;
        throw error;
      }
    }

    return null;
  }

  async scrapeBioForName(displayName: string): Promise<BrefPlayerBio | null> {
    const slug = await this.resolveSlugByName(displayName);
    if (!slug) return null;
    return this.parsePlayerPage(slug);
  }
}
