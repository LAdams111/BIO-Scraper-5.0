/** Placeholder values Hoop Central uses for missing profile fields. */
const PLACEHOLDER_VALUES = new Set(["—", "-", "n/a", "na", "unknown"]);

export function isPlaceholder(value: string | null | undefined): boolean {
  if (!value?.trim()) return true;
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

export interface HcProfileFields {
  height?: string | null;
  weight?: string | null;
  position?: string | null;
  hometown?: string | null;
  country?: string | null;
  headshotUrl?: string | null;
  jerseyNumber?: string | null;
  birthDate?: string | null;
}

const US_REGION_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
]);

const CANADA_REGION_CODES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

/** Infer country from a hometown string like "Chesterland, OH" or "Toronto, ON". */
export function inferCountryFromLocation(location: string | null | undefined): string | null {
  if (!location?.trim()) return null;

  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const region = parts[parts.length - 1].toUpperCase();
  if (US_REGION_CODES.has(region)) return "United States";
  if (CANADA_REGION_CODES.has(region)) return "Canada";

  return null;
}

/** Skip players who already have a filled-out profile (e.g. Seth Curry with NBA + NCAA). */
export function isBioComplete(profile: HcProfileFields): boolean {
  const filled = (value: string | null | undefined) => !isPlaceholder(value);

  return (
    filled(profile.height) &&
    filled(profile.weight) &&
    filled(profile.position) &&
    filled(profile.hometown) &&
    filled(profile.birthDate)
  );
}

/** Extract a Basketball Reference NBA slug from a headshot URL. */
export function extractNbaSlugFromHeadshot(headshotUrl: string | null | undefined): string | null {
  if (!headshotUrl?.trim()) return null;
  const match = /\/headshots\/([a-z0-9]+)\.(?:jpg|png|webp)/i.exec(headshotUrl);
  return match?.[1]?.toLowerCase() ?? null;
}

function slugifyNamePart(part: string): string {
  return part
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build likely Sports Reference CBB slugs (`firstname-lastname-1`, etc.). */
export function nameToCbbSlugCandidates(displayName: string, maxSuffix = 5): string[] {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .map(slugifyNamePart)
    .filter(Boolean);

  if (parts.length < 2) return [];

  const first = parts[0];
  const last = parts[parts.length - 1];
  const candidates: string[] = [];

  for (let suffix = 1; suffix <= maxSuffix; suffix += 1) {
    candidates.push(`${first}-${last}-${suffix}`);
  }

  return candidates;
}
