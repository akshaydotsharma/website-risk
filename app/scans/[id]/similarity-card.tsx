import { prisma } from "@/lib/prisma";
import { SimilarityTabs } from "./similarity-tabs";

interface SimilaritySummary {
  similarCount: number;
  highSimilarCount: number;
  maxSimilarity: number;
  avgSimilarity: number;
  uniquenessScore: number;
  clusterSize: number;
  clusterMembers: string[];
  topSimilar: Array<{
    domainId: string;
    url: string;
    score: number;
    sharedSentenceCount: number;
  }>;
  totalClusters: number;
  analyzedAt: string;
}

const PAGE_KEYS = ["homepage_text", "about_page", "contact_page", "privacy_page", "refund_page", "terms_page"];
const PAGE_LABELS: Record<string, string> = {
  homepage_text: "Homepage",
  about_page: "About Us",
  contact_page: "Contact Us",
  privacy_page: "Privacy Policy",
  refund_page: "Refund Policy",
  terms_page: "Terms of Service",
};

export async function SimilarityCard({ domainId, domainUrl }: { domainId: string; domainUrl: string }) {
  const dataPoint = await prisma.domainDataPoint.findUnique({
    where: { domainId_key: { domainId, key: "similarity_summary" } },
  });

  if (!dataPoint) return null;

  let summary: SimilaritySummary;
  try {
    summary = JSON.parse(dataPoint.value);
  } catch {
    return null;
  }

  // Load all similarity pairs for this domain
  const pairs = await prisma.domainSimilarityPair.findMany({
    where: {
      OR: [{ domainAId: domainId }, { domainBId: domainId }],
      compositeScore: { gte: 15 },
    },
    orderBy: { compositeScore: "desc" },
  });

  // Get all domain IDs involved in pairs
  const otherDomainIds = new Set<string>();
  for (const p of pairs) {
    if (p.domainAId !== domainId) otherDomainIds.add(p.domainAId);
    if (p.domainBId !== domainId) otherDomainIds.add(p.domainBId);
  }
  const allDomainIds = [domainId, ...Array.from(otherDomainIds)];

  // Fetch 2nd-degree links: pairs where one end is a spoke and the other is NOT hub or spoke
  const spokeIds = Array.from(otherDomainIds);
  const hubAndSpokeIds = new Set([domainId, ...spokeIds]);
  const crossLinkCandidates = spokeIds.length > 0
    ? await prisma.domainSimilarityPair.findMany({
        where: {
          OR: [
            { domainAId: { in: spokeIds } },
            { domainBId: { in: spokeIds } },
          ],
          compositeScore: { gte: 50 },
        },
        orderBy: { compositeScore: "desc" },
      })
    : [];

  // Only keep pairs where one end is a spoke and the other is NOT in hub+spokes (true 2nd-degree)
  const crossLinkPairs = crossLinkCandidates.filter((p) => {
    const aIsSpoke = otherDomainIds.has(p.domainAId);
    const bIsSpoke = otherDomainIds.has(p.domainBId);
    const aIsNew = !hubAndSpokeIds.has(p.domainAId);
    const bIsNew = !hubAndSpokeIds.has(p.domainBId);
    return (aIsSpoke && bIsNew) || (bIsSpoke && aIsNew);
  });

  // Collect 2nd-degree domain IDs for data loading
  const secondDegreeIds = new Set<string>();
  for (const p of crossLinkPairs) {
    if (!hubAndSpokeIds.has(p.domainAId)) secondDegreeIds.add(p.domainAId);
    if (!hubAndSpokeIds.has(p.domainBId)) secondDegreeIds.add(p.domainBId);
  }

  // Fetch 3rd-degree links: pairs where one end is a 2nd-degree node and the other is brand new
  const secondDegreeArr = Array.from(secondDegreeIds);
  const knownIds = new Set([...hubAndSpokeIds, ...secondDegreeIds]);
  const thirdDegreeCandidates = secondDegreeArr.length > 0
    ? await prisma.domainSimilarityPair.findMany({
        where: {
          OR: [
            { domainAId: { in: secondDegreeArr } },
            { domainBId: { in: secondDegreeArr } },
          ],
          compositeScore: { gte: 50 },
        },
        orderBy: { compositeScore: "desc" },
      })
    : [];

  const thirdDegreePairs = thirdDegreeCandidates.filter((p) => {
    const aIs2nd = secondDegreeIds.has(p.domainAId);
    const bIs2nd = secondDegreeIds.has(p.domainBId);
    const aIsNew = !knownIds.has(p.domainAId);
    const bIsNew = !knownIds.has(p.domainBId);
    return (aIs2nd && bIsNew) || (bIs2nd && aIsNew);
  });

  const thirdDegreeIds = new Set<string>();
  for (const p of thirdDegreePairs) {
    if (!knownIds.has(p.domainAId)) thirdDegreeIds.add(p.domainAId);
    if (!knownIds.has(p.domainBId)) thirdDegreeIds.add(p.domainBId);
  }

  const allCrossLinks = [...crossLinkPairs, ...thirdDegreePairs];
  const allDomainIdsWithCross = [...allDomainIds, ...secondDegreeArr, ...Array.from(thirdDegreeIds)];

  // Load page texts for all involved domains (including 2nd-degree)
  const [allDataPoints, domains] = await Promise.all([
    prisma.domainDataPoint.findMany({
      where: { domainId: { in: allDomainIdsWithCross }, key: { in: PAGE_KEYS } },
      select: { domainId: true, key: true, value: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: allDomainIdsWithCross } },
      select: { id: true, normalizedUrl: true },
    }),
  ]);

  // Build domain texts for side-by-side
  const domainTexts = domains.map((d) => {
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
        if (dp.key === "about_page") {
          aboutText = text;
          aboutPageUrl = parsed.about_page_url || null;
        }
      } catch {
        // skip
      }
    }

    return { domainId: d.id, url: d.normalizedUrl, aboutText, aboutPageUrl, pageTexts };
  });

  // Serialize pairs for client component
  const serializePair = (p: typeof pairs[0]) => ({
    id: p.id,
    domainAId: p.domainAId,
    domainBId: p.domainBId,
    domainAUrl: p.domainAUrl,
    domainBUrl: p.domainBUrl,
    compositeScore: p.compositeScore,
    sharedSentences: p.sharedSentences ? JSON.parse(p.sharedSentences) : [],
    sharedSentenceCount: p.sharedSentenceCount,
    pageScores: p.pageScores ? JSON.parse(p.pageScores) : [],
    keywordHitsA: p.keywordHitsA ? JSON.parse(p.keywordHitsA) : [],
    keywordHitsB: p.keywordHitsB ? JSON.parse(p.keywordHitsB) : [],
  });

  const serializedPairs = pairs.map(serializePair);
  const serializedCrossLinks = allCrossLinks.map(serializePair);

  return (
    <SimilarityTabs
      domainId={domainId}
      domainUrl={domainUrl}
      summary={summary}
      pairs={serializedPairs}
      crossLinks={serializedCrossLinks}
      domainTexts={domainTexts}
    />
  );
}
