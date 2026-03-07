import type { KeywordHit, PairResult, ClusterInfo, FlagInfo } from "./schemas";

interface FlagInput {
  domainAId: string;
  domainBId: string;
  textScore: number;
  sharedSentenceCount: number;
  keywordHitsA: KeywordHit[];
  keywordHitsB: KeywordHit[];
  clusterId: number | null;
  matchingPageCount?: number;
}

/**
 * Determine flag reasons for a single pair.
 */
function getFlagReasons(
  pair: FlagInput,
  clusterSizes: Map<number, number>
): string[] {
  const reasons: string[] = [];

  if (pair.textScore >= 85) {
    reasons.push("Very high content similarity");
  }

  if (pair.matchingPageCount && pair.matchingPageCount >= 3) {
    reasons.push(`${pair.matchingPageCount} page types with matching content`);
  }

  if (pair.sharedSentenceCount >= 3) {
    reasons.push(`${pair.sharedSentenceCount} shared sentences detected`);
  }

  const aKeywordTotal = pair.keywordHitsA.reduce((s, h) => s + h.count, 0);
  const bKeywordTotal = pair.keywordHitsB.reduce((s, h) => s + h.count, 0);
  if (aKeywordTotal >= 2 && bKeywordTotal >= 2) {
    reasons.push("Suspicious keyword overlap");
  }

  if (
    pair.clusterId !== null &&
    (clusterSizes.get(pair.clusterId) || 0) >= 3
  ) {
    reasons.push("Part of a large similarity cluster");
  }

  return reasons;
}

/**
 * Flag suspicious pairs and collect flag summary info.
 */
export function flagSuspiciousPairs(
  pairs: PairResult[],
  clusters: ClusterInfo[]
): { flaggedPairs: PairResult[]; flags: FlagInfo[] } {
  // Build cluster size lookup
  const clusterSizes = new Map<number, number>();
  for (const c of clusters) {
    clusterSizes.set(c.clusterId, c.members.length);
  }

  // Count flag types
  const flagCounts = new Map<string, number>();

  for (const pair of pairs) {
    const matchingPageCount = pair.pageScores
      ? pair.pageScores.filter((ps) => ps.score >= 60).length
      : 0;

    const reasons = getFlagReasons(
      {
        domainAId: pair.domainAId,
        domainBId: pair.domainBId,
        textScore: pair.textScore,
        sharedSentenceCount: pair.sharedSentences.length,
        keywordHitsA: pair.keywordHitsA,
        keywordHitsB: pair.keywordHitsB,
        clusterId: pair.clusterId,
        matchingPageCount,
      },
      clusterSizes
    );

    if (reasons.length > 0) {
      pair.flagged = true;
      pair.flagReasons = reasons;
      for (const reason of reasons) {
        flagCounts.set(reason, (flagCounts.get(reason) || 0) + 1);
      }
    }
  }

  const flags: FlagInfo[] = Array.from(flagCounts.entries()).map(
    ([type, count]) => ({
      type,
      description: type,
      count,
    })
  );

  return {
    flaggedPairs: pairs.filter((p) => p.flagged),
    flags,
  };
}
