import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkWebsiteActive } from "@/lib/utils";
import { extractDataPoint, extractDataPointFromContent, extractAiGeneratedLikelihood } from "@/lib/extractors";
import type { AboutPageData } from "@/lib/extractors";
import { isDomainAuthorized, runDiscoveryPipeline } from "@/lib/discovery";
import { runRiskIntelPipeline, runHomepageSkuExtraction, runPolicyLinksExtraction } from "@/lib/domainIntel";
import type { DomainPolicy } from "@/lib/domainIntel/schemas";
import { captureScreenshot } from "@/lib/screenshots";
import { getOrCreateArtifact, extractReadableText } from "@/lib/extractHomepageArtifact";
import { runIncrementalSimilarity } from "@/lib/similarityCheck";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // The ID could be either a domain ID (hash) or a scan ID
    // First try to find as domain ID
    let domain = await prisma.domain.findUnique({
      where: { id },
      include: {
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    // If not found as domain, try to find the scan and get its domain
    if (!domain) {
      const existingScan = await prisma.websiteScan.findUnique({
        where: { id },
        include: { domain: true },
      });

      if (!existingScan) {
        return NextResponse.json({ error: "Domain or scan not found" }, { status: 404 });
      }

      domain = await prisma.domain.findUnique({
        where: { id: existingScan.domainId },
        include: {
          scans: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
    }

    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    // Use the most recent scan URL or construct from normalized domain
    const scanUrl = domain.scans[0]?.url || `https://${domain.normalizedUrl}`;

    // Step 1: Check if website is still active
    console.log(`\n[1/10] Checking website status: ${scanUrl}`);
    const { isActive, statusCode } = await checkWebsiteActive(scanUrl);
    const checkedAt = new Date();
    console.log(`[1/10] ✓ Website status: ${isActive ? 'ACTIVE' : 'INACTIVE'} (${statusCode || 'no response'})`);

    // Step 2: Create scan record
    console.log(`[2/10] Creating scan record...`);
    const newScan = await prisma.websiteScan.create({
      data: {
        domainId: domain.id,
        url: scanUrl,
        isActive,
        statusCode,
        checkedAt,
        status: "processing",
      },
    });

    // Update domain's last checked info
    await prisma.domain.update({
      where: { id: domain.id },
      data: {
        isActive,
        statusCode,
        lastCheckedAt: checkedAt,
      },
    });
    console.log(`[2/10] ✓ Scan record created: ${newScan.id}`);

    // Step 3: Check authorization
    console.log(`[3/10] Checking domain authorization...`);
    const authResult = await isDomainAuthorized(domain.normalizedUrl);
    console.log(`[3/10] ✓ Authorization: ${authResult.authorized ? 'AUTHORIZED' : 'NOT AUTHORIZED'}`);

    const extractedResults: Array<{
      key: string;
      label: string;
      value: any;
      sources: string[];
      rawOpenAIResponse: any;
    }> = [];

    let crawledPages: Map<string, string> | undefined;

    if (authResult.authorized && authResult.config) {
      // Step 4: Run full discovery pipeline for authorized domains
      console.log(`[4/10] Running discovery pipeline (robots.txt, sitemap, crawl)...`);
      try {
        const discoveryResult = await runDiscoveryPipeline(
          newScan.id,
          scanUrl,
          domain.normalizedUrl,
          authResult.config
        );

        crawledPages = discoveryResult.crawledPages;
        console.log(`[4/10] ✓ Discovery complete: ${crawledPages.size} pages crawled`);

        // Update active status based on crawl results if initial check failed
        if (!isActive && discoveryResult.crawledPages.size > 0) {
          // Look for any successful fetch - homepage first, then any browser-based fetch
          // This handles sites with SSL issues where HTTP fails but browser works
          const successfulFetch = await prisma.crawlFetchLog.findFirst({
            where: {
              scanId: newScan.id,
              statusCode: { gte: 200, lt: 400 },
            },
            orderBy: [
              // Prefer homepage sources, then any other source
              { source: 'asc' }, // 'homepage' comes before 'contact_page_browser' alphabetically
            ],
          });

          if (successfulFetch) {
            console.log(`[4/10] Found successful fetch (${successfulFetch.source}), updating status to active`);
            await prisma.$transaction([
              prisma.websiteScan.update({
                where: { id: newScan.id },
                data: {
                  isActive: true,
                  statusCode: successfulFetch.statusCode,
                },
              }),
              prisma.domain.update({
                where: { id: domain.id },
                data: {
                  isActive: true,
                  statusCode: successfulFetch.statusCode,
                },
              }),
            ]);
          }
        }

        // Step 5: Extract contact details from crawled content
        if (discoveryResult.crawledPages.size > 0) {
          const sources = Array.from(discoveryResult.crawledPages.keys());
          console.log(`[5/10] Extracting contact details from ${sources.length} pages...`);
          try {
            const contactResult = await extractDataPointFromContent(
              scanUrl,
              domain.normalizedUrl,
              "contact_details",
              discoveryResult.crawledPages,
              sources
            );
            extractedResults.push(contactResult);
            console.log(`[5/10] ✓ Contact extraction complete`);
          } catch (contactError) {
            console.error(`[5/10] ✗ Contact extraction failed:`, contactError);
          }
        } else {
          console.log(`[5/10] ⊘ Skipped (no pages crawled)`);
        }
      } catch (discoveryError) {
        console.error(`[4/10] ✗ Discovery pipeline failed:`, discoveryError);
        // Fall back to basic extraction
        console.log(`[5/10] Falling back to basic contact extraction...`);
        try {
          const contactResult = await extractDataPoint(
            scanUrl,
            domain.normalizedUrl,
            "contact_details"
          );
          extractedResults.push(contactResult);
          console.log(`[5/10] ✓ Contact extraction complete (fallback)`);
        } catch (fallbackError) {
          console.error(`[5/10] ✗ Fallback extraction also failed:`, fallbackError);
        }
      }
    } else {
      // Domain not authorized - use basic extraction
      console.log(`[4/10] ⊘ Skipped (domain not authorized)`);
      console.log(`[5/10] Extracting contact details (basic mode)...`);
      try {
        const contactResult = await extractDataPoint(
          scanUrl,
          domain.normalizedUrl,
          "contact_details"
        );
        extractedResults.push(contactResult);
        console.log(`[5/10] ✓ Contact extraction complete`);
      } catch (extractionError) {
        console.error(`[5/10] ✗ Contact extraction failed:`, extractionError);
      }
    }

    // Step 6: Extract SKUs & Policy links (for authorized domains)
    const rescanPolicyUrls: { privacy: string | null; refund: string | null; terms: string | null } = { privacy: null, refund: null, terms: null };
    if (authResult.authorized && authResult.config) {
      console.log(`[6/10] Extracting homepage SKUs & policy links...`);
      const policy: DomainPolicy = {
        isAuthorized: true,
        allowSubdomains: authResult.config.allowSubdomains,
        respectRobots: authResult.config.respectRobots,
        allowRobotsDisallowed: false,
        maxPagesPerRun: authResult.config.maxPagesPerScan,
        maxDepth: 2,
        crawlDelayMs: authResult.config.crawlDelayMs,
        requestTimeoutMs: 8000,
      };

      const extractionTasks: Promise<void>[] = [];

      // Homepage SKU extraction
      extractionTasks.push(
        (async () => {
          try {
            const skuResult = await runHomepageSkuExtraction(newScan.id, scanUrl, policy);
            console.log(`[6/10] SKUs: found ${skuResult.items.length}, ${skuResult.summary.withPrice} with price`);
          } catch (skuError) {
            console.error(`[6/10] ✗ SKU extraction failed:`, skuError);
          }
        })()
      );

      // Policy links extraction
      extractionTasks.push(
        (async () => {
          try {
            const policyResult = await runPolicyLinksExtraction(newScan.id, scanUrl, policy);
            rescanPolicyUrls.privacy = policyResult.summary.privacy.url;
            rescanPolicyUrls.refund = policyResult.summary.refund.url;
            rescanPolicyUrls.terms = policyResult.summary.terms.url;
            console.log(`[6/10] Policies: privacy=${rescanPolicyUrls.privacy ? '✓' : '✗'}, refund=${rescanPolicyUrls.refund ? '✓' : '✗'}, terms=${rescanPolicyUrls.terms ? '✓' : '✗'}`);
          } catch (policyError) {
            console.error(`[6/10] ✗ Policy extraction failed:`, policyError);
          }
        })()
      );

      await Promise.all(extractionTasks);
      console.log(`[6/10] ✓ SKU & Policy extraction complete`);
    } else {
      console.log(`[6/10] ⊘ Skipped (domain not authorized)`);
    }

    // Screenshot capture (runs in parallel with remaining steps)
    const screenshotPromise = captureScreenshot({
      url: scanUrl,
      domainId: domain.id,
      scanId: newScan.id,
      captureType: "auto",
    })
      .then((result) => {
        console.log(`Screenshot: ${result.success ? "captured" : "failed"} (${result.durationMs}ms)`);
      })
      .catch((err) => {
        console.error("Screenshot capture error:", err);
      });

    // Page text extraction (runs in parallel with remaining steps)
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
      if (words < 15) {
        return ERROR_PAGE_PATTERNS.some((p) => p.test(text));
      }
      return false;
    }

    type PageData = { page_url: string; text_content: string | null; word_count: number; headings: string[]; fetch_method: string; status_code: number | null; blocked: boolean; blocked_reason: string | null; artifact_id: string };
    function buildPageData(pageUrl: string, artifact: any, artifactId: string, maxTextBytes: number): PageData {
      const readableText = artifact.htmlSnippet
        ? extractReadableText(artifact.htmlSnippet).substring(0, maxTextBytes)
        : artifact.textSnippet?.substring(0, maxTextBytes) || null;
      const actualWordCount = readableText ? readableText.trim().split(/\s+/).filter((w: string) => w.length > 0).length : 0;
      return {
        page_url: pageUrl, text_content: readableText,
        word_count: actualWordCount, headings: artifact.features?.headingTexts ?? [],
        fetch_method: artifact.fetchMethod, status_code: artifact.statusCode,
        blocked: artifact.features?.blocked ?? false, blocked_reason: artifact.features?.blockedReason ?? null,
        artifact_id: artifactId,
      };
    }

    let aboutPageResult: AboutPageData | null = null;
    let homepageTextResult: PageData | null = null;
    let contactPageResult: PageData | null = null;

    const pageExtractionPromises: Promise<void>[] = [];

    // About page
    if (aboutPageUrl) {
      pageExtractionPromises.push(
        (async () => {
          try {
            console.log(`[6.5/10] Extracting about page artifact from ${aboutPageUrl}...`);
            const { artifact, artifactId } = await getOrCreateArtifact(aboutPageUrl, "about", { skipCache: true });
            if (!artifact.ok) {
              console.log(`[6.5/10] ✗ About page fetch failed (${artifact.statusCode}), keeping existing data`);
              return;
            }
            const data = buildPageData(aboutPageUrl, artifact, artifactId, 8 * 1024);
            if (isErrorPageContent(data.text_content)) {
              console.log(`[6.5/10] ✗ About page looks like an error page (${data.word_count} words), skipping`);
              return;
            }
            aboutPageResult = {
              about_page_url: aboutPageUrl, text_content: data.text_content,
              word_count: data.word_count, headings: data.headings,
              fetch_method: data.fetch_method, status_code: data.status_code,
              blocked: data.blocked, blocked_reason: data.blocked_reason, artifact_id: data.artifact_id,
            };
            console.log(`[6.5/10] ✓ About page extracted: ${data.word_count} words, ${data.headings.length} headings`);
          } catch (aboutError) {
            console.error(`[6.5/10] ✗ About page extraction failed:`, aboutError);
          }
        })()
      );
    }

    // Homepage text
    pageExtractionPromises.push(
      (async () => {
        try {
          console.log(`[6.5/10] Extracting homepage text artifact from ${scanUrl}...`);
          const { artifact, artifactId } = await getOrCreateArtifact(scanUrl, "homepage", { skipCache: true });
          if (!artifact.ok) {
            // Fallback: use already-crawled homepage HTML from discovery pipeline
            if (crawledPages) {
              // crawledPages uses full URLs as keys, find the homepage by URL match
              const homepageHtml = crawledPages.get(scanUrl) || crawledPages.get(scanUrl.replace(/\/$/, "")) || crawledPages.get(scanUrl + "/") || Array.from(crawledPages.entries()).find(([k]) => new URL(k).pathname === "/" || new URL(k).pathname === "")?.[1] || crawledPages.values().next().value;
              console.log(`[6.5/10] Crawled pages fallback: ${crawledPages.size} pages available, homepage match: ${!!homepageHtml}`);
              if (homepageHtml && homepageHtml.length > 200) {
                const readableText = extractReadableText(homepageHtml).substring(0, 16 * 1024);
                const wordCount = readableText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
                if (!isErrorPageContent(readableText)) {
                  homepageTextResult = {
                    page_url: scanUrl, text_content: readableText, word_count: wordCount,
                    headings: [], fetch_method: "crawl", status_code: 200,
                    blocked: false, blocked_reason: null, artifact_id: artifactId,
                  };
                  console.log(`[6.5/10] ✓ Homepage text from crawled content: ${wordCount} words`);
                  return;
                }
              }
            }
            console.log(`[6.5/10] ✗ Homepage fetch failed (${artifact.statusCode}), skipping`);
            return;
          }
          const hpData = buildPageData(scanUrl, artifact, artifactId, 16 * 1024);
          if (isErrorPageContent(hpData.text_content)) {
            console.log(`[6.5/10] ✗ Homepage looks like an error page, skipping`);
            return;
          }
          homepageTextResult = hpData;
          console.log(`[6.5/10] ✓ Homepage text extracted: ${homepageTextResult.word_count} words`);
        } catch (err) {
          console.error(`[6.5/10] ✗ Homepage text extraction failed:`, err);
        }
      })()
    );

    // Contact page text
    if (contactPageUrl) {
      pageExtractionPromises.push(
        (async () => {
          try {
            console.log(`[6.5/10] Extracting contact page artifact from ${contactPageUrl}...`);
            const { artifact, artifactId } = await getOrCreateArtifact(contactPageUrl, "contact", { skipCache: true });
            if (!artifact.ok) {
              // Fallback: fetch contact page directly with browser
              try {
                const { fetchWithBrowser: fetchBrowser, closeBrowser: closeBr } = await import("@/lib/browser");
                const browserResult = await fetchBrowser(null, contactPageUrl, "contact-text", {
                  waitForNetworkIdle: true,
                  additionalWaitMs: 1000,
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
                    console.log(`[6.5/10] ✓ Contact page text via browser fallback: ${wordCount} words`);
                    return;
                  }
                }
              } catch (e) {
                // Browser fallback failed
              }
              console.log(`[6.5/10] ✗ Contact page fetch failed (${artifact.statusCode}), skipping`);
              return;
            }
            const cpData = buildPageData(contactPageUrl, artifact, artifactId, 8 * 1024);
            if (isErrorPageContent(cpData.text_content)) {
              console.log(`[6.5/10] ✗ Contact page looks like an error page, skipping`);
              return;
            }
            contactPageResult = cpData;
            console.log(`[6.5/10] ✓ Contact page text extracted: ${contactPageResult.word_count} words`);
          } catch (err) {
            console.error(`[6.5/10] ✗ Contact page text extraction failed:`, err);
          }
        })()
      );
    }

    const aboutPagePromise = Promise.all(pageExtractionPromises);

    // Step 7: AI analysis (extracts AI-generated likelihood)
    console.log(`[7/10] Running AI analysis...`);
    try {
      const aiResult = await extractAiGeneratedLikelihood(
        newScan.id,
        scanUrl,
        domain.normalizedUrl,
        crawledPages
      );
      extractedResults.push(aiResult);
      console.log(`[7/10] ✓ AI analysis complete`);
    } catch (aiError) {
      console.error(`[7/10] ✗ AI analysis failed:`, aiError);
    }

    // Wait for page extraction to finish before saving
    await aboutPagePromise;

    // Enrich contact_details with data from the contact page text
    // The AI at step 5 only had homepage content; the contact page was fetched at step 6.5
    const contactText = (contactPageResult as PageData | null)?.text_content;
    if (contactText) {
      const contactDetailsResult = extractedResults.find(r => r.key === "contact_details");
      if (contactDetailsResult) {
        const val = contactDetailsResult.value as any;
        const text = contactText;

        // Extract emails from contact page text
        if ((!val.emails || val.emails.length === 0)) {
          const emailMatches = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g);
          if (emailMatches) {
            val.emails = [...new Set(emailMatches)];
            console.log(`[7.5/10] Enriched contact_details with emails from contact page: ${val.emails.join(", ")}`);
          }
        }

        // Extract phone numbers from contact page text
        if ((!val.phone_numbers || val.phone_numbers.length === 0)) {
          const phoneMatches = text.match(/\+?\(?\d[\d\s\-().]{7,}\d/g);
          if (phoneMatches) {
            val.phone_numbers = [...new Set(phoneMatches.map((p: string) => p.trim()))];
            console.log(`[7.5/10] Enriched contact_details with phones from contact page: ${val.phone_numbers.join(", ")}`);
          }
        }
      }
    }

    // Policy page text extraction — runs after policy URLs are discovered
    const policyPageResults: { key: string; label: string; url: string; data: PageData }[] = [];
    const POLICY_PAGES = [
      { key: "privacy_page", label: "Privacy policy", url: rescanPolicyUrls.privacy, pageType: "privacy" },
      { key: "refund_page", label: "Refund policy", url: rescanPolicyUrls.refund, pageType: "refund" },
      { key: "terms_page", label: "Terms of service", url: rescanPolicyUrls.terms, pageType: "terms" },
    ] as const;

    const policyTextTasks = POLICY_PAGES
      .filter((p) => p.url)
      .map((p) =>
        (async () => {
          try {
            const { artifact, artifactId } = await getOrCreateArtifact(p.url!, p.pageType, { skipCache: true });
            if (!artifact.ok) return;
            const ppData = buildPageData(p.url!, artifact, artifactId, 8 * 1024);
            if (isErrorPageContent(ppData.text_content)) return;
            policyPageResults.push({
              key: p.key, label: p.label, url: p.url!,
              data: ppData,
            });
          } catch { /* skip */ }
        })()
      );
    if (policyTextTasks.length > 0) await Promise.all(policyTextTasks);

    // Step 8: Save extracted data points BEFORE risk assessment
    // Risk assessment reads contact_details and ai_generated_likelihood from the database,
    // so we must persist them first
    console.log(`[8/10] Saving ${extractedResults.length} data points...`);
    if (extractedResults.length > 0) {
      // Batch all operations into a single transaction for performance
      const dbOperations = extractedResults.flatMap((extractedResult) => [
        // Save to ScanDataPoint (historical record for this specific scan)
        prisma.scanDataPoint.create({
          data: {
            scanId: newScan.id,
            key: extractedResult.key,
            label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
        }),
        // Upsert to DomainDataPoint (latest data for the domain)
        prisma.domainDataPoint.upsert({
          where: {
            domainId_key: {
              domainId: domain.id,
              key: extractedResult.key,
            },
          },
          create: {
            domainId: domain.id,
            key: extractedResult.key,
            label: extractedResult.label,
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

    // Helper: save page text data point with quality gate
    const domainId = domain!.id;
    async function savePageTextPoint(
      key: string, label: string, data: any, sources: string[]
    ) {
      const valueJson = JSON.stringify(data);
      const sourcesJson = JSON.stringify(sources);
      const emptyJson = JSON.stringify({});

      // Always save historical scan record
      await prisma.scanDataPoint.create({
        data: { scanId: newScan.id, key, label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: emptyJson },
      });

      await prisma.domainDataPoint.upsert({
        where: { domainId_key: { domainId, key } },
        create: { domainId, key, label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: emptyJson },
        update: { value: valueJson, sources: sourcesJson, rawOpenAIResponse: emptyJson, extractedAt: new Date() },
      });
      console.log(`[8/10] ✓ ${label} data point saved`);
    }

    // Save page text data points
    if (aboutPageResult) await savePageTextPoint("about_page", "About page", aboutPageResult, aboutPageUrl ? [aboutPageUrl] : []);
    if (homepageTextResult) await savePageTextPoint("homepage_text", "Homepage text", homepageTextResult, [scanUrl]);
    if (contactPageResult) await savePageTextPoint("contact_page", "Contact page", contactPageResult, contactPageUrl ? [contactPageUrl] : []);
    for (const pp of policyPageResults) {
      await savePageTextPoint(pp.key, pp.label, pp.data, [pp.url]);
    }

    console.log(`[8/10] ✓ Data points saved`);

    // Step 9: Risk assessment (runs AFTER data points are saved so it can read them)
    console.log(`[9/10] Running risk assessment...`);
    try {
      const riskResult = await runRiskIntelPipeline(newScan.id, scanUrl);
      if (riskResult.error) {
        console.warn(`[9/10] Risk assessment completed with errors`);
      } else {
        console.log(`[9/10] ✓ Risk score: ${riskResult.assessment.overall_risk_score}/100 (${riskResult.assessment.primary_risk_type})`);
      }
    } catch (riskError) {
      console.error(`[9/10] ✗ Risk assessment failed:`, riskError);
    }

    // Wait for screenshot capture to finish
    await screenshotPromise;

    // Step 10: Similarity check
    console.log(`[10/11] Running similarity check...`);
    await runIncrementalSimilarity(domain.id, domain.normalizedUrl).catch((err) => {
      console.error(`[10/11] ✗ Similarity check failed (non-fatal):`, err);
    });
    console.log(`[10/11] ✓ Similarity check complete`);

    // Step 11: Mark scan as complete
    console.log(`[11/11] Finalizing scan...`);
    await prisma.websiteScan.update({
      where: { id: newScan.id },
      data: { status: 'completed' },
    });
    console.log(`[11/11] ✓ Scan completed successfully!\n`);

    return NextResponse.json({ id: domain.id, scanId: newScan.id, normalizedUrl: domain.normalizedUrl });
  } catch (error) {
    console.error("[ERROR] Scan failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
