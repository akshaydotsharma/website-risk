import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractAiGeneratedLikelihood } from "@/lib/extractors";

/**
 * POST /api/scans/{id}/extract-ai
 *
 * Extract AI-generated likelihood for an existing domain/scan without re-running the full scan.
 * This is useful for backfilling the AI score on domains that were scanned before this feature was added.
 *
 * The endpoint will:
 * 1. Find the domain (by domain ID or scan ID)
 * 2. Get the most recent scan
 * 3. Run the AI-generated likelihood extraction
 * 4. Save the results to both ScanDataPoint and DomainDataPoint
 */
export async function POST(
  request: Request,
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
        dataPoints: {
          where: { key: "ai_generated_likelihood" },
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
        return NextResponse.json(
          { error: "Domain or scan not found" },
          { status: 404 }
        );
      }

      domain = await prisma.domain.findUnique({
        where: { id: existingScan.domainId },
        include: {
          scans: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          dataPoints: {
            where: { key: "ai_generated_likelihood" },
          },
        },
      });
    }

    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const latestScan = domain.scans[0];
    if (!latestScan) {
      return NextResponse.json(
        { error: "No scans found for this domain" },
        { status: 404 }
      );
    }

    // Check if we should force re-extraction
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    // Check if AI likelihood already exists for this domain
    const existingAiDataPoint = domain.dataPoints.find(
      (dp) => dp.key === "ai_generated_likelihood"
    );

    if (existingAiDataPoint && !force) {
      return NextResponse.json({
        message: "AI-generated likelihood already exists for this domain",
        skipped: true,
        domainId: domain.id,
        scanId: latestScan.id,
        existingScore: JSON.parse(existingAiDataPoint.value).ai_generated_score,
      });
    }

    // Use the scan URL or construct from normalized domain
    const scanUrl = latestScan.url || `https://${domain.normalizedUrl}`;

    // Extract AI-generated likelihood
    console.log(`Extracting AI-generated likelihood for ${domain.normalizedUrl}...`);

    const aiResult = await extractAiGeneratedLikelihood(
      latestScan.id,
      scanUrl,
      domain.normalizedUrl
    );

    // Delete existing scan data point if it exists
    await prisma.scanDataPoint.deleteMany({
      where: {
        scanId: latestScan.id,
        key: aiResult.key,
      },
    });

    // Save the results
    await prisma.$transaction([
      // Create new ScanDataPoint
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
      // Upsert to DomainDataPoint (latest data for the domain)
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

    console.log(`AI-generated likelihood extracted for ${domain.normalizedUrl}: score=${aiResult.value.ai_generated_score}`);

    return NextResponse.json({
      success: true,
      domainId: domain.id,
      scanId: latestScan.id,
      result: aiResult.value,
    });
  } catch (error) {
    console.error("Error extracting AI-generated likelihood:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}
