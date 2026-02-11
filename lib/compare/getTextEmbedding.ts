import { prisma } from "@/lib/prisma";

// =============================================================================
// TF-IDF Based Text Vectorization (No External API Required)
// =============================================================================

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2); // Filter out very short words
}

/**
 * Calculate term frequency (TF) for a document
 */
function calculateTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const totalTokens = tokens.length;

  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  // Normalize by total tokens
  for (const [term, count] of tf) {
    tf.set(term, count / totalTokens);
  }

  return tf;
}

/**
 * Calculate IDF using a simple smoothed version
 * Since we're comparing just 2 documents, we use a simplified approach
 */
function calculateIDF(
  term: string,
  doc1Tokens: Set<string>,
  doc2Tokens: Set<string>
): number {
  const numDocs = 2;
  let docsWithTerm = 0;
  if (doc1Tokens.has(term)) docsWithTerm++;
  if (doc2Tokens.has(term)) docsWithTerm++;

  // Smoothed IDF to avoid division by zero
  return Math.log((numDocs + 1) / (docsWithTerm + 1)) + 1;
}

/**
 * Generate TF-IDF vector for text
 * Returns a sparse vector as a Map for efficiency
 */
export function generateTFIDFVector(
  text: string,
  otherText: string
): Map<string, number> {
  const tokens = tokenize(text);
  const otherTokens = tokenize(otherText);

  const doc1Set = new Set(tokens);
  const doc2Set = new Set(otherTokens);

  const tf = calculateTF(tokens);
  const tfidf = new Map<string, number>();

  for (const [term, tfValue] of tf) {
    const idf = calculateIDF(term, doc1Set, doc2Set);
    tfidf.set(term, tfValue * idf);
  }

  return tfidf;
}

/**
 * Convert sparse vector map to dense array for a given vocabulary
 */
function vectorToArray(
  vector: Map<string, number>,
  vocabulary: string[]
): number[] {
  return vocabulary.map((term) => vector.get(term) || 0);
}

/**
 * Calculate cosine similarity between two TF-IDF vectors
 */
export function calculateTFIDFSimilarity(
  text1: string,
  text2: string
): number {
  if (!text1 || !text2 || text1.trim().length === 0 || text2.trim().length === 0) {
    return 0;
  }

  const vector1 = generateTFIDFVector(text1, text2);
  const vector2 = generateTFIDFVector(text2, text1);

  // Build combined vocabulary
  const vocabulary = Array.from(
    new Set([...vector1.keys(), ...vector2.keys()])
  );

  // Convert to dense arrays
  const arr1 = vectorToArray(vector1, vocabulary);
  const arr2 = vectorToArray(vector2, vocabulary);

  // Calculate cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vocabulary.length; i++) {
    dotProduct += arr1[i] * arr2[i];
    norm1 += arr1[i] * arr1[i];
    norm2 += arr2[i] * arr2[i];
  }

  const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Generate a simple hash-based "embedding" for storage
 * This stores key statistics for later comparison without external APIs
 */
export function generateTextSignature(text: string): number[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const tokens = tokenize(text);
  const uniqueTokens = new Set(tokens);

  // Create a simple statistical signature
  const signature: number[] = [
    tokens.length, // Total word count
    uniqueTokens.size, // Vocabulary size
    uniqueTokens.size / Math.max(tokens.length, 1), // Lexical diversity
  ];

  // Add character-level statistics
  const textLower = text.toLowerCase();
  signature.push(
    (textLower.match(/[aeiou]/g) || []).length / text.length, // Vowel ratio
    (textLower.match(/[0-9]/g) || []).length / text.length // Digit ratio
  );

  // Add top term frequencies (simplified feature vector)
  const tf = calculateTF(tokens);
  const sortedTerms = Array.from(tf.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  for (const [, freq] of sortedTerms) {
    signature.push(freq);
  }

  // Pad to consistent length
  while (signature.length < 55) {
    signature.push(0);
  }

  return signature.slice(0, 55);
}

/**
 * Generate text embedding (actually a TF-IDF signature for storage)
 * This is stored for potential future use and fast retrieval
 */
export async function generateTextEmbedding(
  text: string
): Promise<number[] | null> {
  if (!text || text.trim().length === 0) {
    return null;
  }

  return generateTextSignature(text);
}

/**
 * Get or create embedding for an artifact
 */
export async function getOrCreateEmbedding(
  artifactId: string,
  textSnippet: string | null
): Promise<number[] | null> {
  // Check if artifact already has embedding
  const artifact = await prisma.homepageArtifact.findUnique({
    where: { id: artifactId },
    select: { embedding: true },
  });

  if (artifact?.embedding) {
    try {
      return JSON.parse(artifact.embedding);
    } catch {
      // Invalid JSON, regenerate
    }
  }

  // Generate new embedding
  if (!textSnippet) {
    return null;
  }

  const embedding = await generateTextEmbedding(textSnippet);

  if (embedding) {
    // Save to artifact
    await prisma.homepageArtifact.update({
      where: { id: artifactId },
      data: { embedding: JSON.stringify(embedding) },
    });
  }

  return embedding;
}

/**
 * Calculate text similarity between two text snippets
 * This is the main function used for scoring
 */
export function calculateTextSimilarityScore(
  textA: string | null,
  textB: string | null
): number {
  if (!textA || !textB) {
    return 0;
  }

  const tfidfSimilarity = calculateTFIDFSimilarity(textA, textB);

  // Scale to 0-100
  return Math.round(Math.max(0, Math.min(100, tfidfSimilarity * 100)));
}
