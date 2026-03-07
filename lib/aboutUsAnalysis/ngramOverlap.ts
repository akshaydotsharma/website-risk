import { tokenize } from "./textNormalization";

/**
 * Extract n-gram sequences from tokenized text.
 * Returns a Set of n-gram strings (space-joined).
 */
function extractNgrams(tokens: string[], n: number): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.add(tokens.slice(i, i + n).join(" "));
  }
  return ngrams;
}

/**
 * Compute Jaccard similarity between two n-gram sets.
 * |intersection| / |union|, returns 0-100.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const ng of smaller) {
    if (larger.has(ng)) intersection++;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return (intersection / union) * 100;
}

/**
 * Compute n-gram overlap score between two texts.
 * Uses a blend of 3-gram and 4-gram Jaccard similarity.
 * This captures shared phrases/structure rather than just shared vocabulary.
 *
 * Returns 0-100.
 */
export function computeNgramOverlap(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.length < 4 || tokensB.length < 4) return 0;

  const trigramsA = extractNgrams(tokensA, 3);
  const trigramsB = extractNgrams(tokensB, 3);
  const quadgramsA = extractNgrams(tokensA, 4);
  const quadgramsB = extractNgrams(tokensB, 4);

  const trigramScore = jaccardSimilarity(trigramsA, trigramsB);
  const quadgramScore = jaccardSimilarity(quadgramsA, quadgramsB);

  // Blend: 4-grams weighted more (more specific phrases = stronger authorship signal)
  return Math.round(trigramScore * 0.4 + quadgramScore * 0.6);
}

/**
 * Compute all-pairs n-gram overlap scores.
 * Returns Map<"domainAId|domainBId", score (0-100)>.
 */
export function computePairwiseNgramScores(
  documents: Map<string, string>
): Map<string, number> {
  const ids = Array.from(documents.keys()).sort();
  const scores = new Map<string, number>();

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const score = computeNgramOverlap(
        documents.get(ids[i])!,
        documents.get(ids[j])!
      );
      scores.set(`${ids[i]}|${ids[j]}`, score);
    }
  }

  return scores;
}
