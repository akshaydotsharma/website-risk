/**
 * Normalize text for analysis: lowercase, collapse whitespace, strip noise.
 */
export function normalizeForAnalysis(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract meaningful sentences from text.
 * Splits on sentence-ending punctuation and newlines, filters out
 * very short fragments (< 5 words).
 */
export function extractSentences(text: string): string[] {
  // Split on sentence terminators
  const raw = text
    .split(/[.!?]+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentences: string[] = [];
  for (const s of raw) {
    const cleaned = s
      .replace(/\s+/g, " ")
      .trim();
    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount >= 5) {
      sentences.push(cleaned);
    }
  }

  return sentences;
}

/**
 * Tokenize text into lowercase words (> 2 chars).
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}
