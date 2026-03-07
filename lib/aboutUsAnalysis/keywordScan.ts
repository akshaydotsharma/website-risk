import type { KeywordHit } from "./schemas";

/**
 * Suspicious keywords commonly found in templated/dropship/fake "About Us" pages.
 * Each entry is lowercase for case-insensitive matching.
 */
const SUSPICIOUS_KEYWORDS: string[] = [
  "lowest price",
  "best quality",
  "factory direct",
  "dropship",
  "dropshipping",
  "wholesale",
  "oem",
  "odm",
  "one-stop",
  "one stop",
  "professional manufacturer",
  "years of experience",
  "customer satisfaction",
  "high quality products",
  "competitive price",
  "fast delivery",
  "fast shipping",
  "worldwide shipping",
  "money back guarantee",
  "100% satisfaction",
  "trusted supplier",
  "global supplier",
  "alibaba",
  "made in china",
  "our factory",
  "our warehouse",
  "direct from manufacturer",
  "bulk order",
  "bulk discount",
];

/**
 * Scan text for suspicious keywords.
 * Returns an array of { keyword, count } for keywords found at least once.
 * Matching is case-insensitive, whole-phrase (not word-boundary restricted
 * to avoid missing multi-word phrases).
 */
export function scanKeywords(text: string): KeywordHit[] {
  const lower = text.toLowerCase();
  const hits: KeywordHit[] = [];

  for (const keyword of SUSPICIOUS_KEYWORDS) {
    let count = 0;
    let idx = 0;
    while ((idx = lower.indexOf(keyword, idx)) !== -1) {
      count++;
      idx += keyword.length;
    }
    if (count > 0) {
      hits.push({ keyword, count });
    }
  }

  return hits;
}
