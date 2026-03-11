/**
 * Shared text analysis utilities used by similarity-tabs, analysis-result-tabs,
 * and other components that compare page content.
 */

/** Normalize a sentence to a lowercase fingerprint for dedup/matching. */
export function fingerprint(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Split text into sentences (min 10 chars each). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/** Normalize whitespace in about/page text. */
export function cleanAboutText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "shall",
  "can", "not", "no", "we", "our", "us", "you", "your", "they", "their",
  "them", "he", "she", "his", "her", "its", "all", "each", "every",
  "any", "some", "as", "so", "if", "than", "more", "also", "very",
  "just", "about", "over", "such", "into", "through", "after", "before",
  "between", "under", "above", "up", "out", "off", "down", "then",
  "here", "there", "when", "where", "how", "what", "which", "who",
  "whom", "why", "while", "during", "because", "both", "many",
]);

function tokenize(t: string): string[] {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

/** Find keywords shared between two texts (excludes stop words, min 4 chars). */
export function getSharedKeywords(textA: string, textB: string): Set<string> {
  const wordsA = new Set(tokenize(textA));
  const wordsB = new Set(tokenize(textB));
  const shared = new Set<string>();
  for (const w of wordsA) {
    if (wordsB.has(w)) shared.add(w);
  }
  return shared;
}
