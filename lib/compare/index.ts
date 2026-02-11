import { prisma } from "@/lib/prisma";
import { getOrCreateArtifact } from "./extractHomepageArtifact";
import { calculateTextSimilarityScore } from "./getTextEmbedding";
import {
  calculateDomScore,
  calculateOverallScore,
  calculateConfidence,
  generateReasons,
  generateFeatureDiff,
} from "./scoreSimilarity";
import type { ComparisonResult, HomepageFeatures } from "./schemas";

// Re-export types and functions
export * from "./schemas";
export { extractHomepageArtifact, getOrCreateArtifact } from "./extractHomepageArtifact";
export { calculateTextSimilarityScore, calculateTFIDFSimilarity } from "./getTextEmbedding";
export {
  cosineSimilarity,
  jaccardSimilarity,
  calculateDomScore,
  calculateOverallScore,
  calculateConfidence,
  generateReasons,
  generateFeatureDiff,
} from "./scoreSimilarity";

/**
 * Run a full homepage comparison between two URLs
 */
export async function runHomepageComparison(
  urlA: string,
  urlB: string
): Promise<{ comparisonId: string; result: ComparisonResult }> {
  const startTime = Date.now();

  // 1. Extract or retrieve artifacts for both URLs in parallel
  const [resultA, resultB] = await Promise.all([
    getOrCreateArtifact(urlA),
    getOrCreateArtifact(urlB),
  ]);

  const { artifact: artifactA, artifactId: artifactAId } = resultA;
  const { artifact: artifactB, artifactId: artifactBId } = resultB;

  // 2. Calculate text similarity directly using TF-IDF (no external API needed)
  const textScore = calculateTextSimilarityScore(
    artifactA.textSnippet,
    artifactB.textSnippet
  );
  const domScore = calculateDomScore(artifactA.features, artifactB.features);
  const overallScore = calculateOverallScore(textScore, domScore);

  // 4. Calculate confidence
  const confidence = calculateConfidence({
    artifactAOk: artifactA.ok,
    artifactBOk: artifactB.ok,
    blockedReasonA: artifactA.features?.blockedReason || null,
    blockedReasonB: artifactB.features?.blockedReason || null,
    wordCountA: artifactA.features?.wordCount || 0,
    wordCountB: artifactB.features?.wordCount || 0,
    hasTextA: !!artifactA.textSnippet && artifactA.textSnippet.length > 0,
    hasTextB: !!artifactB.textSnippet && artifactB.textSnippet.length > 0,
  });

  // 5. Generate reasons
  const reasons = generateReasons({
    textScore,
    domScore,
    confidence,
    featuresA: artifactA.features,
    featuresB: artifactB.features,
    hasTextA: !!artifactA.textSnippet && artifactA.textSnippet.length > 0,
    hasTextB: !!artifactB.textSnippet && artifactB.textSnippet.length > 0,
  });

  // 6. Generate feature diff for UI
  const featureDiff = generateFeatureDiff(
    artifactA.features,
    artifactB.features,
    artifactA.finalUrl,
    artifactB.finalUrl,
    artifactA.statusCode,
    artifactB.statusCode
  );

  // 7. Save comparison to database
  const comparison = await prisma.homepageComparison.create({
    data: {
      urlA: artifactA.url,
      urlB: artifactB.url,
      artifactAId,
      artifactBId,
      overallScore,
      textScore,
      domScore,
      confidence,
      reasons: JSON.stringify(reasons),
      featureDiff: JSON.stringify(featureDiff),
    },
  });

  const processingTimeMs = Date.now() - startTime;
  console.log(
    `[Compare] Comparison ${comparison.id} completed in ${processingTimeMs}ms: ` +
      `overall=${overallScore}, text=${textScore}, dom=${domScore}, confidence=${confidence}`
  );

  return {
    comparisonId: comparison.id,
    result: {
      comparisonId: comparison.id,
      urlA: artifactA.url,
      urlB: artifactB.url,
      overallScore,
      textScore,
      domScore,
      confidence,
      reasons,
      featureDiff,
      artifactA,
      artifactB,
    },
  };
}

/**
 * Get an existing comparison by ID
 */
export async function getComparison(id: string): Promise<ComparisonResult | null> {
  const comparison = await prisma.homepageComparison.findUnique({
    where: { id },
    include: {
      artifactA: true,
      artifactB: true,
    },
  });

  if (!comparison) {
    return null;
  }

  // Parse JSON fields
  const reasons = comparison.reasons ? JSON.parse(comparison.reasons) : [];
  const featureDiff = comparison.featureDiff
    ? JSON.parse(comparison.featureDiff)
    : null;

  // Parse artifact features and embeddings
  const parseArtifactFeatures = (artifact: typeof comparison.artifactA) => {
    const features = artifact.features
      ? (JSON.parse(artifact.features) as HomepageFeatures)
      : null;
    const embedding = artifact.embedding
      ? (JSON.parse(artifact.embedding) as number[])
      : null;
    const redirectChain = artifact.redirectChain
      ? (JSON.parse(artifact.redirectChain) as string[])
      : [];

    return {
      url: artifact.url,
      finalUrl: artifact.finalUrl,
      domain: artifact.domain,
      fetchMethod: artifact.fetchMethod,
      statusCode: artifact.statusCode,
      contentType: artifact.contentType,
      ok: artifact.ok,
      redirectChain,
      latencyMs: artifact.latencyMs,
      bytes: artifact.bytes,
      htmlSha256: artifact.htmlSha256,
      textSha256: artifact.textSha256,
      htmlSnippet: artifact.htmlSnippet,
      textSnippet: artifact.textSnippet,
      features,
      embedding,
    };
  };

  return {
    comparisonId: comparison.id,
    urlA: comparison.urlA,
    urlB: comparison.urlB,
    overallScore: comparison.overallScore,
    textScore: comparison.textScore,
    domScore: comparison.domScore,
    confidence: comparison.confidence,
    reasons,
    featureDiff,
    artifactA: parseArtifactFeatures(comparison.artifactA),
    artifactB: parseArtifactFeatures(comparison.artifactB),
  };
}
