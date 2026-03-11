import { NextResponse } from "next/server";
import { runInBackground } from "@/lib/runInBackground";
import { prisma } from "@/lib/prisma";
import { processInvestigation } from "@/lib/investigation-processor";

export const maxDuration = 300;

/**
 * POST /api/investigations/{id}/rerun — Re-run an investigation
 * Resets all domains to pending and re-processes.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const investigation = await prisma.investigation.findUnique({
      where: { id },
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

    // Reset investigation and all domains to pending
    await prisma.$transaction([
      prisma.investigation.update({
        where: { id },
        data: {
          status: "pending",
          scannedCount: 0,
          error: null,
          completedAt: null,
        },
      }),
      prisma.investigationDomain.updateMany({
        where: { investigationId: id },
        data: {
          status: "pending",
          scanId: null,
          error: null,
        },
      }),
    ]);

    // Start processing in background
    const runProcessing = async () => {
      try {
        await processInvestigation(id);
      } catch (error) {
        console.error(`Investigation rerun ${id} failed:`, error);
      }
    };

    runInBackground(runProcessing);

    return NextResponse.json({ status: "pending" });
  } catch (error) {
    console.error("Error re-running investigation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
