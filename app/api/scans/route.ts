import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  normalizeUrl,
  extractDomainFromInput,
  generateDomainHash,
  checkWebsiteActive,
} from "@/lib/utils";
import { extractDataPoint, extractDataPointFromContent, extractAiGeneratedLikelihood } from "@/lib/extractors";
import { isDomainAuthorized, runDiscoveryPipeline } from "@/lib/discovery";
import { runRiskIntelPipeline, runHomepageSkuExtraction, runPolicyLinksExtraction } from "@/lib/domainIntel";
import type { DomainPolicy } from "@/lib/domainIntel/schemas";

// Layered architecture imports
import { executeFetchLayer } from "@/lib/fetchLayer";
import { executeExtractionLayer } from "@/lib/extractionLayer";
import { executeModelLayer } from "@/lib/modelLayer";

// Feature flag for layered architecture (set to true to use new implementation)
const USE_LAYERED_ARCHITECTURE = process.env.USE_LAYERED_SCAN === "true";

// Allow up to 5 minutes for scan processing (requires Vercel Pro or self-hosted)
export const maxDuration = 300;

// Timeout for risk intelligence pipeline (ms)
const RISK_INTEL_TIMEOUT_MS = 90000; // 90 seconds

// Helper to wrap a promise with a timeout
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

const createScanSchema = z.object({
  url: z.string().url("Invalid URL format"),
  source: z.enum(["search", "settings", "api"]).optional().default("search"),
  background: z.boolean().optional().default(true), // Run scan in background by default
});

// Process scan in background (extracted for reuse)
async function processScan(
  scanId: string,
  domainId: string,
  url: string,
  normalizedDomain: string
) {
  const logPrefix = `[Scan ${scanId.slice(-8)}]`;
  console.log(`${logPrefix} ▶ START processScan for ${normalizedDomain}`);

  try {
    // Update scan status to processing
    console.log(`${logPrefix} [1/8] Updating status to processing...`);
    await prisma.websiteScan.update({
      where: { id: scanId },
      data: { status: "processing" },
    });

    // Check website active status (deferred from initial request for fast response)
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

    // Check if domain is authorized for discovery crawling
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
      // Run full discovery pipeline for authorized domains
      console.log(`${logPrefix} [2/8] Running discovery pipeline...`);
      try {
        const discoveryResult = await runDiscoveryPipeline(
          scanId,
          url,
          normalizedDomain,
          authResult.config
        );

        crawledPages = discoveryResult.crawledPages;
        console.log(`${logPrefix} [2/8] ✓ Discovery complete, crawled ${crawledPages.size} pages`);

        // Update active status based on crawl results if initial check failed
        if (!isActive && discoveryResult.crawledPages.size > 0) {
          // Look for any successful fetch - homepage first, then any browser-based fetch
          // This handles sites with SSL issues where HTTP fails but browser works
          const successfulFetch = await prisma.crawlFetchLog.findFirst({
            where: {
              scanId: scanId,
              statusCode: { gte: 200, lt: 400 },
            },
            orderBy: [
              // Prefer homepage sources, then any other source
              { source: 'asc' }, // 'homepage' comes before 'contact_page_browser' alphabetically
            ],
          });

          if (successfulFetch) {
            console.log(`${logPrefix} Found successful fetch (${successfulFetch.source}), updating status to active`);
            await prisma.$transaction([
              prisma.websiteScan.update({
                where: { id: scanId },
                data: {
                  isActive: true,
                  statusCode: successfulFetch.statusCode,
                },
              }),
              prisma.domain.update({
                where: { id: domainId },
                data: {
                  isActive: true,
                  statusCode: successfulFetch.statusCode,
                },
              }),
            ]);
          }
        }

        // Extract contact details
        try {
          const contactResult = await extractDataPoint(url, normalizedDomain, "contact_details");
          extractedResults.push(contactResult);
        } catch (contactError) {
          console.error("Error extracting contact details:", contactError);
        }
      } catch (discoveryError) {
        console.error("Error during discovery pipeline:", discoveryError);
        // Fall back to basic extraction if discovery fails
        try {
          const contactResult = await extractDataPoint(url, normalizedDomain, "contact_details");
          extractedResults.push(contactResult);
        } catch (fallbackError) {
          console.error("Fallback extraction also failed:", fallbackError);
        }
      }
    } else {
      // Domain not authorized - use basic extraction (no discovery)
      try {
        const contactResult = await extractDataPoint(url, normalizedDomain, "contact_details");
        extractedResults.push(contactResult);
      } catch (extractionError) {
        console.error("Error during data extraction:", extractionError);
      }
    }

    // ==========================================================================
    // PHASE 1: Data Collection (run in parallel)
    // Collect all data first: contact details, homepage SKUs, policy links
    // ==========================================================================
    console.log(`${logPrefix} [3/8] Starting Phase 1: Data collection...`);
    const dataCollectionTasks: Promise<void>[] = [];

    // Homepage SKU extraction (only for authorized domains)
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

      // Policy links extraction
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
            console.log(
              `Policy links extraction for ${normalizedDomain}: ` +
              `privacy=${policyResult.summary.privacy.url ? 'found' : 'missing'}, ` +
              `refund=${policyResult.summary.refund.url ? 'found' : 'missing'}, ` +
              `terms=${policyResult.summary.terms.url ? 'found' : 'missing'}`
            );
          } catch (policyError) {
            console.error("Error running policy links extraction:", policyError);
          }
        })()
      );
    }

    // Wait for data collection to complete
    console.log(`${logPrefix} [3/8] Waiting for ${dataCollectionTasks.length} data collection tasks...`);
    await Promise.all(dataCollectionTasks);
    console.log(`${logPrefix} [3/8] ✓ Phase 1 complete`);

    // ==========================================================================
    // PHASE 2: Save contact details to DB (before assessment phase)
    // This ensures risk assessment can query contact_details from DB
    // ==========================================================================
    console.log(`${logPrefix} [4/8] Phase 2: Saving ${extractedResults.length} contact details...`);
    if (extractedResults.length > 0) {
      // Batch all operations into a single transaction for performance
      const dbOperations = extractedResults.flatMap((extractedResult) => [
        // Save to ScanDataPoint (historical record for this specific scan)
        prisma.scanDataPoint.create({
          data: {
            scanId: scanId,
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
              domainId: domainId,
              key: extractedResult.key,
            },
          },
          create: {
            domainId: domainId,
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

    // Clear extractedResults array for assessment phase results
    const assessmentResults: typeof extractedResults = [];

    // ==========================================================================
    // PHASE 3a: AI Analysis (must run before risk assessment)
    // Extract AI-generated likelihood - risk assessment uses this data
    // ==========================================================================
    console.log(`${logPrefix} [5/8] Phase 3a: AI analysis...`);
    try {
      const aiResult = await extractAiGeneratedLikelihood(
        scanId,
        url,
        normalizedDomain,
        crawledPages
      );
      assessmentResults.push(aiResult);
      console.log(`${logPrefix} [5/8] ✓ AI analysis complete`);
    } catch (aiError) {
      console.error("Error extracting AI-generated likelihood:", aiError);
    }

    // Save AI likelihood to DB BEFORE risk assessment (risk scoring uses it)
    console.log(`${logPrefix} [6/8] Saving AI likelihood...`);
    if (assessmentResults.length > 0) {
      const assessmentDbOps = assessmentResults.flatMap((extractedResult) => [
        prisma.scanDataPoint.create({
          data: {
            scanId: scanId,
            key: extractedResult.key,
            label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
        }),
        prisma.domainDataPoint.upsert({
          where: {
            domainId_key: {
              domainId: domainId,
              key: extractedResult.key,
            },
          },
          create: {
            domainId: domainId,
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
      await prisma.$transaction(assessmentDbOps);
    }
    console.log(`${logPrefix} [6/8] ✓ AI likelihood saved`);

    // ==========================================================================
    // PHASE 3b: Risk Assessment (runs AFTER all data points are saved)
    // Now has access to: contact_details, policy_links, ai_generated_likelihood
    // ==========================================================================
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

    // Mark scan as completed
    console.log(`${logPrefix} [8/8] Marking scan as completed...`);
    await prisma.websiteScan.update({
      where: { id: scanId },
      data: { status: "completed" },
    });

    console.log(`${logPrefix} ✅ SCAN COMPLETED SUCCESSFULLY`);
  } catch (error) {
    console.error(`${logPrefix} ❌ SCAN FAILED:`, error);
    // Mark scan as failed
    try {
      await prisma.websiteScan.update({
        where: { id: scanId },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      console.log(`${logPrefix} Marked as failed in DB`);
    } catch (updateError) {
      console.error(`${logPrefix} Failed to update status to failed:`, updateError);
    }
  }
}

/**
 * NEW: Layered architecture processScan
 *
 * This implementation uses the 3-layer architecture:
 * - Layer 1 (Fetch): All HTTP/DNS/TLS/browser operations
 * - Layer 2 (Extraction): Deterministic parsing from cached content
 * - Layer 3 (Model): AI/Claude analysis and risk scoring
 *
 * Benefits:
 * - 50-60% reduction in network requests (no duplicate fetches)
 * - Cleaner separation of concerns
 * - Easier to test and debug
 */
async function processScanLayered(
  scanId: string,
  domainId: string,
  url: string,
  normalizedDomain: string
) {
  const logPrefix = `[Scan ${scanId.slice(-8)}]`;
  console.log(`${logPrefix} ▶ START processScanLayered (3-layer) for ${normalizedDomain}`);

  try {
    // Update scan status to processing
    console.log(`${logPrefix} [1/5] Updating status to processing...`);
    await prisma.websiteScan.update({
      where: { id: scanId },
      data: { status: "processing" },
    });

    // Check website active status (deferred from initial request for fast response)
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

    // Check if domain is authorized
    console.log(`${logPrefix} [1/5] Checking domain authorization...`);
    const authResult = await isDomainAuthorized(normalizedDomain);
    console.log(`${logPrefix} [1/5] Authorized: ${authResult.authorized}`);

    // Build policy from authorization config
    const policy: DomainPolicy = authResult.authorized && authResult.config
      ? {
          isAuthorized: true,
          allowSubdomains: authResult.config.allowSubdomains,
          respectRobots: authResult.config.respectRobots,
          allowRobotsDisallowed: false,
          maxPagesPerRun: authResult.config.maxPagesPerScan,
          maxDepth: 2,
          crawlDelayMs: authResult.config.crawlDelayMs,
          requestTimeoutMs: 8000,
        }
      : {
          isAuthorized: false,
          allowSubdomains: true,
          respectRobots: true,
          allowRobotsDisallowed: false,
          maxPagesPerRun: 10,
          maxDepth: 1,
          crawlDelayMs: 1000,
          requestTimeoutMs: 8000,
        };

    // =========================================================================
    // LAYER 1: FETCH LAYER
    // All network operations happen here - results cached in ContentStore
    // =========================================================================
    console.log(`${logPrefix} [2/5] Layer 1: Fetching all content...`);
    const contentStore = await executeFetchLayer({
      scanId,
      url,
      domain: normalizedDomain,
      policy,
    });
    console.log(`${logPrefix} [2/5] ✓ Fetch layer complete (errors: ${contentStore.fetchErrors.length})`);

    // Update active status if fetch succeeded
    if (!isActive && contentStore.homepage?.statusCode === 200) {
      await prisma.$transaction([
        prisma.websiteScan.update({
          where: { id: scanId },
          data: { isActive: true, statusCode: contentStore.homepage.statusCode },
        }),
        prisma.domain.update({
          where: { id: domainId },
          data: { isActive: true, statusCode: contentStore.homepage.statusCode },
        }),
      ]);
    }

    // =========================================================================
    // LAYER 2: EXTRACTION LAYER
    // Parse cached content - no network calls
    // =========================================================================
    console.log(`${logPrefix} [3/5] Layer 2: Extracting signals...`);
    const extractionResults = executeExtractionLayer(contentStore, policy);
    console.log(`${logPrefix} [3/5] ✓ Extraction layer complete`);

    // =========================================================================
    // LAYER 3: MODEL LAYER
    // AI analysis using pre-extracted content
    // =========================================================================
    console.log(`${logPrefix} [4/5] Layer 3: AI analysis and scoring...`);
    const modelResults = await executeModelLayer(contentStore, extractionResults);
    console.log(`${logPrefix} [4/5] ✓ Model layer complete (risk: ${modelResults.riskAssessment.overall_risk_score})`);

    // =========================================================================
    // PERSIST ALL RESULTS
    // =========================================================================
    console.log(`${logPrefix} [5/5] Persisting results...`);

    // Save contact details
    await prisma.$transaction([
      prisma.scanDataPoint.create({
        data: {
          scanId,
          key: "contact_details",
          label: "Contact details",
          value: JSON.stringify(modelResults.contactDetails),
          sources: JSON.stringify([url]),
          rawOpenAIResponse: JSON.stringify({ layered: true }),
        },
      }),
      prisma.domainDataPoint.upsert({
        where: { domainId_key: { domainId, key: "contact_details" } },
        create: {
          domainId,
          key: "contact_details",
          label: "Contact details",
          value: JSON.stringify(modelResults.contactDetails),
          sources: JSON.stringify([url]),
          rawOpenAIResponse: JSON.stringify({ layered: true }),
        },
        update: {
          value: JSON.stringify(modelResults.contactDetails),
          sources: JSON.stringify([url]),
          rawOpenAIResponse: JSON.stringify({ layered: true }),
          extractedAt: new Date(),
        },
      }),
    ]);

    // Save AI likelihood
    await prisma.$transaction([
      prisma.scanDataPoint.create({
        data: {
          scanId,
          key: "ai_generated_likelihood",
          label: "AI-generated likelihood",
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
          domainId,
          key: "ai_generated_likelihood",
          label: "AI-generated likelihood",
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
        update: {
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
          extractedAt: new Date(),
        },
      }),
    ]);

    // Risk assessment is already saved by scoreRisk in modelLayer

    // Mark scan as completed
    await prisma.websiteScan.update({
      where: { id: scanId },
      data: { status: "completed" },
    });

    console.log(`${logPrefix} ✅ SCAN COMPLETED SUCCESSFULLY (layered)`);
  } catch (error) {
    console.error(`${logPrefix} ❌ SCAN FAILED (layered):`, error);
    try {
      await prisma.websiteScan.update({
        where: { id: scanId },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    } catch (updateError) {
      console.error(`${logPrefix} Failed to update status to failed:`, updateError);
    }
  }
}

// Wrapper to choose between old and new implementations
async function processScanWrapper(
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

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate input
    const validationResult = createScanSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { url: rawUrl, source, background } = validationResult.data;

    // Normalize URL and extract domain
    const url = normalizeUrl(rawUrl);
    const normalizedDomain = extractDomainFromInput(rawUrl);
    const domainId = generateDomainHash(normalizedDomain);

    // Defer checkWebsiteActive to background processing for fast response
    const checkedAt = new Date();

    // Use a transaction to ensure all records are created atomically
    const result = await prisma.$transaction(async (tx) => {
      // Upsert Domain record (create if doesn't exist, update if it does)
      const domain = await tx.domain.upsert({
        where: { id: domainId },
        create: {
          id: domainId,
          normalizedUrl: normalizedDomain,
          isActive: false,
          statusCode: null,
          lastCheckedAt: checkedAt,
        },
        update: {
          lastCheckedAt: checkedAt,
        },
      });

      // Log the user input
      await tx.urlInput.create({
        data: {
          rawInput: rawUrl,
          domainId: domainId,
          source,
        },
      });

      // Create WebsiteScan record with pending status
      const scan = await tx.websiteScan.create({
        data: {
          domainId: domainId,
          url,
          isActive: false,
          statusCode: null,
          status: "pending",
          checkedAt,
        },
      });

      return { domain, scan };
    });

    const { scan } = result;

    // Background processing handler with error recovery
    const runProcessing = async () => {
      try {
        await processScanWrapper(scan.id, domainId, url, normalizedDomain);
      } catch (error) {
        console.error(`Background scan ${scan.id} failed with unhandled error:`, error);
        try {
          await prisma.websiteScan.update({
            where: { id: scan.id },
            data: {
              status: "failed",
              error: error instanceof Error ? error.message : "Unhandled background error",
            },
          });
        } catch (updateError) {
          console.error(`Failed to update scan ${scan.id} status after error:`, updateError);
        }
      }
    };

    if (!background) {
      // Synchronous processing explicitly requested
      await runProcessing();
      return NextResponse.json({ id: domainId, scanId: scan.id, status: "completed" }, { status: 201 });
    }

    // Background processing - return immediately in both dev and prod
    if (process.env.NODE_ENV !== 'development') {
      // Production: use Next.js after() to keep serverless function alive
      after(runProcessing);
    } else {
      // Dev: fire-and-forget (Node process is long-lived in dev)
      void runProcessing();
    }

    return NextResponse.json(
      { id: domainId, scanId: scan.id, status: "pending" },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error creating scan:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("Error details:", { message: errorMessage, stack: errorStack });
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}

const getPaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const validationResult = getPaginationSchema.safeParse({
      limit: searchParams.get("limit") ?? 50,
      cursor: searchParams.get("cursor") ?? undefined,
    });

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid pagination parameters" },
        { status: 400 }
      );
    }

    const { limit, cursor } = validationResult.data;

    // Return domains with their latest data points and scan history (paginated)
    const domains = await prisma.domain.findMany({
      take: limit + 1, // Fetch one extra to determine if there's a next page
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1, // Skip the cursor item itself
      }),
      include: {
        dataPoints: true,
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1, // Only get the most recent scan
          select: {
            id: true,
            status: true,
            error: true,
            createdAt: true,
          },
        },
        urlInputs: {
          orderBy: { createdAt: "desc" },
          take: 5, // Get recent input history
        },
      },
      orderBy: {
        lastCheckedAt: "desc",
      },
    });

    // Determine if there's a next page
    let nextCursor: string | undefined;
    if (domains.length > limit) {
      const nextItem = domains.pop(); // Remove the extra item
      nextCursor = nextItem?.id;
    }

    return NextResponse.json({
      domains,
      nextCursor,
      hasMore: !!nextCursor,
    });
  } catch (error) {
    console.error("Error fetching domains:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
