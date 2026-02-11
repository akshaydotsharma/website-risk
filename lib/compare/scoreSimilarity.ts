import {
  type HomepageFeatures,
  type FeatureDiff,
  type PageStats,
  TRACKED_TAGS,
  SIMILARITY_WEIGHTS,
  CONFIDENCE_PENALTIES,
} from "./schemas";

// =============================================================================
// Cosine Similarity
// =============================================================================

/**
 * Calculate cosine similarity between two vectors
 * Returns value between 0 and 1
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// =============================================================================
// Jaccard Similarity
// =============================================================================

/**
 * Calculate Jaccard similarity between two sets
 * Returns value between 0 and 1
 */
export function jaccardSimilarity<T>(setA: Set<T>, setB: Set<T>): number {
  if (setA.size === 0 && setB.size === 0) return 1;

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

// =============================================================================
// Text Similarity Scoring
// =============================================================================

/**
 * Calculate text similarity score based on embeddings
 */
export function calculateTextScore(
  embeddingA: number[] | null,
  embeddingB: number[] | null
): number {
  if (!embeddingA || !embeddingB) {
    return 0;
  }

  const similarity = cosineSimilarity(embeddingA, embeddingB);
  // Scale to 0-100 and round
  return Math.round(Math.max(0, Math.min(100, similarity * 100)));
}

// =============================================================================
// DOM Similarity Scoring
// =============================================================================

/**
 * Build a normalized feature vector from tag counts
 */
function buildTagVector(tagCounts: Record<string, number>): number[] {
  const vector: number[] = [];

  for (const tag of TRACKED_TAGS) {
    const count = tagCounts[tag] || 0;
    // Normalize by log scale to reduce impact of very high counts
    vector.push(Math.log1p(count));
  }

  return vector;
}

/**
 * Build a scalar feature vector for DOM structure
 */
function buildStructureVector(features: HomepageFeatures): number[] {
  return [
    // Word count bucket (log scale)
    Math.log1p(features.wordCount),
    // Link count bucket (log scale)
    Math.log1p(features.linkCount),
    // Heading counts
    features.headingCounts.h1,
    features.headingCounts.h2,
    features.headingCounts.h3,
    // Form/button counts (capped)
    Math.min(features.formCount, 10),
    Math.min(features.buttonCount, 50),
    // Depth metrics
    Math.min(features.maxDepth, 30),
    features.avgDepth,
    // Image count (log scale)
    Math.log1p(features.imageCount),
  ];
}

/**
 * Calculate DOM similarity score
 */
export function calculateDomScore(
  featuresA: HomepageFeatures | null,
  featuresB: HomepageFeatures | null
): number {
  if (!featuresA || !featuresB) {
    return 0;
  }

  // 1. Tag counts similarity (40% weight)
  const tagVectorA = buildTagVector(featuresA.tagCounts);
  const tagVectorB = buildTagVector(featuresB.tagCounts);
  const tagSimilarity = cosineSimilarity(tagVectorA, tagVectorB);

  // 2. Structure similarity (30% weight)
  const structVectorA = buildStructureVector(featuresA);
  const structVectorB = buildStructureVector(featuresB);
  const structSimilarity = cosineSimilarity(structVectorA, structVectorB);

  // 3. Block structure similarity (20% weight)
  // Compare top-level body children sequence
  const blocksA = new Set(featuresA.blockStructure);
  const blocksB = new Set(featuresB.blockStructure);
  const blockSimilarity = jaccardSimilarity(blocksA, blocksB);

  // 4. Heading structure similarity (10% weight)
  const headingsA = new Set(
    featuresA.headingTexts.map((h) => h.toLowerCase().trim())
  );
  const headingsB = new Set(
    featuresB.headingTexts.map((h) => h.toLowerCase().trim())
  );
  const headingSimilarity = jaccardSimilarity(headingsA, headingsB);

  // Weighted combination
  const score =
    tagSimilarity * 0.4 +
    structSimilarity * 0.3 +
    blockSimilarity * 0.2 +
    headingSimilarity * 0.1;

  return Math.round(Math.max(0, Math.min(100, score * 100)));
}

// =============================================================================
// Overall Score Calculation
// =============================================================================

/**
 * Calculate overall similarity score
 */
export function calculateOverallScore(
  textScore: number,
  domScore: number
): number {
  const score =
    textScore * SIMILARITY_WEIGHTS.text + domScore * SIMILARITY_WEIGHTS.dom;
  return Math.round(Math.max(0, Math.min(100, score)));
}

// =============================================================================
// Confidence Calculation
// =============================================================================

interface ConfidenceFactors {
  artifactAOk: boolean;
  artifactBOk: boolean;
  blockedReasonA: string | null;
  blockedReasonB: string | null;
  wordCountA: number;
  wordCountB: number;
  hasTextA: boolean;
  hasTextB: boolean;
}

/**
 * Calculate confidence score based on artifact quality
 */
export function calculateConfidence(factors: ConfidenceFactors): number {
  let confidence = 80; // Start at 80

  // Check for blocked artifacts
  if (!factors.artifactAOk || !factors.artifactBOk) {
    const reasonA = factors.blockedReasonA || "";
    const reasonB = factors.blockedReasonB || "";

    if (reasonA.includes("robots") || reasonB.includes("robots")) {
      confidence += CONFIDENCE_PENALTIES.robotsDisallow;
    } else if (reasonA.includes("challenge") || reasonB.includes("challenge")) {
      confidence += CONFIDENCE_PENALTIES.challenge;
    } else if (reasonA.includes("non_html") || reasonB.includes("non_html")) {
      confidence += CONFIDENCE_PENALTIES.nonHtml;
    } else {
      // Generic failure
      confidence -= 50;
    }
  }

  // Check word counts
  if (factors.wordCountA < 150 || factors.wordCountB < 150) {
    confidence += CONFIDENCE_PENALTIES.lowWordCount;
  }

  // Check text presence
  if (!factors.hasTextA || !factors.hasTextB) {
    confidence += CONFIDENCE_PENALTIES.emptyText;
  }

  // Clamp to 0-90 (never exceed 90)
  return Math.round(Math.max(0, Math.min(90, confidence)));
}

// =============================================================================
// Reason Generation
// =============================================================================

interface ReasonFactors {
  textScore: number;
  domScore: number;
  confidence: number;
  featuresA: HomepageFeatures | null;
  featuresB: HomepageFeatures | null;
  hasTextA: boolean;
  hasTextB: boolean;
}

/**
 * Generate 5 concise reasons explaining the similarity score
 */
export function generateReasons(factors: ReasonFactors): string[] {
  const reasons: string[] = [];

  // Text similarity reason
  if (factors.textScore >= 70) {
    reasons.push("Homepage text content is semantically similar");
  } else if (factors.textScore >= 50) {
    reasons.push("Homepage text shows moderate semantic overlap");
  } else if (factors.textScore >= 30) {
    reasons.push("Homepage text shows limited semantic similarity");
  } else {
    reasons.push("Homepage text content covers different topics");
  }

  // DOM structure reason
  if (factors.domScore >= 70) {
    reasons.push("HTML structure and element distribution are similar");
  } else if (factors.domScore >= 50) {
    reasons.push("HTML structure shows moderate similarity");
  } else if (factors.domScore >= 30) {
    reasons.push("HTML structure shows some common patterns");
  } else {
    reasons.push("HTML structure differs significantly");
  }

  // Heading structure reason
  if (factors.featuresA && factors.featuresB) {
    const headingsA = new Set(
      factors.featuresA.headingTexts.map((h) => h.toLowerCase().trim())
    );
    const headingsB = new Set(
      factors.featuresB.headingTexts.map((h) => h.toLowerCase().trim())
    );
    const overlap = jaccardSimilarity(headingsA, headingsB);

    if (overlap >= 0.5) {
      reasons.push("Similar section headings/H1-H2 patterns detected");
    } else if (overlap >= 0.2) {
      reasons.push("Some shared heading patterns between pages");
    } else {
      reasons.push("Different heading structure and section organization");
    }
  }

  // Element distribution reason
  if (factors.featuresA && factors.featuresB) {
    const formDiff = Math.abs(
      factors.featuresA.formCount - factors.featuresB.formCount
    );
    const buttonDiff = Math.abs(
      factors.featuresA.buttonCount - factors.featuresB.buttonCount
    );
    const linkDiff = Math.abs(
      factors.featuresA.linkCount - factors.featuresB.linkCount
    );

    const avgDiff = (formDiff + buttonDiff / 5 + linkDiff / 10) / 3;

    if (avgDiff <= 2) {
      reasons.push("Similar distribution of forms, buttons, and links");
    } else if (avgDiff <= 5) {
      reasons.push("Moderate differences in interactive element counts");
    } else {
      reasons.push("Different layout structure (forms/buttons/links vary)");
    }
  }

  // Confidence reason
  if (factors.confidence < 30) {
    reasons.push(
      "Low confidence: page blocked, minimal text, or non-HTML content detected"
    );
  } else if (factors.confidence < 50) {
    reasons.push("Moderate confidence: some data quality limitations");
  } else if (!factors.hasTextA || !factors.hasTextB) {
    reasons.push("Text content unavailable for one or both pages");
  } else {
    // Add a general observation
    const overall =
      factors.textScore * 0.65 + factors.domScore * 0.35;
    if (overall >= 80) {
      reasons.push("Overall high similarity suggests potential clone or template reuse");
    } else if (overall >= 60) {
      reasons.push("Moderate overall similarity - possibly same industry or framework");
    } else {
      reasons.push("Low overall similarity indicates distinct websites");
    }
  }

  // Ensure exactly 5 reasons
  while (reasons.length < 5) {
    reasons.push("Additional analysis data not available");
  }

  return reasons.slice(0, 5);
}

// =============================================================================
// Feature Diff Generation
// =============================================================================

/**
 * Generate feature diff for UI display
 */
export function generateFeatureDiff(
  featuresA: HomepageFeatures | null,
  featuresB: HomepageFeatures | null,
  finalUrlA: string | null,
  finalUrlB: string | null,
  statusCodeA: number | null,
  statusCodeB: number | null
): FeatureDiff {
  const defaultStats: PageStats = {
    finalUrl: null,
    statusCode: null,
    wordCount: 0,
    h1Count: 0,
    h2Count: 0,
    linkCount: 0,
    buttonCount: 0,
    formCount: 0,
    passwordInputCount: 0,
    blocked: false,
  };

  const statsA: PageStats = featuresA
    ? {
        finalUrl: finalUrlA,
        statusCode: statusCodeA,
        wordCount: featuresA.wordCount,
        h1Count: featuresA.headingCounts.h1,
        h2Count: featuresA.headingCounts.h2,
        linkCount: featuresA.linkCount,
        buttonCount: featuresA.buttonCount,
        formCount: featuresA.formCount,
        passwordInputCount: featuresA.passwordInputCount,
        blocked: featuresA.blocked,
      }
    : { ...defaultStats, finalUrl: finalUrlA, statusCode: statusCodeA };

  const statsB: PageStats = featuresB
    ? {
        finalUrl: finalUrlB,
        statusCode: statusCodeB,
        wordCount: featuresB.wordCount,
        h1Count: featuresB.headingCounts.h1,
        h2Count: featuresB.headingCounts.h2,
        linkCount: featuresB.linkCount,
        buttonCount: featuresB.buttonCount,
        formCount: featuresB.formCount,
        passwordInputCount: featuresB.passwordInputCount,
        blocked: featuresB.blocked,
      }
    : { ...defaultStats, finalUrl: finalUrlB, statusCode: statusCodeB };

  // Calculate heading overlap
  const headingsA = new Set(
    (featuresA?.headingTexts || []).map((h) => h.toLowerCase().trim())
  );
  const headingsB = new Set(
    (featuresB?.headingTexts || []).map((h) => h.toLowerCase().trim())
  );
  const headingOverlap = jaccardSimilarity(headingsA, headingsB);
  const commonHeadings = [...headingsA].filter((h) => headingsB.has(h));

  // Calculate tag count diff
  const tagCountDiff: Record<string, { a: number; b: number; diff: number }> =
    {};
  const allTags = new Set([
    ...Object.keys(featuresA?.tagCounts || {}),
    ...Object.keys(featuresB?.tagCounts || {}),
  ]);

  for (const tag of allTags) {
    const countA = featuresA?.tagCounts[tag] || 0;
    const countB = featuresB?.tagCounts[tag] || 0;
    tagCountDiff[tag] = {
      a: countA,
      b: countB,
      diff: countA - countB,
    };
  }

  return {
    statsA,
    statsB,
    headingOverlap,
    commonHeadings,
    tagCountDiff,
  };
}
