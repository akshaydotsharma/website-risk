import { NextResponse } from "next/server";
import { runInBackground } from "@/lib/runInBackground";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runAboutUsAnalysis } from "@/lib/aboutUsAnalysis";

export const maxDuration = 300;

const createRunSchema = z.object({
  domainIds: z.array(z.string()).min(2, "Need at least 2 domains").max(50),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { domainIds } = createRunSchema.parse(body);

    // Verify domains exist
    const domains = await prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true },
    });

    if (domains.length < 2) {
      return NextResponse.json(
        { error: "At least 2 valid domains required" },
        { status: 400 }
      );
    }

    const validIds = domains.map((d) => d.id);

    // Generate a default name from domain URLs
    const domainDetails = await prisma.domain.findMany({
      where: { id: { in: validIds } },
      select: { normalizedUrl: true },
    });
    const urls = domainDetails.map((d) => d.normalizedUrl.replace(/\.com$|\.net$|\.org$|\.io$/, ""));
    const defaultName =
      urls.length <= 3
        ? urls.join(", ")
        : `${urls.slice(0, 2).join(", ")} +${urls.length - 2} more`;

    // Create the run record
    const run = await prisma.aboutUsAnalysisRun.create({
      data: {
        name: body.name?.trim() || defaultName,
        domainIds: JSON.stringify(validIds),
        domainCount: validIds.length,
      },
    });

    // Run analysis in background
    const runProcessing = () => runAboutUsAnalysis(run.id, validIds);

    runInBackground(runProcessing);

    return NextResponse.json({ id: run.id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      );
    }
    console.error("About analysis creation failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      prisma.aboutUsAnalysisRun.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.aboutUsAnalysisRun.count(),
    ]);

    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        domainCount: r.domainCount,
        pairCount: r.pairCount,
        clusterCount: r.clusterCount,
        flaggedCount: r.flaggedCount,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() || null,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("About analysis list failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
