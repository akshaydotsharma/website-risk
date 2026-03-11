import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeJsonParse } from "@/lib/utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const run = await prisma.aboutUsAnalysisRun.findUnique({
      where: { id },
      include: {
        pairs: {
          orderBy: { textScore: "desc" },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: run.id,
      status: run.status,
      domainIds: safeJsonParse(run.domainIds, []),
      domainCount: run.domainCount,
      pairCount: run.pairCount,
      clusterCount: run.clusterCount,
      flaggedCount: run.flaggedCount,
      summary: safeJsonParse(run.summary, null),
      error: run.error,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() || null,
      pairs: run.pairs.map((p) => ({
        id: p.id,
        domainAId: p.domainAId,
        domainBId: p.domainBId,
        domainAUrl: p.domainAUrl,
        domainBUrl: p.domainBUrl,
        textScore: p.textScore,
        sharedSentences: safeJsonParse(p.sharedSentences, []),
        sharedSentenceCount: p.sharedSentenceCount,
        keywordHitsA: safeJsonParse(p.keywordHitsA, []),
        keywordHitsB: safeJsonParse(p.keywordHitsB, []),
        clusterId: p.clusterId,
        flagged: p.flagged,
        flagReasons: safeJsonParse(p.flagReasons, []),
        pageScores: safeJsonParse(p.pageScores, []),
      })),
    });
  } catch (error) {
    console.error("About analysis fetch failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name } = body;

    if (typeof name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }

    const run = await prisma.aboutUsAnalysisRun.update({
      where: { id },
      data: { name: name.trim() || null },
    });

    return NextResponse.json({ id: run.id, name: run.name });
  } catch (error) {
    console.error("About analysis rename failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const run = await prisma.aboutUsAnalysisRun.findUnique({
      where: { id },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    await prisma.aboutUsAnalysisRun.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("About analysis delete failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
