import { prisma } from "@/lib/prisma";
import {
  checkWebsiteActive,
} from "@/lib/utils";
import { extractDataPoint, extractAiGeneratedLikelihood } from "@/lib/extractors";
import type { AboutPageData } from "@/lib/extractors";
import { isDomainAuthorized, runDiscoveryPipeline } from "@/lib/discovery";
import { runRiskIntelPipeline, runHomepageSkuExtraction, runPolicyLinksExtraction } from "@/lib/domainIntel";
import type { DomainPolicy } from "@/lib/domainIntel/schemas";
import { getOrCreateArtifact, extractReadableText } from "@/lib/extractHomepageArtifact";
import { executeFetchLayer } from "@/lib/fetchLayer";
import { executeExtractionLayer } from "@/lib/extractionLayer";
import { executeModelLayer } from "@/lib/modelLayer";
import { captureScreenshot } from "@/lib/screenshots";
import { runIncrementalSimilarity } from "@/lib/similarityCheck";

const USE_LAYERED_ARCHITECTURE = process.env.USE_LAYERED_SCAN === "true";
const RISK_INTEL_TIMEOUT_MS = 90000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutError)), timeoutMs)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Original processScan (non-layered)
// ---------------------------------------------------------------------------
async function processScan(
  scanId: string,
  domainId: string,
  url: string,
  normalizedDomain: string
) {
  const logPrefix = `[Scan ${scanId.slice(-8)}]`;
  console.log(`${logPrefix} ▶ START processScan for ${normalizedDomain}`);

  try {
    console.log(`${logPrefix} [1/8] Updating status to processing...`);
    await prisma.websiteScan.update({
      where: { id: scanId },
      data: { status: "processing" },
    });

    console.log(`${logPrefix} [1.5/8] Checking website active status...`);
    const { isActive, statusCode: activeStatusCode } = await checkWebsiteActive(url);
    await prisma.$transaction([
      prisma.domain.update({
        where: { id: domainId },
        data: { isActive, statusCode: activeStatusCode },
      }),
      prisma.websiteScan.update({
        where: { id: scanId },
        data: { isActive, statusCode: activeStatusCode },
      }),
    ]);
    console.log(`${logPrefix} [1.5/8] ✓ Website ${isActive ? 'ACTIVE' : 'INACTIVE'} (${activeStatusCode})`);

    console.log(`${logPrefix} [2/8] Checking domain authorization...`);
    const authResult = await isDomainAuthorized(normalizedDomain);
    console.log(`${logPrefix} [2/8] Authorized: ${authResult.authorized}`);

    const extractedResults: Array<{
      key: string;
      label: string;
      value: any;
      sources: string[];
      rawOpenAIResponse: any;
    }> = [];

    let crawledPages: Map<string, string> | undefined;

    if (authResult.authorized && authResult.config) {
      console.log(`${logPrefix} [2/8] Running discovery pipeline...`);
      try {
        const discoveryResult = await runDiscoveryPipeline(
          scanId, url, normalizedDomain, authResult.config
        );
        crawledPages = discoveryResult.crawledPages;
        console.log(`${logPrefix} [2/8] ✓ Discovery complete, crawled ${crawledPages.size} pages`);

        if (!isActive && discoveryResult.crawledPages.size > 0) {
          const successfulFetch = await prisma.crawlFetchLog.findFirst({
            where: { scanId, statusCode: { gte: 200, lt: 400 } },
            orderBy: [{ source: 'asc' }],
          });
          if (successfulFetch) {
            console.log(`${logPrefix} Found successful fetch (${successfulFetch.source}), updating status to active`);
            await prisma.$transaction([
              prisma.websiteScan.update({
                where: { id: scanId },
                data: { isActive: true, statusCode: successfulFetch.statusCode },
              }),
              prisma.domain.update({
                where: { id: domainId },
                data: { isActive: true, statusCode: successfulFetch.statusCode },
              }),
            ]);
          }
        }

        try {
          const contactResult = await extractDataPoint(url, normalizedDomain, "contact_details");
          extractedResults.push(contactResult);
        } catch (contactError) {
          console.error("Error extracting contact details:", contactError);
        }
      } catch (discoveryError) {
        console.error("Error during discovery pipeline:", discoveryError);
        try {
          const contactResult = await extractDataPoint(url, normalizedDomain, "contact_details");
          extractedResults.push(contactResult);
        } catch (fallbackError) {
          console.error("Fallback extraction also failed:", fallbackError);
        }
      }
    } else {
      try {
        const contactResult = await extractDataPoint(url, normalizedDomain, "contact_details");
        extractedResults.push(contactResult);
      } catch (extractionError) {
        console.error("Error during data extraction:", extractionError);
      }
    }

    // PHASE 1: Data Collection (parallel)
    console.log(`${logPrefix} [3/8] Starting Phase 1: Data collection...`);
    const dataCollectionTasks: Promise<void>[] = [];
    const policyUrls: { privacy: string | null; refund: string | null; terms: string | null } = { privacy: null, refund: null, terms: null };

    if (authResult.authorized && authResult.config) {
      const skuPolicy: DomainPolicy = {
        isAuthorized: true,
        allowSubdomains: authResult.config.allowSubdomains,
        respectRobots: authResult.config.respectRobots,
        allowRobotsDisallowed: false,
        maxPagesPerRun: authResult.config.maxPagesPerScan,
        maxDepth: 2,
        crawlDelayMs: authResult.config.crawlDelayMs,
        requestTimeoutMs: 8000,
      };

      dataCollectionTasks.push(
        (async () => {
          try {
            const skuResult = await runHomepageSkuExtraction(scanId, url, skuPolicy);
            console.log(
              `Homepage SKU extraction for ${normalizedDomain}: ` +
              `found ${skuResult.items.length} SKUs, ` +
              `${skuResult.summary.withPrice} with price`
            );
          } catch (skuError) {
            console.error("Error running homepage SKU extraction:", skuError);
          }
        })()
      );

      const policyLinksPolicy: DomainPolicy = {
        isAuthorized: true,
        allowSubdomains: authResult.config.allowSubdomains,
        respectRobots: authResult.config.respectRobots,
        allowRobotsDisallowed: false,
        maxPagesPerRun: authResult.config.maxPagesPerScan,
        maxDepth: 2,
        crawlDelayMs: authResult.config.crawlDelayMs,
        requestTimeoutMs: 8000,
      };

      dataCollectionTasks.push(
        (async () => {
          try {
            const policyResult = await runPolicyLinksExtraction(scanId, url, policyLinksPolicy);
            policyUrls.privacy = policyResult.summary.privacy.url;
            policyUrls.refund = policyResult.summary.refund.url;
            policyUrls.terms = policyResult.summary.terms.url;
            console.log(
              `Policy links extraction for ${normalizedDomain}: ` +
              `privacy=${policyUrls.privacy ? 'found' : 'missing'}, ` +
              `refund=${policyUrls.refund ? 'found' : 'missing'}, ` +
              `terms=${policyUrls.terms ? 'found' : 'missing'}`
            );
          } catch (policyError) {
            console.error("Error running policy links extraction:", policyError);
          }
        })()
      );
    }

    // Screenshot capture
    dataCollectionTasks.push(
      captureScreenshot({ url, domainId, scanId, captureType: "auto" })
        .then((result) => {
          console.log(`${logPrefix} Screenshot: ${result.success ? "captured" : "failed"} (${result.durationMs}ms)`);
        })
        .catch((err) => {
          console.error(`${logPrefix} Screenshot capture error:`, err);
        })
    );

    // Page text extraction
    const contactResult = extractedResults.find((r) => r.key === "contact_details");
    const aboutPageUrl = contactResult?.value?.about_page_url;
    const contactPageUrl = contactResult?.value?.primary_contact_page_url;

    const ERROR_PAGE_PATTERNS = [
      /does not exist/i, /has been deleted/i, /page not found/i,
      /404\s*(error|not found)?/i, /no longer available/i,
      /this page (isn.t|is not) available/i, /return to (previous|home)/i,
      /access denied/i, /forbidden/i, /under construction/i, /coming soon/i,
    ];
    function isErrorPageContent(text: string | null): boolean {
      if (!text || text.length < 10) return true;
      const words = text.trim().split(/\s+/).length;
      if (words < 15) return ERROR_PAGE_PATTERNS.some((p) => p.test(text));
      return false;
    }

    type PageData = {
      page_url: string; text_content: string | null; word_count: number;
      headings: string[]; fetch_method: string; status_code: number | null;
      blocked: boolean; blocked_reason: string | null; artifact_id: string;
    };
    function buildPageData(pageUrl: string, artifact: any, artifactId: string, maxTextBytes: number): PageData {
      const readableText = artifact.htmlSnippet
        ? extractReadableText(artifact.htmlSnippet).substring(0, maxTextBytes)
        : artifact.textSnippet?.substring(0, maxTextBytes) || null;
      const actualWordCount = readableText ? readableText.trim().split(/\s+/).filter((w: string) => w.length > 0).length : 0;
      return {
        page_url: pageUrl, text_content: readableText, word_count: actualWordCount,
        headings: artifact.features?.headingTexts ?? [], fetch_method: artifact.fetchMethod,
        status_code: artifact.statusCode, blocked: artifact.features?.blocked ?? false,
        blocked_reason: artifact.features?.blockedReason ?? null, artifact_id: artifactId,
      };
    }

    let aboutPageResult: AboutPageData | null = null;
    let homepageTextResult: PageData | null = null;
    let contactPageResult: PageData | null = null;

    if (aboutPageUrl) {
      dataCollectionTasks.push(
        (async () => {
          try {
            console.log(`${logPrefix} Extracting about page artifact from ${aboutPageUrl}...`);
            const { artifact, artifactId } = await getOrCreateArtifact(aboutPageUrl, "about");
            if (!artifact.ok) { console.log(`${logPrefix} ✗ About page fetch failed (${artifact.statusCode})`); return; }
            const data = buildPageData(aboutPageUrl, artifact, artifactId, 8 * 1024);
            if (isErrorPageContent(data.text_content)) { console.log(`${logPrefix} ✗ About page looks like error page`); return; }
            aboutPageResult = {
              about_page_url: aboutPageUrl, text_content: data.text_content,
              word_count: data.word_count, headings: data.headings,
              fetch_method: data.fetch_method, status_code: data.status_code,
              blocked: data.blocked, blocked_reason: data.blocked_reason, artifact_id: data.artifact_id,
            };
            console.log(`${logPrefix} ✓ About page extracted: ${data.word_count} words`);
          } catch (aboutError) {
            console.error(`${logPrefix} Error extracting about page:`, aboutError);
          }
        })()
      );
    }

    dataCollectionTasks.push(
      (async () => {
        try {
          console.log(`${logPrefix} Extracting homepage text artifact from ${url}...`);
          const { artifact, artifactId } = await getOrCreateArtifact(url, "homepage");
          if (!artifact.ok) {
            if (crawledPages) {
              const homepageHtml = crawledPages.get(url) || crawledPages.get(url.replace(/\/$/, "")) || crawledPages.get(url + "/") || Array.from(crawledPages.entries()).find(([k]) => new URL(k).pathname === "/" || new URL(k).pathname === "")?.[1] || crawledPages.values().next().value;
              if (homepageHtml && homepageHtml.length > 200) {
                const readableText = extractReadableText(homepageHtml).substring(0, 16 * 1024);
                const wordCount = readableText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
                if (!isErrorPageContent(readableText)) {
                  homepageTextResult = {
                    page_url: url, text_content: readableText, word_count: wordCount,
                    headings: [], fetch_method: "crawl", status_code: 200,
                    blocked: false, blocked_reason: null, artifact_id: artifactId,
                  };
                  console.log(`${logPrefix} ✓ Homepage text from crawled content: ${wordCount} words`);
                  return;
                }
              }
            }
            console.log(`${logPrefix} ✗ Homepage fetch failed (${artifact.statusCode}), skipping`);
            return;
          }
          const hpData = buildPageData(url, artifact, artifactId, 16 * 1024);
          if (isErrorPageContent(hpData.text_content)) { console.log(`${logPrefix} ✗ Homepage looks like error page`); return; }
          homepageTextResult = hpData;
          console.log(`${logPrefix} ✓ Homepage text extracted: ${homepageTextResult.word_count} words`);
        } catch (homepageError) {
          console.error(`${logPrefix} Error extracting homepage text:`, homepageError);
        }
      })()
    );

    if (contactPageUrl) {
      dataCollectionTasks.push(
        (async () => {
          try {
            console.log(`${logPrefix} Extracting contact page artifact from ${contactPageUrl}...`);
            const { artifact, artifactId } = await getOrCreateArtifact(contactPageUrl, "contact");
            if (!artifact.ok) {
              try {
                const { fetchWithBrowser: fetchBrowser, closeBrowser: closeBr } = await import("@/lib/browser");
                const browserResult = await fetchBrowser(null, contactPageUrl, "contact-text", {
                  waitForNetworkIdle: true, additionalWaitMs: 1000,
                });
                await closeBr().catch(() => {});
                if (browserResult.content && browserResult.content.length > 200) {
                  const readableText = extractReadableText(browserResult.content).substring(0, 8 * 1024);
                  const wordCount = readableText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
                  if (wordCount > 10 && !isErrorPageContent(readableText)) {
                    contactPageResult = {
                      page_url: contactPageUrl, text_content: readableText, word_count: wordCount,
                      headings: [], fetch_method: "browser", status_code: browserResult.statusCode || 200,
                      blocked: false, blocked_reason: null, artifact_id: artifactId,
                    };
                    console.log(`${logPrefix} ✓ Contact page text via browser fallback: ${wordCount} words`);
                    return;
                  }
                }
              } catch { /* Browser fallback failed */ }
              console.log(`${logPrefix} ✗ Contact page fetch failed (${artifact.statusCode}), skipping`);
              return;
            }
            const cpData = buildPageData(contactPageUrl, artifact, artifactId, 8 * 1024);
            if (isErrorPageContent(cpData.text_content)) { console.log(`${logPrefix} ✗ Contact page looks like error page`); return; }
            contactPageResult = cpData;
            console.log(`${logPrefix} ✓ Contact page text extracted: ${contactPageResult.word_count} words`);
          } catch (contactPageError) {
            console.error(`${logPrefix} Error extracting contact page text:`, contactPageError);
          }
        })()
      );
    }

    console.log(`${logPrefix} [3/8] Waiting for ${dataCollectionTasks.length} data collection tasks...`);
    await Promise.all(dataCollectionTasks);

    // Enrich contact_details with contact page text
    const contactText = (contactPageResult as PageData | null)?.text_content;
    if (contactText) {
      const contactDetailsResult = extractedResults.find(r => r.key === "contact_details");
      if (contactDetailsResult) {
        const val = contactDetailsResult.value as any;
        if (!val.emails || val.emails.length === 0) {
          const emailMatches = contactText.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g);
          if (emailMatches) {
            val.emails = [...new Set(emailMatches)];
            console.log(`${logPrefix} Enriched contact_details with emails from contact page`);
          }
        }
        if (!val.phone_numbers || val.phone_numbers.length === 0) {
          const phoneMatches = contactText.match(/\+?\(?\d[\d\s\-().]{7,}\d/g);
          if (phoneMatches) {
            val.phone_numbers = [...new Set(phoneMatches.map((p: string) => p.trim()))];
            console.log(`${logPrefix} Enriched contact_details with phones from contact page`);
          }
        }
      }
    }

    // Policy page text extraction
    const policyPageResults: { key: string; label: string; url: string; data: PageData }[] = [];
    const POLICY_PAGES = [
      { key: "privacy_page", label: "Privacy policy", url: policyUrls.privacy, pageType: "privacy" },
      { key: "refund_page", label: "Refund policy", url: policyUrls.refund, pageType: "refund" },
      { key: "terms_page", label: "Terms of service", url: policyUrls.terms, pageType: "terms" },
    ] as const;

    const policyTextTasks = POLICY_PAGES.filter((p) => p.url).map((p) =>
      (async () => {
        try {
          console.log(`${logPrefix} Extracting ${p.label} text from ${p.url}...`);
          const { artifact, artifactId } = await getOrCreateArtifact(p.url!, p.pageType);
          if (!artifact.ok) { console.log(`${logPrefix} ✗ ${p.label} fetch failed`); return; }
          const ppData = buildPageData(p.url!, artifact, artifactId, 8 * 1024);
          if (isErrorPageContent(ppData.text_content)) return;
          policyPageResults.push({ key: p.key, label: p.label, url: p.url!, data: ppData });
          console.log(`${logPrefix} ✓ ${p.label} text extracted`);
        } catch (err) {
          console.error(`${logPrefix} Error extracting ${p.label} text:`, err);
        }
      })()
    );
    if (policyTextTasks.length > 0) await Promise.all(policyTextTasks);
    console.log(`${logPrefix} [3/8] ✓ Phase 1 complete`);

    // PHASE 2: Save contact details to DB
    console.log(`${logPrefix} [4/8] Phase 2: Saving ${extractedResults.length} contact details...`);
    if (extractedResults.length > 0) {
      const dbOperations = extractedResults.flatMap((extractedResult) => [
        prisma.scanDataPoint.create({
          data: {
            scanId, key: extractedResult.key, label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
        }),
        prisma.domainDataPoint.upsert({
          where: { domainId_key: { domainId, key: extractedResult.key } },
          create: {
            domainId, key: extractedResult.key, label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
          update: {
            label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
            extractedAt: new Date(),
          },
        }),
      ]);
      await prisma.$transaction(dbOperations);
    }

    async function savePageTextPoint(key: string, label: string, data: any, sources: string[]) {
      const valueJson = JSON.stringify(data);
      const sourcesJson = JSON.stringify(sources);
      const emptyJson = JSON.stringify({});
      await prisma.scanDataPoint.create({
        data: { scanId, key, label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: emptyJson },
      });
      await prisma.domainDataPoint.upsert({
        where: { domainId_key: { domainId, key } },
        create: { domainId, key, label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: emptyJson },
        update: { value: valueJson, sources: sourcesJson, rawOpenAIResponse: emptyJson, extractedAt: new Date() },
      });
      console.log(`${logPrefix} [4/8] ✓ ${label} data point saved`);
    }

    if (aboutPageResult) await savePageTextPoint("about_page", "About page", aboutPageResult, aboutPageUrl ? [aboutPageUrl] : []);
    if (homepageTextResult) await savePageTextPoint("homepage_text", "Homepage text", homepageTextResult, [url]);
    if (contactPageResult) await savePageTextPoint("contact_page", "Contact page", contactPageResult, contactPageUrl ? [contactPageUrl] : []);
    for (const pp of policyPageResults) {
      await savePageTextPoint(pp.key, pp.label, pp.data, [pp.url]);
    }

    const assessmentResults: typeof extractedResults = [];

    // PHASE 3a: AI Analysis
    console.log(`${logPrefix} [5/8] Phase 3a: AI analysis...`);
    try {
      const aiResult = await extractAiGeneratedLikelihood(scanId, url, normalizedDomain, crawledPages);
      assessmentResults.push(aiResult);
      console.log(`${logPrefix} [5/8] ✓ AI analysis complete`);
    } catch (aiError) {
      console.error("Error extracting AI-generated likelihood:", aiError);
    }

    console.log(`${logPrefix} [6/8] Saving AI likelihood...`);
    if (assessmentResults.length > 0) {
      const assessmentDbOps = assessmentResults.flatMap((extractedResult) => [
        prisma.scanDataPoint.create({
          data: {
            scanId, key: extractedResult.key, label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
        }),
        prisma.domainDataPoint.upsert({
          where: { domainId_key: { domainId, key: extractedResult.key } },
          create: {
            domainId, key: extractedResult.key, label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
          update: {
            label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
            extractedAt: new Date(),
          },
        }),
      ]);
      await prisma.$transaction(assessmentDbOps);
    }
    console.log(`${logPrefix} [6/8] ✓ AI likelihood saved`);

    // PHASE 3b: Risk Assessment
    console.log(`${logPrefix} [7/8] Phase 3b: Risk assessment...`);
    try {
      const riskResult = await withTimeout(
        runRiskIntelPipeline(scanId, url),
        RISK_INTEL_TIMEOUT_MS,
        `Risk intelligence pipeline timed out after ${RISK_INTEL_TIMEOUT_MS / 1000}s`
      );
      if (riskResult.error) {
        console.warn("Risk intelligence pipeline completed with errors:", riskResult.error);
      } else {
        console.log(
          `${logPrefix} [7/8] ✓ Risk score: ${riskResult.assessment.overall_risk_score}/100 ` +
          `(${riskResult.assessment.primary_risk_type}, confidence: ${riskResult.assessment.confidence})`
        );
      }
    } catch (riskError) {
      console.error("Error running risk intelligence pipeline:", riskError);
    }

    // Run similarity check before marking complete
    console.log(`${logPrefix} [8/9] Running similarity check...`);
    await runIncrementalSimilarity(domainId, normalizedDomain).catch((err) => {
      console.error(`${logPrefix} Similarity check failed (non-fatal):`, err);
    });

    // Mark scan as completed and update domain lastCheckedAt
    console.log(`${logPrefix} [9/9] Marking scan as completed...`);
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.websiteScan.update({
        where: { id: scanId },
        data: { status: "completed", error: null },
      }),
      prisma.domain.update({
        where: { id: domainId },
        data: { lastCheckedAt: completedAt },
      }),
    ]);
    console.log(`${logPrefix} ✅ SCAN COMPLETED SUCCESSFULLY`);
  } catch (error) {
    console.error(`[Scan ${scanId.slice(-8)}] ❌ SCAN FAILED:`, error);
    try {
      await prisma.websiteScan.update({
        where: { id: scanId },
        data: { status: "failed", error: error instanceof Error ? error.message : "Unknown error" },
      });
    } catch (updateError) {
      console.error(`[Scan ${scanId.slice(-8)}] Failed to update status to failed:`, updateError);
    }
  }
}

// ---------------------------------------------------------------------------
// Layered processScan
// ---------------------------------------------------------------------------
async function processScanLayered(
  scanId: string,
  domainId: string,
  url: string,
  normalizedDomain: string
) {
  const logPrefix = `[Scan ${scanId.slice(-8)}]`;
  console.log(`${logPrefix} ▶ START processScanLayered (3-layer) for ${normalizedDomain}`);

  try {
    console.log(`${logPrefix} [1/5] Updating status to processing...`);
    await prisma.websiteScan.update({
      where: { id: scanId },
      data: { status: "processing" },
    });

    console.log(`${logPrefix} [1.5/5] Checking website active status...`);
    const { isActive, statusCode: activeStatusCode } = await checkWebsiteActive(url);
    await prisma.$transaction([
      prisma.domain.update({
        where: { id: domainId },
        data: { isActive, statusCode: activeStatusCode },
      }),
      prisma.websiteScan.update({
        where: { id: scanId },
        data: { isActive, statusCode: activeStatusCode },
      }),
    ]);
    console.log(`${logPrefix} [1.5/5] ✓ Website ${isActive ? 'ACTIVE' : 'INACTIVE'} (${activeStatusCode})`);

    console.log(`${logPrefix} [1/5] Checking domain authorization...`);
    const authResult = await isDomainAuthorized(normalizedDomain);
    console.log(`${logPrefix} [1/5] Authorized: ${authResult.authorized}`);

    const policy: DomainPolicy = authResult.authorized && authResult.config
      ? {
          isAuthorized: true, allowSubdomains: authResult.config.allowSubdomains,
          respectRobots: authResult.config.respectRobots, allowRobotsDisallowed: false,
          maxPagesPerRun: authResult.config.maxPagesPerScan, maxDepth: 2,
          crawlDelayMs: authResult.config.crawlDelayMs, requestTimeoutMs: 8000,
        }
      : {
          isAuthorized: false, allowSubdomains: true, respectRobots: true,
          allowRobotsDisallowed: false, maxPagesPerRun: 10, maxDepth: 1,
          crawlDelayMs: 1000, requestTimeoutMs: 8000,
        };

    console.log(`${logPrefix} [2/5] Layer 1: Fetching all content...`);
    const contentStore = await executeFetchLayer({ scanId, url, domain: normalizedDomain, policy });
    console.log(`${logPrefix} [2/5] ✓ Fetch layer complete (errors: ${contentStore.fetchErrors.length})`);

    if (!isActive && contentStore.homepage?.statusCode === 200) {
      await prisma.$transaction([
        prisma.websiteScan.update({ where: { id: scanId }, data: { isActive: true, statusCode: contentStore.homepage.statusCode } }),
        prisma.domain.update({ where: { id: domainId }, data: { isActive: true, statusCode: contentStore.homepage.statusCode } }),
      ]);
    }

    const screenshotPromise = captureScreenshot({ url, domainId, scanId, captureType: "auto" })
      .then((result) => { console.log(`${logPrefix} Screenshot: ${result.success ? "captured" : "failed"} (${result.durationMs}ms)`); })
      .catch((err) => { console.error(`${logPrefix} Screenshot capture error:`, err); });

    console.log(`${logPrefix} [3/5] Layer 2: Extracting signals...`);
    const extractionResults = executeExtractionLayer(contentStore, policy);
    console.log(`${logPrefix} [3/5] ✓ Extraction layer complete`);

    console.log(`${logPrefix} [4/5] Layer 3: AI analysis and scoring...`);
    const modelResults = await executeModelLayer(contentStore, extractionResults);
    console.log(`${logPrefix} [4/5] ✓ Model layer complete (risk: ${modelResults.riskAssessment.overall_risk_score})`);

    console.log(`${logPrefix} [5/5] Persisting results...`);

    await prisma.$transaction([
      prisma.scanDataPoint.create({
        data: {
          scanId, key: "contact_details", label: "Contact details",
          value: JSON.stringify(modelResults.contactDetails),
          sources: JSON.stringify([url]),
          rawOpenAIResponse: JSON.stringify({ layered: true }),
        },
      }),
      prisma.domainDataPoint.upsert({
        where: { domainId_key: { domainId, key: "contact_details" } },
        create: { domainId, key: "contact_details", label: "Contact details", value: JSON.stringify(modelResults.contactDetails), sources: JSON.stringify([url]), rawOpenAIResponse: JSON.stringify({ layered: true }) },
        update: { value: JSON.stringify(modelResults.contactDetails), sources: JSON.stringify([url]), rawOpenAIResponse: JSON.stringify({ layered: true }), extractedAt: new Date() },
      }),
    ]);

    await prisma.$transaction([
      prisma.scanDataPoint.create({
        data: {
          scanId, key: "ai_generated_likelihood", label: "AI-generated likelihood",
          value: JSON.stringify({
            ai_generated_score: modelResults.aiLikelihood.aiGeneratedScore,
            confidence: modelResults.aiLikelihood.confidence,
            subscores: modelResults.aiLikelihood.subscores,
            signals: modelResults.aiLikelihood.signals,
            reasons: modelResults.aiLikelihood.reasons,
            notes: modelResults.aiLikelihood.notes,
          }),
          sources: JSON.stringify([url]),
          rawOpenAIResponse: JSON.stringify({ layered: true }),
        },
      }),
      prisma.domainDataPoint.upsert({
        where: { domainId_key: { domainId, key: "ai_generated_likelihood" } },
        create: {
          domainId, key: "ai_generated_likelihood", label: "AI-generated likelihood",
          value: JSON.stringify({ ai_generated_score: modelResults.aiLikelihood.aiGeneratedScore, confidence: modelResults.aiLikelihood.confidence, subscores: modelResults.aiLikelihood.subscores, signals: modelResults.aiLikelihood.signals, reasons: modelResults.aiLikelihood.reasons, notes: modelResults.aiLikelihood.notes }),
          sources: JSON.stringify([url]), rawOpenAIResponse: JSON.stringify({ layered: true }),
        },
        update: {
          value: JSON.stringify({ ai_generated_score: modelResults.aiLikelihood.aiGeneratedScore, confidence: modelResults.aiLikelihood.confidence, subscores: modelResults.aiLikelihood.subscores, signals: modelResults.aiLikelihood.signals, reasons: modelResults.aiLikelihood.reasons, notes: modelResults.aiLikelihood.notes }),
          sources: JSON.stringify([url]), rawOpenAIResponse: JSON.stringify({ layered: true }), extractedAt: new Date(),
        },
      }),
    ]);

    await screenshotPromise;

    // Run similarity check before marking complete
    console.log(`${logPrefix} Running similarity check...`);
    await runIncrementalSimilarity(domainId, normalizedDomain).catch((err) => {
      console.error(`${logPrefix} Similarity check failed (non-fatal):`, err);
    });

    const completedAt = new Date();
    await prisma.$transaction([
      prisma.websiteScan.update({
        where: { id: scanId },
        data: { status: "completed", error: null },
      }),
      prisma.domain.update({
        where: { id: domainId },
        data: { lastCheckedAt: completedAt },
      }),
    ]);
    console.log(`${logPrefix} ✅ SCAN COMPLETED SUCCESSFULLY (layered)`);
  } catch (error) {
    console.error(`[Scan ${scanId.slice(-8)}] ❌ SCAN FAILED (layered):`, error);
    try {
      await prisma.websiteScan.update({
        where: { id: scanId },
        data: { status: "failed", error: error instanceof Error ? error.message : "Unknown error" },
      });
    } catch (updateError) {
      console.error(`[Scan ${scanId.slice(-8)}] Failed to update status to failed:`, updateError);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a single scan. Picks between layered and original implementation
 * based on the USE_LAYERED_SCAN env flag.
 *
 * This is the core function — called directly by both single scan API and
 * the bulk queue processor. No HTTP self-calls.
 */
export async function processScanWrapper(
  scanId: string,
  domainId: string,
  url: string,
  normalizedDomain: string
) {
  if (USE_LAYERED_ARCHITECTURE) {
    return processScanLayered(scanId, domainId, url, normalizedDomain);
  } else {
    return processScan(scanId, domainId, url, normalizedDomain);
  }
}
