import { load } from "cheerio";
import { normalizePosition } from "../utils/physical.js";
import { inferCountryFromLocation } from "../utils/bio.js";

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export interface UsbasketPlayerBio {
  externalId: string;
  displayName: string;
  birthDate: string | null;
  position: string | null;
  heightCm: number | null;
  weightKg: number | null;
  jerseyNumber: string | null;
  hometown: string | null;
  country: string | null;
}

/** "Nov.16, 2006" / "March 24 1991" → "2006-11-16" */
export function parseUsbasketBirthDate(raw: string): string | null {
  const match = /([A-Za-z]+)\.?\s*(\d{1,2}),?\s+(\d{4})/.exec(raw.trim());
  if (!match) return null;

  const monthKey = match[1].toLowerCase().replace(/\./g, "");
  const month = MONTHS[monthKey];
  if (!month) return null;

  const day = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function extractBirthDateFromText(text: string): string | null {
  const bornOn = /born on\s+([A-Za-z]+\.?\s*\d{1,2},?\s*\d{4})/i.exec(text);
  if (bornOn) return parseUsbasketBirthDate(bornOn[1]);

  const faqBorn = /was born on\s+([A-Za-z]+\.?\s*\d{1,2},?\s*\d{4})/i.exec(text);
  if (faqBorn) return parseUsbasketBirthDate(faqBorn[1]);

  return null;
}

function extractHometown(text: string): string | null {
  const bornIn = /born in\s+([^.<]+?)(?:\.|\s+He\s|\s+She\s|$)/i.exec(text);
  if (bornIn) return bornIn[1].replace(/\s+/g, " ").trim();

  const faq = /Where was [^?]+\?<\/h3><p>[^<]+ was born in\s+([^.<]+)/i.exec(text);
  if (faq) return faq[1].replace(/\s+/g, " ").trim();

  return null;
}

function extractHeightCm(text: string): number | null {
  const cm = /(\d{3})\s*cm/i.exec(text);
  if (cm) {
    const parsed = Number.parseInt(cm[1], 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const feet = /(\d)'(\d{1,2})/.exec(text);
  if (feet) {
    const totalInches = Number.parseInt(feet[1], 10) * 12 + Number.parseInt(feet[2], 10);
    return Math.round(totalInches * 2.54);
  }

  return null;
}

export function extractJerseyNumber(html: string, text: string): string | null {
  const patterns = [
    /Uniform\s*#\s*:?\s*(\d{1,2})\b/i,
    /Uniform\s*:\s*(\d{1,2})\b/i,
    /Jersey\s*#\s*:?\s*(\d{1,2})\b/i,
    /What number did[^?]+\?<\/h3><p>[^<]*?\b(\d{1,2})\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html) ?? pattern.exec(text);
    if (match) return match[1];
  }

  const $ = load(html);
  for (const selector of [".smallerwidthplayerleftinner", ".player-details"]) {
    const blockText = $(selector).first().text().replace(/\s+/g, " ");
    const labelMatch = /Uniform\s*#\s*:?\s*(\d{1,2})\b/i.exec(blockText);
    if (labelMatch) return labelMatch[1];
  }

  return null;
}

function extractWeightKg(text: string): number | null {
  const kg = /(\d{2,3})\s*kg/i.exec(text);
  if (kg) {
    const parsed = Number.parseInt(kg[1], 10);
    return Number.isNaN(parsed) ? null : Math.round(parsed);
  }

  const lbs = /(\d{2,3})\s*lbs/i.exec(text);
  if (lbs) {
    const parsed = Number.parseInt(lbs[1], 10);
    return Number.isNaN(parsed) ? null : Math.round(parsed * 0.453592);
  }

  return null;
}

function titleCaseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractDisplayName(html: string, playerId: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();

  const titleMatch = /<h1[^>]*class="[^"]*player-title[^"]*"[^>]*>([^<]+)/i.exec(html);
  if (titleMatch) {
    const raw = titleMatch[1].replace(/basketball player profile/i, "").trim();
    if (raw) return titleCaseName(raw);
  }

  return `Player ${playerId}`;
}

export function parseUsbasketBioFromHtml(
  html: string,
  externalId: string,
  fallbackDisplayName?: string,
  fallbackPosition?: string | null,
): UsbasketPlayerBio {
  const $ = load(html);
  const bodyText = $("body").text();
  const faqHtml = $("#div_faq").html() ?? "";
  const combined = `${bodyText} ${faqHtml}`;

  const displayName = extractDisplayName(html, externalId, fallbackDisplayName);

  let position = fallbackPosition ?? null;
  const positionMatch = /What position did[^?]+\?<\/h3><p>([^.<]+)/i.exec(html);
  if (positionMatch) {
    position = positionMatch[1].trim() || position;
  }

  const hometown = extractHometown(combined);
  const jerseyNumber = extractJerseyNumber(html, combined);

  return {
    externalId,
    displayName,
    birthDate: extractBirthDateFromText(combined),
    position: normalizePosition(position),
    heightCm: extractHeightCm(combined),
    weightKg: extractWeightKg(combined),
    jerseyNumber,
    hometown,
    country: inferCountryFromLocation(hometown),
  };
}
