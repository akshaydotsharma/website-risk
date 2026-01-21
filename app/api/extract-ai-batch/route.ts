import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractAiGeneratedLikelihood } from "@/lib/extractors";

/**
 * POST /api/extract-ai-batch
 *
 * Batch extract AI-generated likelihood for all domains that don't have it yet.
 * This is useful for backfilling the AI score on all existing domains.
 *
 * Query params:
 * - limit: Maximum number of domains to process (default: 10)
 * - force: Set to "true" to re-extract even if already exists
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50);
    const force = searchParams.get("force") === "true";

    // Find domains that don't have AI-generated likelihood data point
    let domains;

    if (force) {
      // Get all domains up to limit
      domains = await prisma.domain.findMany({
        take: limit,
        orderBy: { lastCheckedAt: "desc" },
        include: {
          scans: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
    } else {
      // Get domains without AI likelihood data point
      domains = await prisma.domain.findMany({
        where: {
          NOT: {
            dataPoints: {
              some: {
                key: "ai_generated_likelihood",
              },
            },
          },
        },
        take: limit,
        orderBy: { lastCheckedAt: "desc" },
        include: {
          scans: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
    }

    if (domains.length === 0) {
      return NextResponse.json({
        message: "No domains found that need AI-generated likelihood extraction",
        processed: 0,
        results: [],
      });
    }

    const results: Array<{
      domain: string;
      domainId: string;
      success: boolean;
      score?: number;
      confidence?: number;
      error?: string;
    }> = [];

    for (const domain of domains) {
      const latestScan = domain.scans[0];

      if (!latestScan) {
        results.push({
          domain: domain.normalizedUrl,
          domainId: domain.id,
          success: false,
          error: "No scans found",
        });
        continue;
      }

      try {
        const scanUrl = latestScan.url || `https://${domain.normalizedUrl}`;

        console.log(`[Batch] Extracting AI likelihood for ${domain.normalizedUrl}...`);

        const aiResult = await extractAiGeneratedLikelihood(
          latestScan.id,
          scanUrl,
          domain.normalizedUrl
        );

        // Save the results
        await prisma.$transaction([
          // Upsert to ScanDataPoint
          prisma.scanDataPoint.deleteMany({
            where: {
              scanId: latestScan.id,
              key: aiResult.key,
            },
          }),
        ]);

        await prisma.$transaction([
          prisma.scanDataPoint.create({
            data: {
              scanId: latestScan.id,
              key: aiResult.key,
              label: aiResult.label,
              value: JSON.stringify(aiResult.value),
              sources: JSON.stringify(aiResult.sources),
              rawOpenAIResponse: JSON.stringify(aiResult.rawOpenAIResponse),
            },
          }),
          prisma.domainDataPoint.upsert({
            where: {
              domainId_key: {
                domainId: domain.id,
                key: aiResult.key,
              },
            },
            create: {
              domainId: domain.id,
              key: aiResult.key,
              label: aiResult.label,
              value: JSON.stringify(aiResult.value),
              sources: JSON.stringify(aiResult.sources),
              rawOpenAIResponse: JSON.stringify(aiResult.rawOpenAIResponse),
            },
            update: {
              label: aiResult.label,
              value: JSON.stringify(aiResult.value),
              sources: JSON.stringify(aiResult.sources),
              rawOpenAIResponse: JSON.stringify(aiResult.rawOpenAIResponse),
              extractedAt: new Date(),
            },
          }),
        ]);

        results.push({
          domain: domain.normalizedUrl,
          domainId: domain.id,
          success: true,
          score: aiResult.value.ai_generated_score,
          confidence: aiResult.value.confidence,
        });

        console.log(`[Batch] Completed ${domain.normalizedUrl}: score=${aiResult.value.ai_generated_score}`);
      } catch (error) {
        console.error(`[Batch] Error processing ${domain.normalizedUrl}:`, error);
        results.push({
          domain: domain.normalizedUrl,
          domainId: domain.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      message: `Processed ${domains.length} domains`,
      processed: domains.length,
      successful,
      failed,
      results,
    });
  } catch (error) {
    console.error("Error in batch AI extraction:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * GET /api/extract-ai-batch
 *
 * Get status of domains that need AI-generated likelihood extraction
 */
export async function GET() {
  try {
    const totalDomains = await prisma.domain.count();

    const domainsWithAi = await prisma.domain.count({
      where: {
        dataPoints: {
          some: {
            key: "ai_generated_likelihood",
          },
        },
      },
    });

    const domainsWithoutAi = totalDomains - domainsWithAi;

    return NextResponse.json({
      totalDomains,
      domainsWithAiScore: domainsWithAi,
      domainsNeedingExtraction: domainsWithoutAi,
      percentComplete: totalDomains > 0 ? Math.round((domainsWithAi / totalDomains) * 100) : 100,
    });
  } catch (error) {
    console.error("Error getting batch status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
