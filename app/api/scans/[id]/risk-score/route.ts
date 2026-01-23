import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runRiskIntelPipeline } from "@/lib/domainIntel";

/**
 * POST /api/scans/{id}/risk-score
 *
 * Run the domain risk intelligence pipeline for an existing scan.
 * This endpoint will:
 * 1. Verify the domain is authorized in AuthorizedDomain
 * 2. Collect domain intelligence signals (HTTP, DNS, TLS, etc.)
 * 3. Compute risk scores (phishing, fraud, compliance, credit)
 * 4. Persist results to ScanDataPoint, DomainDataPoint, SignalLog, and CrawlFetchLog
 *
 * Request body (optional):
 * - force: boolean - Re-run even if assessment already exists
 *
 * Returns:
 * - assessment: The risk assessment result
 * - signals: Summary of collected signals
 * - error: Any error message (null if successful)
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
          where: { key: "domain_risk_assessment" },
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
            where: { key: "domain_risk_assessment" },
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

    // Check if we should force re-run
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    // Check if risk assessment already exists for this domain
    const existingAssessment = domain.dataPoints.find(
      (dp) => dp.key === "domain_risk_assessment"
    );

    if (existingAssessment && !force) {
      const assessmentValue = JSON.parse(existingAssessment.value);
      return NextResponse.json({
        message: "Risk assessment already exists for this domain",
        skipped: true,
        domainId: domain.id,
        scanId: latestScan.id,
        assessment: assessmentValue,
      });
    }

    // Use the scan URL or construct from normalized domain
    const scanUrl = latestScan.url || `https://${domain.normalizedUrl}`;

    // Run the risk intelligence pipeline
    console.log(`Running risk intelligence pipeline for ${domain.normalizedUrl}...`);

    const result = await runRiskIntelPipeline(latestScan.id, scanUrl);

    console.log(
      `Risk intelligence completed for ${domain.normalizedUrl}: ` +
      `overall_score=${result.assessment.overall_risk_score}, ` +
      `primary_risk=${result.assessment.primary_risk_type}, ` +
      `confidence=${result.assessment.confidence}`
    );

    return NextResponse.json({
      success: true,
      domainId: domain.id,
      scanId: latestScan.id,
      assessment: result.assessment,
      signalsSummary: result.signals ? {
        collected_at: result.signals.signals.collected_at,
        urls_checked_count: result.signals.urls_checked.length,
        errors_count: result.signals.errors.length,
      } : null,
      error: result.error,
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

/**
 * GET /api/scans/{id}/risk-score
 *
 * Get the existing risk assessment for a domain/scan without re-running.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // The ID could be either a domain ID (hash) or a scan ID
    let domain = await prisma.domain.findUnique({
      where: { id },
      include: {
        dataPoints: {
          where: {
            key: { in: ["domain_risk_assessment", "domain_intel_signals"] }
          },
        },
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            dataPoints: {
              where: {
                key: { in: ["domain_risk_assessment", "domain_intel_signals"] }
              },
            },
          },
        },
      },
    });

    // If not found as domain, try to find the scan
    if (!domain) {
      const scan = await prisma.websiteScan.findUnique({
        where: { id },
        include: {
          domain: {
            include: {
              dataPoints: {
                where: {
                  key: { in: ["domain_risk_assessment", "domain_intel_signals"] }
                },
              },
            },
          },
          dataPoints: {
            where: {
              key: { in: ["domain_risk_assessment", "domain_intel_signals"] }
            },
          },
        },
      });

      if (!scan) {
        return NextResponse.json(
          { error: "Domain or scan not found" },
          { status: 404 }
        );
      }

      // Build response from scan
      const assessmentDataPoint = scan.dataPoints.find(
        dp => dp.key === "domain_risk_assessment"
      );
      const signalsDataPoint = scan.dataPoints.find(
        dp => dp.key === "domain_intel_signals"
      );

      if (!assessmentDataPoint) {
        return NextResponse.json(
          { error: "No risk assessment found for this scan" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        domainId: scan.domainId,
        scanId: scan.id,
        assessment: JSON.parse(assessmentDataPoint.value),
        signals: signalsDataPoint ? JSON.parse(signalsDataPoint.value) : null,
        extractedAt: assessmentDataPoint.extractedAt,
      });
    }

    // Get from domain data points
    const assessmentDataPoint = domain.dataPoints.find(
      dp => dp.key === "domain_risk_assessment"
    );
    const signalsDataPoint = domain.dataPoints.find(
      dp => dp.key === "domain_intel_signals"
    );

    if (!assessmentDataPoint) {
      return NextResponse.json(
        { error: "No risk assessment found for this domain" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      domainId: domain.id,
      scanId: domain.scans[0]?.id || null,
      assessment: JSON.parse(assessmentDataPoint.value),
      signals: signalsDataPoint ? JSON.parse(signalsDataPoint.value) : null,
      extractedAt: assessmentDataPoint.extractedAt,
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
