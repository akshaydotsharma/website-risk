import { prisma } from "@/lib/prisma";
import { getOrCreateAboutArtifact } from "@/lib/extractHomepageArtifact";
import { buildCorpusIDF, computePairwiseScores } from "./nDocTfidf";
import { computePairwiseNgramScores } from "./ngramOverlap";
import { findSharedSentences } from "./sharedSentences";
import { scanKeywords } from "./keywordScan";
import { clusterByThreshold } from "./clustering";
import { flagSuspiciousPairs } from "./flagging";
import { PAGE_TEXT_TYPES } from "./schemas";
import type {
  PairResult,
  AnalysisRunSummary,
  KeywordHit,
  PageScore,
} from "./schemas";

const PAGE_KEYS = PAGE_TEXT_TYPES.map((t) => t.key);
const PAGE_LABEL_MAP = new Map(PAGE_TEXT_TYPES.map((t) => [t.key, t.label]));

const SENTENCE_BONUS = 2;
const MAX_SENTENCE_BONUS = 10;

/**
 * Policy page types where TF-IDF alone is misleading because all policies
 * share common legal vocabulary. For these, we blend in n-gram overlap
 * (shared phrases) and shared sentence counts to better detect same-author content.
 */
const POLICY_PAGE_KEYS = new Set(["terms_page", "privacy_page", "refund_page"]);

/**
 * Bulk load all page texts for a set of domains.
 * Returns Map<domainId, Map<pageKey, text>>.
 */
async function loadAllPageTexts(
  domainIds: string[],
  urlMap: Map<string, string>
): Promise<Map<string, Map<string, string>>> {
  const allPageTexts = new Map<string, Map<string, string>>();

  // Single bulk query for all domains and page types
  const dataPoints = await prisma.domainDataPoint.findMany({
    where: { domainId: { in: domainIds }, key: { in: PAGE_KEYS } },
  });

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
      // invalid JSON, skip
    }
  }

  // Fallback for about_page via artifact extraction (existing behavior)
  for (const domainId of domainIds) {
    const pageTexts = allPageTexts.get(domainId);
    if (pageTexts?.has("about_page")) continue;

    const url = urlMap.get(domainId);
    if (!url) continue;

    try {
      const result = await getOrCreateAboutArtifact(`https://${url}`);
      const text = result?.artifact?.textSnippet;
      if (text && text.length > 50) {
        if (!allPageTexts.has(domainId)) {
          allPageTexts.set(domainId, new Map());
        }
        allPageTexts.get(domainId)!.set("about_page", text);
      }
    } catch {
      // skip
    }
  }

  return allPageTexts;
}

/**
 * Run the full similarity analysis for a set of domains.
 * Compares all 6 page types (homepage, about, contact, privacy, refund, terms).
 * Updates the AboutUsAnalysisRun record with results.
 */
export async function runAboutUsAnalysis(
  runId: string,
  domainIds: string[]
): Promise<void> {
  try {
    // Mark as processing
    await prisma.aboutUsAnalysisRun.update({
      where: { id: runId },
      data: { status: "processing" },
    });

    // Step 1: Load domains
    const domains = await prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, normalizedUrl: true },
    });

    const urlMap = new Map<string, string>();
    for (const d of domains) {
      urlMap.set(d.id, d.normalizedUrl);
    }

    // Step 2: Bulk load all page texts
    console.log(`[Group Analysis] Loading page texts for ${domains.length} domains...`);
    const allPageTexts = await loadAllPageTexts(
      domains.map((d) => d.id),
      urlMap
    );

    // Determine which domains have ANY text
    const domainsWithText = Array.from(allPageTexts.keys());
    console.log(
      `[Group Analysis] Got text for ${domainsWithText.length}/${domains.length} domains`
    );

    if (domainsWithText.length < 2) {
      await prisma.aboutUsAnalysisRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          completedAt: new Date(),
          pairCount: 0,
          error:
            domainsWithText.length === 0
              ? "No domains had extractable page text"
              : "Only 1 domain had extractable page text, need at least 2",
        },
      });
      return;
    }

    // Step 3: Per-page-type TF-IDF + shared sentences + n-gram overlap (for policies)
    console.log(`[Group Analysis] Computing per-page-type similarity...`);
    const pageTypeResults = new Map<
      string,
      {
        scores: Map<string, number>;
        sharedSentences: Map<string, string[]>;
      }
    >();

    for (const pageKey of PAGE_KEYS) {
      // Build textsMap for domains that have this page type
      const textsMap = new Map<string, string>();
      for (const [domainId, pageTexts] of allPageTexts) {
        const text = pageTexts.get(pageKey);
        if (text) textsMap.set(domainId, text);
      }

      if (textsMap.size < 2) continue;

      const idf = buildCorpusIDF(textsMap);
      const tfidfScores = computePairwiseScores(textsMap, idf);
      const shared = findSharedSentences(textsMap);

      let finalScores: Map<string, number>;

      if (POLICY_PAGE_KEYS.has(pageKey)) {
        // Policy pages: blend TF-IDF with n-gram overlap + shared sentence bonus.
        // Pure TF-IDF inflates scores due to shared legal vocabulary.
        // N-gram overlap captures same phrasing/structure (authorship signal).
        // Shared sentences are the strongest same-author signal.
        const ngramScores = computePairwiseNgramScores(textsMap);
        finalScores = new Map<string, number>();

        for (const [pairKey, tfidf] of tfidfScores) {
          const ngram = ngramScores.get(pairKey) || 0;
          const sharedCount = (shared.get(pairKey) || []).length;
          // Shared sentence bonus: each identical sentence is a strong authorship signal
          const sentenceSignal = Math.min(sharedCount * 8, 40);

          // Blended score for policies:
          // - 20% TF-IDF (vocabulary overlap — discounted, since all policies share legal terms)
          // - 45% n-gram overlap (shared phrases — key authorship signal)
          // - 35% shared sentence bonus (identical sentences — strongest signal)
          const blended = Math.round(
            tfidf * 0.20 + ngram * 0.45 + sentenceSignal * 0.35
          );
          finalScores.set(pairKey, Math.min(100, blended));
        }

        console.log(
          `[Group Analysis] ${pageKey}: applied policy scoring (TF-IDF discounted, n-gram + sentence weighted)`
        );
      } else {
        // Non-policy pages: use TF-IDF as-is (vocabulary overlap is meaningful)
        finalScores = tfidfScores;
      }

      pageTypeResults.set(pageKey, { scores: finalScores, sharedSentences: shared });
    }

    console.log(
      `[Group Analysis] Analyzed ${pageTypeResults.size} page types: ${Array.from(pageTypeResults.keys()).join(", ")}`
    );

    // Step 4: Keyword scan — concatenate all page texts per domain
    console.log(`[Group Analysis] Scanning keywords...`);
    const keywordHitsMap = new Map<string, KeywordHit[]>();
    for (const [domainId, pageTexts] of allPageTexts) {
      const allText = Array.from(pageTexts.values()).join(" ");
      keywordHitsMap.set(domainId, scanKeywords(allText));
    }

    // Step 5: Build composite scores per pair (max across page types)
    console.log(`[Group Analysis] Building composite scores...`);
    const compositeMaxScores = new Map<string, number>();
    const pageScoresPerPair = new Map<string, PageScore[]>();
    const mergedSharedSentences = new Map<string, string[]>();

    const domainIdsSorted = domainsWithText.sort();

    for (let i = 0; i < domainIdsSorted.length; i++) {
      for (let j = i + 1; j < domainIdsSorted.length; j++) {
        const pairKey = `${domainIdsSorted[i]}|${domainIdsSorted[j]}`;
        let maxScore = 0;
        const pageScores: PageScore[] = [];
        const allShared: string[] = [];
        const seenFps = new Set<string>();

        for (const pageKey of PAGE_KEYS) {
          const result = pageTypeResults.get(pageKey);
          if (!result) continue;

          const score = result.scores.get(pairKey) || 0;
          const shared = result.sharedSentences.get(pairKey) || [];

          if (score > 0 || shared.length > 0) {
            pageScores.push({
              pageType: pageKey,
              label: PAGE_LABEL_MAP.get(pageKey) || pageKey,
              score,
              sharedSentenceCount: shared.length,
            });
          }

          maxScore = Math.max(maxScore, score);

          // Merge shared sentences (deduplicated by fingerprint)
          for (const s of shared) {
            const fp = s
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, "")
              .replace(/\s+/g, " ")
              .trim();
            if (!seenFps.has(fp)) {
              seenFps.add(fp);
              allShared.push(s);
            }
          }
        }

        compositeMaxScores.set(pairKey, maxScore);
        pageScoresPerPair.set(pairKey, pageScores);
        mergedSharedSentences.set(pairKey, allShared);
      }
    }

    // Step 6: Clustering — use max score + sentence bonus
    console.log(`[Group Analysis] Clustering...`);
    const clusteringScores = new Map<string, number>();
    for (const [key, maxScore] of compositeMaxScores) {
      const sharedCount = (mergedSharedSentences.get(key) || []).length;
      const bonus = Math.min(sharedCount * SENTENCE_BONUS, MAX_SENTENCE_BONUS);
      clusteringScores.set(key, Math.min(100, maxScore + bonus));
    }
    const { assignments, clusters } = clusterByThreshold(
      clusteringScores,
      urlMap,
      50
    );

    // Step 7: Build pair results
    const pairs: PairResult[] = [];

    for (let i = 0; i < domainIdsSorted.length; i++) {
      for (let j = i + 1; j < domainIdsSorted.length; j++) {
        const aId = domainIdsSorted[i];
        const bId = domainIdsSorted[j];
        const pairKey = `${aId}|${bId}`;

        pairs.push({
          domainAId: aId,
          domainBId: bId,
          domainAUrl: urlMap.get(aId) || aId,
          domainBUrl: urlMap.get(bId) || bId,
          textScore: compositeMaxScores.get(pairKey) || 0,
          sharedSentences: mergedSharedSentences.get(pairKey) || [],
          keywordHitsA: keywordHitsMap.get(aId) || [],
          keywordHitsB: keywordHitsMap.get(bId) || [],
          pageScores: pageScoresPerPair.get(pairKey) || [],
          clusterId:
            assignments.get(aId) !== undefined &&
            assignments.get(aId) === assignments.get(bId)
              ? assignments.get(aId)!
              : null,
          flagged: false,
          flagReasons: [],
        });
      }
    }

    // Step 8: Flagging
    console.log(`[Group Analysis] Flagging suspicious pairs...`);
    const { flaggedPairs, flags } = flagSuspiciousPairs(pairs, clusters);

    // Step 9: Save pairs to DB
    console.log(`[Group Analysis] Saving ${pairs.length} pairs...`);
    const batchSize = 50;
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      await prisma.$transaction(
        batch.map((p) =>
          prisma.aboutUsAnalysisPair.create({
            data: {
              runId,
              domainAId: p.domainAId,
              domainBId: p.domainBId,
              domainAUrl: p.domainAUrl,
              domainBUrl: p.domainBUrl,
              textScore: p.textScore,
              sharedSentences: JSON.stringify(p.sharedSentences),
              sharedSentenceCount: p.sharedSentences.length,
              keywordHitsA: JSON.stringify(p.keywordHitsA),
              keywordHitsB: JSON.stringify(p.keywordHitsB),
              pageScores:
                p.pageScores.length > 0
                  ? JSON.stringify(p.pageScores)
                  : null,
              clusterId: p.clusterId,
              flagged: p.flagged,
              flagReasons: p.flagged
                ? JSON.stringify(p.flagReasons)
                : null,
            },
          })
        )
      );
    }

    // Step 10: Compute summary using blended scores
    const allBlendedScores = pairs.map((p) => {
      const bonus = Math.min(
        p.sharedSentences.length * SENTENCE_BONUS,
        MAX_SENTENCE_BONUS
      );
      return Math.min(100, p.textScore + bonus);
    });
    const avgScore =
      allBlendedScores.length > 0
        ? Math.round(
            allBlendedScores.reduce((a, b) => a + b, 0) /
              allBlendedScores.length
          )
        : 0;
    const maxScore =
      allBlendedScores.length > 0 ? Math.max(...allBlendedScores) : 0;

    const topPairs = [...pairs]
      .sort((a, b) => {
        const bonusA = Math.min(
          a.sharedSentences.length * SENTENCE_BONUS,
          MAX_SENTENCE_BONUS
        );
        const bonusB = Math.min(
          b.sharedSentences.length * SENTENCE_BONUS,
          MAX_SENTENCE_BONUS
        );
        return b.textScore + bonusB - (a.textScore + bonusA);
      })
      .slice(0, 5)
      .map((p) => ({
        domainAUrl: p.domainAUrl,
        domainBUrl: p.domainBUrl,
        textScore: p.textScore,
      }));

    const summary: AnalysisRunSummary = {
      domainCount: domainsWithText.length,
      pairCount: pairs.length,
      avgScore,
      maxScore,
      clusterCount: clusters.length,
      flaggedCount: flaggedPairs.length,
      clusters,
      flags,
      topPairs,
    };

    // Step 11: Update run
    await prisma.aboutUsAnalysisRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        pairCount: pairs.length,
        clusterCount: clusters.length,
        flaggedCount: flaggedPairs.length,
        summary: JSON.stringify(summary),
      },
    });

    console.log(
      `[Group Analysis] Complete: ${pairs.length} pairs, ${clusters.length} clusters, ${flaggedPairs.length} flagged`
    );
  } catch (error) {
    console.error(`[Group Analysis] Failed:`, error);
    await prisma.aboutUsAnalysisRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
