import { extractSentences, normalizeForAnalysis } from "./textNormalization";

/**
 * Fingerprint a sentence by normalizing it to a canonical form:
 * lowercase, strip punctuation, collapse whitespace.
 */
function fingerprintSentence(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find shared sentences across a set of domain texts.
 *
 * Returns a Map keyed by "domainAId|domainBId" (lexicographic order)
 * → array of shared sentence strings (original form from first domain seen).
 */
export function findSharedSentences(
  textsMap: Map<string, string>
): Map<string, string[]> {
  // fingerprint → { original sentence, set of domainIds that contain it }
  const fingerprintIndex = new Map<
    string,
    { original: string; domains: Set<string> }
  >();

  for (const [domainId, text] of textsMap) {
    const normalized = normalizeForAnalysis(text);
    const sentences = extractSentences(normalized);

    for (const sentence of sentences) {
      const fp = fingerprintSentence(sentence);
      if (fp.length < 20) continue; // skip very short fingerprints

      const entry = fingerprintIndex.get(fp);
      if (entry) {
        entry.domains.add(domainId);
      } else {
        fingerprintIndex.set(fp, {
          original: sentence,
          domains: new Set([domainId]),
        });
      }
    }
  }

  // Group shared sentences by domain pair
  const pairMap = new Map<string, string[]>();

  for (const [, { original, domains }] of fingerprintIndex) {
    if (domains.size < 2) continue;

    const domainArr = Array.from(domains).sort();
    // Generate all pairs from domains sharing this sentence
    for (let i = 0; i < domainArr.length; i++) {
      for (let j = i + 1; j < domainArr.length; j++) {
        const pairKey = `${domainArr[i]}|${domainArr[j]}`;
        const existing = pairMap.get(pairKey) || [];
        existing.push(original);
        pairMap.set(pairKey, existing);
      }
    }
  }

  return pairMap;
}
