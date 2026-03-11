import { NextResponse } from "next/server";
import { runRiskIntelPipeline } from "@/lib/domainIntel";
import { resolveDomainAndScan } from "@/lib/domainUtils";
import { DataPointKey } from "@/lib/constants";
import { safeJsonParse } from "@/lib/utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await resolveDomainAndScan(id, {
      includeDataPoints: true,
      dataPointKeys: [DataPointKey.RISK_ASSESSMENT],
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

    const existingAssessment = (domain as any).dataPoints?.find(
      (dp: any) => dp.key === DataPointKey.RISK_ASSESSMENT
    );

    if (existingAssessment && !force) {
      return NextResponse.json({
        message: "Risk assessment already exists for this domain",
        skipped: true,
        domainId: domain.id,
        scanId: latestScan.id,
        assessment: safeJsonParse(existingAssessment.value, {}),
      });
    }

    console.log(`Running risk intelligence pipeline for ${domain.normalizedUrl}...`);
    const pipelineResult = await runRiskIntelPipeline(latestScan.id, scanUrl);

    console.log(
      `Risk intelligence completed for ${domain.normalizedUrl}: ` +
      `overall_score=${pipelineResult.assessment.overall_risk_score}, ` +
      `primary_risk=${pipelineResult.assessment.primary_risk_type}, ` +
      `confidence=${pipelineResult.assessment.confidence}`
    );

    return NextResponse.json({
      success: true,
      domainId: domain.id,
      scanId: latestScan.id,
      assessment: pipelineResult.assessment,
      signalsSummary: pipelineResult.signals ? {
        collected_at: pipelineResult.signals.signals.collected_at,
        urls_checked_count: pipelineResult.signals.urls_checked.length,
        errors_count: pipelineResult.signals.errors.length,
      } : null,
      error: pipelineResult.error,
    });
  } catch (error) {
    console.error("Error running risk intelligence pipeline:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const riskKeys = [DataPointKey.RISK_ASSESSMENT, DataPointKey.DOMAIN_INTEL_SIGNALS];

    const result = await resolveDomainAndScan(id, {
      includeDataPoints: true,
      dataPointKeys: riskKeys,
    });

    if (!result) {
      return NextResponse.json({ error: "Domain or scan not found" }, { status: 404 });
    }

    const { domain, latestScan } = result;
    const dataPoints = (domain as any).dataPoints ?? [];

    const assessmentDp = dataPoints.find((dp: any) => dp.key === DataPointKey.RISK_ASSESSMENT);
    const signalsDp = dataPoints.find((dp: any) => dp.key === DataPointKey.DOMAIN_INTEL_SIGNALS);

    if (!assessmentDp) {
      return NextResponse.json({ error: "No risk assessment found" }, { status: 404 });
    }

    return NextResponse.json({
      domainId: domain.id,
      scanId: latestScan?.id || null,
      assessment: safeJsonParse(assessmentDp.value, {}),
      signals: signalsDp ? safeJsonParse(signalsDp.value, null) : null,
      extractedAt: assessmentDp.extractedAt,
    });
  } catch (error) {
    console.error("Error fetching risk assessment:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}
