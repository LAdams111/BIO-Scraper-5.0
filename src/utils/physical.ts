/** Parse height strings like "6-9" or "6'9" into centimeters. */
export function heightToCm(height: string | null | undefined): number | null {
  if (!height?.trim()) return null;

  const normalized = height.trim().replace(/['"]/g, "-");
  const match = /^(\d+)\s*[-]\s*(\d+(?:\.\d+)?)$/.exec(normalized);
  if (!match) return null;

  const feet = Number(match[1]);
  const inches = Number(match[2]);
  if (Number.isNaN(feet) || Number.isNaN(inches)) return null;

  const totalInches = feet * 12 + inches;
  return Math.round(totalInches * 2.54);
}

/** Parse weight in pounds to kilograms. */
export function weightToKg(weightLb: string | null | undefined): number | null {
  if (!weightLb?.trim()) return null;

  const pounds = Number.parseFloat(weightLb.replace(/lb/i, "").trim());
  if (Number.isNaN(pounds)) return null;

  return Math.round(pounds * 0.453592);
}

const POSITION_MAP: Record<string, string> = {
  "POINT GUARD": "PG",
  "SHOOTING GUARD": "SG",
  "SMALL FORWARD": "SF",
  "POWER FORWARD": "PF",
  CENTER: "C",
  GUARD: "G",
  FORWARD: "F",
  "GUARD-FORWARD": "G-F",
  "FORWARD-CENTER": "F-C",
  "FORWARD-GUARD": "F-G",
  "CENTER-FORWARD": "C-F",
};

/** Normalize BRef position text to short labels when possible. */
export function normalizePosition(position: string | null | undefined): string | null {
  if (!position?.trim()) return null;
  const trimmed = position.trim();
  const upper = trimmed.toUpperCase();

  if (POSITION_MAP[upper]) return POSITION_MAP[upper];
  if (/^(PG|SG|SF|PF|C|G|F|G-F|F-G|F-C|C-F)$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const first = upper.split(/[-/]/)[0]?.trim();
  if (first && POSITION_MAP[first]) return POSITION_MAP[first];
  if (first && /^(PG|SG|SF|PF|C|G|F)$/i.test(first)) return first.toUpperCase();

  return trimmed;
}
