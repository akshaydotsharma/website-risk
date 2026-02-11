import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkWebsiteActive } from "@/lib/utils";
import { extractDataPoint, extractDataPointFromContent, extractAiGeneratedLikelihood } from "@/lib/extractors";
import { isDomainAuthorized, runDiscoveryPipeline } from "@/lib/discovery";
import { runRiskIntelPipeline, runHomepageSkuExtraction, runPolicyLinksExtraction } from "@/lib/domainIntel";
import type { DomainPolicy } from "@/lib/domainIntel/schemas";

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
            console.log(`[6/10] Policies: privacy=${policyResult.summary.privacy.url ? '✓' : '✗'}, refund=${policyResult.summary.refund.url ? '✓' : '✗'}, terms=${policyResult.summary.terms.url ? '✓' : '✗'}`);
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

    // Step 10: Mark scan as complete
    console.log(`[10/10] Finalizing scan...`);
    await prisma.websiteScan.update({
      where: { id: newScan.id },
      data: { status: 'completed' },
    });
    console.log(`[10/10] ✓ Scan completed successfully!\n`);

    return NextResponse.json({ id: domain.id, scanId: newScan.id });
  } catch (error) {
    console.error("[ERROR] Scan failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
