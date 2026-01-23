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
import { isDomainAuthorized, runDiscoveryPipeline, addAuthorizedDomain } from "@/lib/discovery";
import { runRiskIntelPipeline, runHomepageSkuExtraction, runPolicyLinksExtraction } from "@/lib/domainIntel";
import type { DomainPolicy } from "@/lib/domainIntel/schemas";

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
  addToAuthorizedList: z.boolean().optional().default(false), // Add domain to authorized list with default thresholds
});

// Process scan in background (extracted for reuse)
async function processScan(
  scanId: string,
  domainId: string,
  url: string,
  normalizedDomain: string,
  isActive: boolean
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
          const homepageLogs = await prisma.crawlFetchLog.findFirst({
            where: {
              scanId: scanId,
              source: "homepage",
              statusCode: { gte: 200, lt: 400 },
            },
          });

          if (homepageLogs) {
            await prisma.$transaction([
              prisma.websiteScan.update({
                where: { id: scanId },
                data: {
                  isActive: true,
                  statusCode: homepageLogs.statusCode,
                },
              }),
              prisma.domain.update({
                where: { id: domainId },
                data: {
                  isActive: true,
                  statusCode: homepageLogs.statusCode,
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
    for (const extractedResult of extractedResults) {
      await prisma.$transaction([
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
    }

    // Clear extractedResults array for assessment phase results
    const assessmentResults: typeof extractedResults = [];

    // ==========================================================================
    // PHASE 3: Assessment (run in parallel, after data is saved)
    // AI generation and Risk Assessment now have access to all collected data
    // ==========================================================================
    console.log(`${logPrefix} [5/8] Phase 3: Starting assessments...`);
    const assessmentTasks: Promise<void>[] = [];

    // AI-generated likelihood (always runs, uses homepage only)
    assessmentTasks.push(
      (async () => {
        try {
          const aiResult = await extractAiGeneratedLikelihood(
            scanId,
            url,
            normalizedDomain,
            crawledPages
          );
          assessmentResults.push(aiResult);
        } catch (aiError) {
          console.error("Error extracting AI-generated likelihood:", aiError);
        }
      })()
    );

    // Risk intelligence pipeline (runs for all domains)
    // Now runs AFTER contact_details and policy_links are saved to DB
    // Wrapped with timeout to ensure scan completes even if risk intel is slow
    assessmentTasks.push(
      (async () => {
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
              `Risk assessment for ${normalizedDomain}: ` +
              `score=${riskResult.assessment.overall_risk_score}, ` +
              `type=${riskResult.assessment.primary_risk_type}, ` +
              `confidence=${riskResult.assessment.confidence}`
            );
          }
        } catch (riskError) {
          console.error("Error running risk intelligence pipeline:", riskError);
        }
      })()
    );

    // Wait for all assessment tasks to complete
    console.log(`${logPrefix} [5/8] Waiting for ${assessmentTasks.length} assessment tasks...`);
    await Promise.all(assessmentTasks);
    console.log(`${logPrefix} [5/8] ✓ Phase 3 complete`);

    // Save assessment results (AI likelihood)
    console.log(`${logPrefix} [6/8] Saving ${assessmentResults.length} assessment results...`);
    for (const extractedResult of assessmentResults) {
      await prisma.$transaction([
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
    }

    // Small delay to ensure all database writes from parallel tasks are fully committed
    // This prevents race conditions where the frontend reloads before data is visible
    console.log(`${logPrefix} [7/8] Waiting 500ms for DB writes to commit...`);
    await new Promise((resolve) => setTimeout(resolve, 500));

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

    const { url: rawUrl, source, background, addToAuthorizedList } = validationResult.data;

    // Normalize URL and extract domain
    const url = normalizeUrl(rawUrl);
    const normalizedDomain = extractDomainFromInput(rawUrl);
    const domainId = generateDomainHash(normalizedDomain);

    // Add to authorized list if requested (before starting scan)
    if (addToAuthorizedList) {
      try {
        await addAuthorizedDomain({
          domain: normalizedDomain,
          // Use default thresholds
        });
        console.log(`Added ${normalizedDomain} to authorized list`);
      } catch (error: any) {
        // Ignore if domain already exists (P2002 = unique constraint violation)
        if (error?.code !== "P2002") {
          console.error("Error adding domain to authorized list:", error);
        }
      }
    }

    // Check if website is active
    const { isActive, statusCode } = await checkWebsiteActive(url);
    const checkedAt = new Date();

    // Use a transaction to ensure all records are created atomically
    const result = await prisma.$transaction(async (tx) => {
      // Upsert Domain record (create if doesn't exist, update if it does)
      const domain = await tx.domain.upsert({
        where: { id: domainId },
        create: {
          id: domainId,
          normalizedUrl: normalizedDomain,
          isActive,
          statusCode,
          lastCheckedAt: checkedAt,
        },
        update: {
          isActive,
          statusCode,
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
          isActive,
          statusCode,
          status: "pending",
          checkedAt,
        },
      });

      return { domain, scan };
    });

    const { domain, scan } = result;

    // In development, after() doesn't work reliably, so force synchronous processing
    const useBackground = background && process.env.NODE_ENV !== 'development';

    if (background && !useBackground) {
      console.log(`[API] Development mode: using synchronous processing for scan ${scan.id}`);
    }

    if (useBackground) {
      // Use Next.js `after()` to run processing after the response is sent
      // This keeps the serverless function alive until the work is complete
      console.log(`[API] Registering after() callback for scan ${scan.id}`);
      after(async () => {
        console.log(`[API] after() callback STARTED for scan ${scan.id}`);
        try {
          await processScan(scan.id, domainId, url, normalizedDomain, isActive);
        } catch (error) {
          console.error(`Background scan ${scan.id} failed with unhandled error:`, error);
          // Attempt to mark scan as failed
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
      });

      // Return immediately with scan info
      return NextResponse.json(
        { id: domainId, scanId: scan.id, status: "pending" },
        { status: 202 } // 202 Accepted - request accepted for processing
      );
    }

    // Synchronous processing (background=false)
    await processScan(scan.id, domainId, url, normalizedDomain, isActive);

    // Return the domain ID for redirect (domains are the primary entity now)
    return NextResponse.json({ id: domainId, scanId: scan.id, status: "completed" }, { status: 201 });
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

export async function GET() {
  try {
    // Return domains with their latest data points and scan history
    const domains = await prisma.domain.findMany({
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

    return NextResponse.json({ domains });
  } catch (error) {
    console.error("Error fetching domains:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
