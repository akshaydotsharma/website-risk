import { prisma } from "@/lib/prisma";
import type { PairData, DomainText, SimilaritySummary } from "@/components/similarity/similarity-tabs";
import { PAGE_TEXT_KEYS, PAGE_TEXT_LABELS, DataPointKey } from "@/lib/constants";
import { safeJsonParse } from "@/lib/utils";

const PAGE_KEYS = [...PAGE_TEXT_KEYS];
const PAGE_LABELS = PAGE_TEXT_LABELS;

export interface InvestigationSimilarityData {
  hubDomainId: string;
  hubDomainUrl: string;
  summary: SimilaritySummary;
  pairs: PairData[];
  crossLinks: PairData[];
  allPairs: PairData[];
  domainTexts: DomainText[];
}

/**
 * Fetches similarity data scoped to investigation domains.
 * Picks the most-connected domain as the "hub" so the cluster graph
 * renders in the same hub-spoke style as scan detail.
 */
export async function fetchInvestigationSimilarity(domainIds: string[]): Promise<InvestigationSimilarityData | null> {
  if (domainIds.length < 2) return null;

  const rawPairs = await prisma.domainSimilarityPair.findMany({
    where: {
      domainAId: { in: domainIds },
      domainBId: { in: domainIds },
    },
    orderBy: { compositeScore: "desc" },
  });

  // Pick the most-connected domain as the "hub"
  const connectionCount = new Map<string, number>();
  for (const p of rawPairs) {
    if (p.compositeScore >= 50) {
      connectionCount.set(p.domainAId, (connectionCount.get(p.domainAId) || 0) + 1);
      connectionCount.set(p.domainBId, (connectionCount.get(p.domainBId) || 0) + 1);
    }
  }

  let hubDomainId = domainIds[0];
  let maxConnections = 0;
  for (const [id, count] of connectionCount) {
    if (count > maxConnections) {
      maxConnections = count;
      hubDomainId = id;
    }
  }

  // Load domain info
  const domains = await prisma.domain.findMany({
    where: { id: { in: domainIds } },
    select: { id: true, normalizedUrl: true },
  });

  const domainUrlMap = new Map(domains.map((d) => [d.id, d.normalizedUrl]));
  const hubDomainUrl = domainUrlMap.get(hubDomainId) || "";

  const hubPairs = rawPairs.filter(
    (p) => p.domainAId === hubDomainId || p.domainBId === hubDomainId
  );
  const crossLinkPairs = rawPairs.filter(
    (p) => p.domainAId !== hubDomainId && p.domainBId !== hubDomainId && p.compositeScore >= 50
  );

  const topSimilar = hubPairs
    .filter((p) => p.compositeScore >= 50)
    .map((p) => {
      const otherId = p.domainAId === hubDomainId ? p.domainBId : p.domainAId;
      const otherUrl = p.domainAId === hubDomainId ? p.domainBUrl : p.domainAUrl;
      return { domainId: otherId, url: otherUrl, score: p.compositeScore, sharedSentenceCount: p.sharedSentenceCount };
    })
    .sort((a, b) => b.score - a.score);

  const clusterMembers = topSimilar.map((t) => t.url);
  const highSimPairs = hubPairs.filter((p) => p.compositeScore >= 50);
  const scores = hubPairs.map((p) => p.compositeScore);

  // Compute actual cluster count using union-find on all pairs with score >= 50
  const allHighPairs = rawPairs.filter((p) => p.compositeScore >= 50);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (const p of allHighPairs) {
    union(p.domainAId, p.domainBId);
  }
  const clusterRoots = new Set<string>();
  for (const p of allHighPairs) {
    clusterRoots.add(find(p.domainAId));
  }
  const totalClusters = clusterRoots.size;

  const summary: SimilaritySummary = {
    similarCount: hubPairs.length,
    highSimilarCount: highSimPairs.length,
    maxSimilarity: scores.length > 0 ? Math.max(...scores) : 0,
    avgSimilarity: scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0,
    uniquenessScore: 0,
    clusterSize: clusterMembers.length,
    clusterMembers,
    topSimilar,
    totalClusters,
    analyzedAt: new Date().toISOString(),
  };

  // Load page texts (reuse `domains` from earlier query instead of re-fetching)
  const allDataPoints = await prisma.domainDataPoint.findMany({
    where: { domainId: { in: domainIds }, key: { in: PAGE_KEYS } },
    select: { domainId: true, key: true, value: true },
  });

  const domainTexts: DomainText[] = domains.map((d) => {
    const pageTexts: { key: string; label: string; text: string; pageUrl?: string }[] = [];
    let aboutText = "";
    let aboutPageUrl: string | null = null;

    for (const dp of allDataPoints.filter((a) => a.domainId === d.id)) {
      try {
        const parsed = JSON.parse(dp.value);
        const text = parsed.text_content || parsed.text || parsed.content || "";
        const pageUrl = parsed.url || parsed.page_url || parsed[`${dp.key}_url`] || parsed.about_page_url || null;
        if (text) {
          pageTexts.push({ key: dp.key, label: PAGE_LABELS[dp.key] || dp.key, text, pageUrl: pageUrl || undefined });
        }
        if (dp.key === DataPointKey.ABOUT_PAGE) {
          aboutText = text;
          aboutPageUrl = parsed.about_page_url || null;
        }
      } catch {}
    }

    return { domainId: d.id, url: d.normalizedUrl, aboutText, aboutPageUrl, pageTexts };
  });

  // Serialize pairs
  const serializePair = (p: typeof rawPairs[0]): PairData => ({
    id: p.id,
    domainAId: p.domainAId,
    domainBId: p.domainBId,
    domainAUrl: p.domainAUrl,
    domainBUrl: p.domainBUrl,
    compositeScore: p.compositeScore,
    sharedSentences: safeJsonParse(p.sharedSentences, []),
    sharedSentenceCount: p.sharedSentenceCount,
    pageScores: safeJsonParse(p.pageScores, []),
    keywordHitsA: safeJsonParse(p.keywordHitsA, []),
    keywordHitsB: safeJsonParse(p.keywordHitsB, []),
  });

  return {
    hubDomainId,
    hubDomainUrl,
    summary,
    pairs: hubPairs.map(serializePair),
    crossLinks: crossLinkPairs.map(serializePair),
    allPairs: rawPairs.filter((p) => p.compositeScore >= 50).map(serializePair),
    domainTexts,
  };
}
