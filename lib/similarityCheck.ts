import { prisma } from "@/lib/prisma";
import { buildCorpusIDF, computePairwiseScores } from "./aboutUsAnalysis/nDocTfidf";
import { computePairwiseNgramScores } from "./aboutUsAnalysis/ngramOverlap";
import { findSharedSentences } from "./aboutUsAnalysis/sharedSentences";
import { scanKeywords } from "./aboutUsAnalysis/keywordScan";
import { PAGE_TEXT_TYPES } from "./aboutUsAnalysis/schemas";
import type { KeywordHit, PageScore } from "./aboutUsAnalysis/schemas";

const PAGE_KEYS = PAGE_TEXT_TYPES.map((t) => t.key);
const PAGE_LABEL_MAP = new Map(PAGE_TEXT_TYPES.map((t) => [t.key, t.label]));
const POLICY_PAGE_KEYS = new Set(["terms_page", "privacy_page", "refund_page"]);
const SENTENCE_BONUS = 2;
const MAX_SENTENCE_BONUS = 10;
const MIN_SCORE_TO_STORE = 15; // Only store pairs with meaningful similarity

/**
 * Run incremental similarity check: compare one domain against all others.
 * Called automatically after a scan completes.
 * Stores results in DomainSimilarityPair table.
 * Also saves a summary data point on the domain.
 */
export async function runIncrementalSimilarity(
  domainId: string,
  normalizedUrl: string
): Promise<void> {
  const logPrefix = `[Similarity ${normalizedUrl}]`;
  const startTime = Date.now();

  try {
    // Step 1: Get all other domains that have page text data
    const allDomains = await prisma.domain.findMany({
      where: { id: { not: domainId } },
      select: { id: true, normalizedUrl: true },
    });

    if (allDomains.length === 0) {
      console.log(`${logPrefix} No other domains to compare against`);
      return;
    }

    const allDomainIds = [domainId, ...allDomains.map((d) => d.id)];
    const urlMap = new Map<string, string>();
    urlMap.set(domainId, normalizedUrl);
    for (const d of allDomains) {
      urlMap.set(d.id, d.normalizedUrl);
    }

    // Step 2: Bulk load page texts for all domains
    const dataPoints = await prisma.domainDataPoint.findMany({
      where: { domainId: { in: allDomainIds }, key: { in: PAGE_KEYS } },
      select: { domainId: true, key: true, value: true },
    });

    const allPageTexts = new Map<string, Map<string, string>>();
    for (const dp of dataPoints) {
      try {
        const data = JSON.parse(dp.value);
        const text = data.text_content;
        if (text && text.length > 50) {
          if (!allPageTexts.has(dp.domainId)) {
            allPageTexts.set(dp.domainId, new Map());
          }
          allPageTexts.get(dp.domainId)!.set(dp.key, text);
        }
      } catch {
        // skip
      }
    }

    // Check if the scanned domain has any text
    if (!allPageTexts.has(domainId)) {
      console.log(`${logPrefix} No page text available, skipping similarity`);
      return;
    }

    // Filter to only domains that have text
    const domainsWithText = allDomainIds.filter((id) => allPageTexts.has(id));
    const otherDomainsWithText = domainsWithText.filter((id) => id !== domainId);

    if (otherDomainsWithText.length === 0) {
      console.log(`${logPrefix} No other domains have text, skipping`);
      return;
    }

    console.log(`${logPrefix} Comparing against ${otherDomainsWithText.length} domains...`);

    // Step 3: Per-page-type analysis
    // For efficiency, we only compute scores for pairs involving our domain
    const pairScores = new Map<
      string,
      {
        compositeScore: number;
        pageScores: PageScore[];
        sharedSentences: string[];
      }
    >();

    for (const pageKey of PAGE_KEYS) {
      // Build texts map for this page type
      const textsMap = new Map<string, string>();
      for (const id of domainsWithText) {
        const text = allPageTexts.get(id)?.get(pageKey);
        if (text) textsMap.set(id, text);
      }

      // Need at least the target domain + 1 other
      if (!textsMap.has(domainId) || textsMap.size < 2) continue;

      const idf = buildCorpusIDF(textsMap);
      const tfidfScores = computePairwiseScores(textsMap, idf);
      const shared = findSharedSentences(textsMap);

      let finalScores: Map<string, number>;

      if (POLICY_PAGE_KEYS.has(pageKey)) {
        const ngramScores = computePairwiseNgramScores(textsMap);
        finalScores = new Map<string, number>();

        for (const [pairKey, tfidf] of tfidfScores) {
          // Only process pairs involving our domain
          if (!pairKey.includes(domainId)) continue;
          const ngram = ngramScores.get(pairKey) || 0;
          const sharedCount = (shared.get(pairKey) || []).length;
          const sentenceSignal = Math.min(sharedCount * 8, 40);
          const blended = Math.round(tfidf * 0.2 + ngram * 0.45 + sentenceSignal * 0.35);
          finalScores.set(pairKey, Math.min(100, blended));
        }
      } else {
        finalScores = tfidfScores;
      }

      // Accumulate per-pair results (only pairs involving our domain)
      for (const [pairKey, score] of finalScores) {
        if (!pairKey.includes(domainId)) continue;

        if (!pairScores.has(pairKey)) {
          pairScores.set(pairKey, { compositeScore: 0, pageScores: [], sharedSentences: [] });
        }
        const pair = pairScores.get(pairKey)!;

        const sharedSents = shared.get(pairKey) || [];
        if (score > 0 || sharedSents.length > 0) {
          pair.pageScores.push({
            pageType: pageKey,
            label: PAGE_LABEL_MAP.get(pageKey) || pageKey,
            score,
            sharedSentenceCount: sharedSents.length,
          });
        }
        pair.compositeScore = Math.max(pair.compositeScore, score);

        // Merge shared sentences (deduped)
        const existingFps = new Set(
          pair.sharedSentences.map((s) =>
            s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim()
          )
        );
        for (const s of sharedSents) {
          const fp = s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
          if (!existingFps.has(fp)) {
            existingFps.add(fp);
            pair.sharedSentences.push(s);
          }
        }
      }
    }

    // Step 4: Keyword scan for the target domain
    const targetTexts = allPageTexts.get(domainId)!;
    const targetAllText = Array.from(targetTexts.values()).join(" ");
    const targetKeywords = scanKeywords(targetAllText);

    // Step 5: Apply sentence bonus and build final pairs
    const pairsToStore: Array<{
      domainAId: string;
      domainBId: string;
      domainAUrl: string;
      domainBUrl: string;
      compositeScore: number;
      sharedSentences: string[];
      pageScores: PageScore[];
      keywordHitsA: KeywordHit[];
      keywordHitsB: KeywordHit[];
    }> = [];

    for (const [pairKey, data] of pairScores) {
      const [idA, idB] = pairKey.split("|");
      const sharedCount = data.sharedSentences.length;
      const bonus = Math.min(sharedCount * SENTENCE_BONUS, MAX_SENTENCE_BONUS);
      const finalScore = Math.min(100, data.compositeScore + bonus);

      if (finalScore < MIN_SCORE_TO_STORE) continue;

      // Get keyword hits for the other domain
      const otherId = idA === domainId ? idB : idA;
      const otherTexts = allPageTexts.get(otherId);
      const otherKeywords = otherTexts
        ? scanKeywords(Array.from(otherTexts.values()).join(" "))
        : [];

      // Ensure consistent ordering (alphabetical by ID)
      const [sortedA, sortedB] = [idA, idB].sort();
      const isSwapped = sortedA !== idA;

      pairsToStore.push({
        domainAId: sortedA,
        domainBId: sortedB,
        domainAUrl: urlMap.get(sortedA) || sortedA,
        domainBUrl: urlMap.get(sortedB) || sortedB,
        compositeScore: finalScore,
        sharedSentences: data.sharedSentences,
        pageScores: data.pageScores,
        keywordHitsA: isSwapped ? otherKeywords : targetKeywords,
        keywordHitsB: isSwapped ? targetKeywords : otherKeywords,
      });
    }

    // Step 6: Upsert pairs to DB (batch)
    console.log(`${logPrefix} Storing ${pairsToStore.length} similarity pairs (score >= ${MIN_SCORE_TO_STORE})...`);

    const BATCH_SIZE = 50;
    for (let i = 0; i < pairsToStore.length; i += BATCH_SIZE) {
      const batch = pairsToStore.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(
        batch.map((p) =>
          prisma.domainSimilarityPair.upsert({
            where: {
              domainAId_domainBId: { domainAId: p.domainAId, domainBId: p.domainBId },
            },
            create: {
              domainAId: p.domainAId,
              domainBId: p.domainBId,
              domainAUrl: p.domainAUrl,
              domainBUrl: p.domainBUrl,
              compositeScore: p.compositeScore,
              sharedSentences: JSON.stringify(p.sharedSentences),
              sharedSentenceCount: p.sharedSentences.length,
              pageScores: JSON.stringify(p.pageScores),
              keywordHitsA: JSON.stringify(p.keywordHitsA),
              keywordHitsB: JSON.stringify(p.keywordHitsB),
            },
            update: {
              compositeScore: p.compositeScore,
              sharedSentences: JSON.stringify(p.sharedSentences),
              sharedSentenceCount: p.sharedSentences.length,
              pageScores: JSON.stringify(p.pageScores),
              keywordHitsA: JSON.stringify(p.keywordHitsA),
              keywordHitsB: JSON.stringify(p.keywordHitsB),
              domainAUrl: p.domainAUrl,
              domainBUrl: p.domainBUrl,
            },
          })
        )
      );
    }

    // Step 7: Build clusters from ALL stored pairs (transitive closure)
    // Load all pairs above threshold for clustering
    const allStoredPairs = await prisma.domainSimilarityPair.findMany({
      where: { compositeScore: { gte: 50 } },
      select: { domainAId: true, domainBId: true, compositeScore: true },
    });

    // Union-Find for clustering
    const parent = new Map<string, string>();
    function find(x: string): string {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    }
    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    for (const pair of allStoredPairs) {
      union(pair.domainAId, pair.domainBId);
    }

    // Build cluster map
    const clusterMap = new Map<string, string[]>(); // root → members
    const allClusteredIds = new Set<string>();
    for (const pair of allStoredPairs) {
      allClusteredIds.add(pair.domainAId);
      allClusteredIds.add(pair.domainBId);
    }
    for (const id of allClusteredIds) {
      const root = find(id);
      if (!clusterMap.has(root)) clusterMap.set(root, []);
      clusterMap.get(root)!.push(id);
    }

    // Only keep clusters with 2+ members
    const clusters = Array.from(clusterMap.values()).filter((c) => c.length >= 2);

    // Step 8: Compute similarity summary for this domain
    const myPairs = pairsToStore.filter(
      (p) => p.domainAId === domainId || p.domainBId === domainId
    );
    const similarCount = myPairs.length;
    const highSimilarCount = myPairs.filter((p) => p.compositeScore >= 50).length;
    const maxSimilarity = myPairs.length > 0
      ? Math.max(...myPairs.map((p) => p.compositeScore))
      : 0;
    const avgSimilarity = myPairs.length > 0
      ? Math.round(myPairs.reduce((sum, p) => sum + p.compositeScore, 0) / myPairs.length)
      : 0;

    // Uniqueness = inverse of max similarity (100 = totally unique, 0 = exact copy)
    const uniquenessScore = Math.max(0, 100 - maxSimilarity);

    // Find which cluster this domain belongs to
    const myCluster = clusters.find((c) => c.includes(domainId));
    const clusterSize = myCluster ? myCluster.length : 0;
    const clusterMembers = myCluster
      ? myCluster
          .filter((id) => id !== domainId)
          .map((id) => urlMap.get(id) || id)
      : [];

    // Top similar domains
    const topSimilar = [...myPairs]
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, 10)
      .map((p) => ({
        domainId: p.domainAId === domainId ? p.domainBId : p.domainAId,
        url: p.domainAId === domainId ? p.domainBUrl : p.domainAUrl,
        score: p.compositeScore,
        sharedSentenceCount:  p.sharedSentences.length,
      }));

    const summary = {
      similarCount,
      highSimilarCount,
      maxSimilarity,
      avgSimilarity,
      uniquenessScore,
      clusterSize,
      clusterMembers,
      topSimilar,
      totalClusters: clusters.length,
      analyzedAt: new Date().toISOString(),
    };

    // Step 9: Store summary as a domain data point
    await prisma.domainDataPoint.upsert({
      where: { domainId_key: { domainId, key: "similarity_summary" } },
      create: {
        domainId,
        key: "similarity_summary",
        label: "Content Similarity",
        value: JSON.stringify(summary),
        sources: JSON.stringify(["incremental_similarity"]),
        rawOpenAIResponse: "{}",
      },
      update: {
        value: JSON.stringify(summary),
        sources: JSON.stringify(["incremental_similarity"]),
      },
    });

    const elapsed = Date.now() - startTime;
    console.log(
      `${logPrefix} ✅ Similarity complete in ${elapsed}ms — ` +
      `${similarCount} similar (${highSimilarCount} high), ` +
      `uniqueness: ${uniquenessScore}, cluster size: ${clusterSize}`
    );
  } catch (error) {
    console.error(`${logPrefix} ❌ Similarity check failed:`, error);
    // Non-fatal — don't block the scan
  }
}
