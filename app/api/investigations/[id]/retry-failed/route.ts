import { NextResponse } from "next/server";
import { runInBackground } from "@/lib/runInBackground";
import { prisma } from "@/lib/prisma";
import { processInvestigation } from "@/lib/investigation-processor";

export const maxDuration = 300;

/**
 * POST /api/investigations/{id}/retry-failed — Retry only failed domains + re-run similarity
 * Resets failed domains to pending, keeps completed ones, then re-processes.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: { domains: { select: { id: true, status: true } } },
    });

    if (!investigation) {
      return NextResponse.json({ error: "Investigation not found" }, { status: 404 });
    }

    if (investigation.status === "scanning" || investigation.status === "analyzing") {
      return NextResponse.json(
        { error: "Investigation is already running" },
        { status: 409 }
      );
    }

    const incompleteDomainIds = investigation.domains
      .filter((d) => d.status === "failed" || d.status === "pending" || d.status === "scanning")
      .map((d) => d.id);

    if (incompleteDomainIds.length === 0) {
      return NextResponse.json({ error: "No incomplete domains to retry" }, { status: 400 });
    }

    const failedDomainIds = incompleteDomainIds;

    const completedCount = investigation.domains.filter((d) => d.status === "completed").length;

    // Reset only failed domains to pending, keep completed ones
    await prisma.$transaction([
      prisma.investigation.update({
        where: { id },
        data: {
          status: "pending",
          scannedCount: completedCount,
          error: null,
          completedAt: null,
        },
      }),
      prisma.investigationDomain.updateMany({
        where: { id: { in: failedDomainIds } },
        data: {
          status: "pending",
          scanId: null,
          error: null,
        },
      }),
    ]);

    // Start processing in background — processInvestigation only processes pending domains
    const runProcessing = async () => {
      try {
        await processInvestigation(id);
      } catch (error) {
        console.error(`Investigation retry-failed ${id} failed:`, error);
      }
    };

    runInBackground(runProcessing);

    return NextResponse.json({ status: "pending", retrying: failedDomainIds.length });
  } catch (error) {
    console.error("Error retrying failed domains:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
