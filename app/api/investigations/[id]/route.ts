import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeJsonParse } from "@/lib/utils";

/**
 * DELETE /api/investigations/{id} — Delete an investigation and its domain links
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.investigation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting investigation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/investigations/{id} — Update investigation name
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      data.name = body.name.trim();
    }
    if (typeof body.status === "string" && ["completed", "failed", "pending", "scanning", "analyzing"].includes(body.status)) {
      data.status = body.status;
      if (body.status === "completed") data.completedAt = new Date();
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await prisma.investigation.update({
      where: { id },
      data,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error updating investigation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/investigations/{id} — Get investigation status and results
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: {
        domains: {
          include: {
            domain: {
              select: {
                id: true,
                normalizedUrl: true,
                riskScore: true,
                isActive: true,
                statusCode: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!investigation) {
      return NextResponse.json({ error: "Investigation not found" }, { status: 404 });
    }

    // Build domain summaries
    const domains = investigation.domains.map((d) => ({
      domainId: d.domainId,
      url: d.domain.normalizedUrl,
      riskScore: d.domain.riskScore,
      isActive: d.domain.isActive,
      statusCode: d.domain.statusCode,
      status: d.status,
      scanId: d.scanId,
      error: d.error,
    }));

    // Get similarity pairs between investigation domains
    const domainIds = domains.filter((d) => d.status === "completed").map((d) => d.domainId);
    let similarityPairs: any[] = [];

    if (domainIds.length >= 2) {
      const pairs = await prisma.domainSimilarityPair.findMany({
        where: {
          domainAId: { in: domainIds },
          domainBId: { in: domainIds },
          compositeScore: { gte: 15 },
        },
        orderBy: { compositeScore: "desc" },
      });

      similarityPairs = pairs.map((p) => ({
        domainAId: p.domainAId,
        domainBId: p.domainBId,
        domainAUrl: p.domainAUrl,
        domainBUrl: p.domainBUrl,
        compositeScore: p.compositeScore,
        sharedSentenceCount: p.sharedSentenceCount,
        pageScores: safeJsonParse(p.pageScores, []),
      }));
    }

    // Summary stats
    const completedDomains = domains.filter((d) => d.status === "completed");
    const highRiskCount = completedDomains.filter((d) => (d.riskScore ?? 0) >= 60).length;
    const avgRiskScore = completedDomains.length > 0
      ? Math.round(completedDomains.reduce((s, d) => s + (d.riskScore ?? 0), 0) / completedDomains.length)
      : 0;
    const similarPairCount = similarityPairs.filter((p) => p.compositeScore >= 50).length;

    return NextResponse.json({
      id: investigation.id,
      name: investigation.name,
      status: investigation.status,
      domainCount: investigation.domainCount,
      scannedCount: investigation.scannedCount,
      createdAt: investigation.createdAt.toISOString(),
      completedAt: investigation.completedAt?.toISOString() ?? null,
      error: investigation.error,
      summary: {
        totalDomains: domains.length,
        completed: completedDomains.length,
        failed: domains.filter((d) => d.status === "failed").length,
        scanning: domains.filter((d) => d.status === "scanning").length,
        pending: domains.filter((d) => d.status === "pending").length,
        highRiskCount,
        avgRiskScore,
        similarPairCount,
      },
      domains,
      similarityPairs,
    });
  } catch (error) {
    console.error("Error fetching investigation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
