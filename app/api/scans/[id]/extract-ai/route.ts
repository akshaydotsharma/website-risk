import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractAiGeneratedLikelihood } from "@/lib/extractors";
import { resolveDomainAndScan } from "@/lib/domainUtils";
import { saveDataPoint } from "@/lib/dataPointUtils";
import { safeJsonParse } from "@/lib/utils";
import { DataPointKey } from "@/lib/constants";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await resolveDomainAndScan(id, {
      includeDataPoints: true,
      dataPointKeys: [DataPointKey.AI_LIKELIHOOD],
    });

    if (!result) {
      return NextResponse.json({ error: "Domain or scan not found" }, { status: 404 });
    }

    const { domain, latestScan, scanUrl } = result;
    if (!latestScan) {
      return NextResponse.json({ error: "No scans found for this domain" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    const existingAiDataPoint = (domain as any).dataPoints?.find(
      (dp: any) => dp.key === DataPointKey.AI_LIKELIHOOD
    );

    if (existingAiDataPoint && !force) {
      return NextResponse.json({
        message: "AI-generated likelihood already exists for this domain",
        skipped: true,
        domainId: domain.id,
        scanId: latestScan.id,
        existingScore: safeJsonParse<any>(existingAiDataPoint.value, {}).ai_generated_score,
      });
    }

    console.log(`Extracting AI-generated likelihood for ${domain.normalizedUrl}...`);

    const aiResult = await extractAiGeneratedLikelihood(
      latestScan.id,
      scanUrl,
      domain.normalizedUrl
    );

    // Delete existing scan data point if re-extracting
    await prisma.scanDataPoint.deleteMany({
      where: { scanId: latestScan.id, key: aiResult.key },
    });

    await saveDataPoint(
      latestScan.id,
      domain.id,
      aiResult.key,
      aiResult.label,
      aiResult.value,
      aiResult.sources,
      aiResult.rawOpenAIResponse
    );

    console.log(`AI-generated likelihood extracted for ${domain.normalizedUrl}: score=${aiResult.value.ai_generated_score}`);

    return NextResponse.json({
      success: true,
      domainId: domain.id,
      scanId: latestScan.id,
      result: aiResult.value,
    });
  } catch (error) {
    console.error("Error extracting AI-generated likelihood:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
