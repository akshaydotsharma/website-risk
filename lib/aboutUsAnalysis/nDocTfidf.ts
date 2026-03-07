import { tokenize } from "./textNormalization";

/**
 * Build corpus-wide IDF from N documents.
 * IDF(term) = log((N + 1) / (df(term) + 1)) + 1
 */
export function buildCorpusIDF(
  documents: Map<string, string>
): Map<string, number> {
  const N = documents.size;
  const df = new Map<string, number>(); // document frequency per term

  for (const [, text] of documents) {
    const uniqueTokens = new Set(tokenize(text));
    for (const token of uniqueTokens) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }

  return idf;
}

/**
 * Compute TF-IDF vector for a single document given corpus-wide IDF.
 */
function computeTFIDFVector(
  text: string,
  idf: Map<string, number>
): Map<string, number> {
  const tokens = tokenize(text);
  const totalTokens = tokens.length;
  if (totalTokens === 0) return new Map();

  // Term frequency
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  // TF-IDF
  const tfidf = new Map<string, number>();
  for (const [term, count] of tf) {
    const tfVal = count / totalTokens;
    const idfVal = idf.get(term) || 1;
    tfidf.set(term, tfVal * idfVal);
  }

  return tfidf;
}

/**
 * Cosine similarity between two sparse TF-IDF vectors.
 */
function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  // Use the smaller map for iteration
  for (const [term, valA] of a) {
    normA += valA * valA;
    const valB = b.get(term);
    if (valB !== undefined) {
      dotProduct += valA * valB;
    }
  }

  for (const [, valB] of b) {
    normB += valB * valB;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Compute all-pairs TF-IDF cosine similarity scores.
 * Returns Map<"domainAId|domainBId", score (0-100)> where keys
 * are lexicographically ordered.
 */
export function computePairwiseScores(
  documents: Map<string, string>,
  idf: Map<string, number>
): Map<string, number> {
  const ids = Array.from(documents.keys()).sort();
  const vectors = new Map<string, Map<string, number>>();

  // Pre-compute all vectors
  for (const id of ids) {
    vectors.set(id, computeTFIDFVector(documents.get(id)!, idf));
  }

  // Compute all pairs
  const scores = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const cosine = cosineSimilarity(vectors.get(ids[i])!, vectors.get(ids[j])!);
      const score = Math.round(Math.max(0, Math.min(100, cosine * 100)));
      scores.set(`${ids[i]}|${ids[j]}`, score);
    }
  }

  return scores;
}
