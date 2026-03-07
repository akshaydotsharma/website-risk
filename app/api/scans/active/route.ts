import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { processScanWrapper } from "@/lib/scan-processor";

const STALE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
const MAX_AUTO_PROCESS = 3; // Max pending scans to auto-process per poll

/**
 * Lightweight endpoint that returns only domains with in-progress scans.
 * Used by the global notification poller (every 3s).
 *
 * Background work (piggyback):
 * 1. Recovers stalled scans (processing > 20 min) → reset to pending
 * 2. Auto-processes pending scans that aren't being handled
 */
export async function GET() {
  try {
    // Piggyback: recover stalled + process pending in background
    const backgroundWork = async () => {
      // 1. Recover stalled scans
      try {
        const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
        const result = await prisma.websiteScan.updateMany({
          where: { status: "processing", updatedAt: { lt: staleCutoff } },
          data: { status: "pending", error: "Auto-recovered: scan was stalled" },
        });
        if (result.count > 0) {
          console.log(`[ActivePoll] Recovered ${result.count} stalled scans`);
        }
      } catch { /* ignore */ }

      // 2. Auto-process orphaned pending scans (not currently being processed)
      // Atomically claim each scan (pending → processing) to prevent duplicate dispatch
      try {
        const processingCount = await prisma.websiteScan.count({
          where: { status: "processing" },
        });
        if (processingCount < MAX_AUTO_PROCESS) {
          const slotsAvailable = MAX_AUTO_PROCESS - processingCount;
          const pendingScans = await prisma.websiteScan.findMany({
            where: { status: "pending" },
            include: { domain: { select: { normalizedUrl: true } } },
            orderBy: { createdAt: "asc" },
            take: slotsAvailable,
          });
          for (const scan of pendingScans) {
            // Atomically claim: set to processing so no other poll picks it up
            const claimed = await prisma.websiteScan.updateMany({
              where: { id: scan.id, status: "pending" },
              data: { status: "processing" },
            });
            if (claimed.count > 0) {
              console.log(`[ActivePoll] Processing ${scan.domain.normalizedUrl}`);
              void processScanWrapper(scan.id, scan.domainId, scan.url, scan.domain.normalizedUrl);
            }
          }
        }
      } catch { /* ignore */ }
    };

    if (process.env.NODE_ENV !== "development") {
      after(backgroundWork);
    } else {
      void backgroundWork();
    }

    const domains = await prisma.domain.findMany({
      where: {
        scans: {
          some: {
            status: { in: ["pending", "processing"] },
          },
        },
      },
      select: {
        id: true,
        normalizedUrl: true,
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            error: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json({
      domains: domains.map((d) => ({
        id: d.id,
        normalizedUrl: d.normalizedUrl,
        scanStatus: d.scans[0]?.status ?? null,
        scanError: d.scans[0]?.error ?? null,
      })),
    });
  } catch (error) {
    console.error("Error fetching active scans:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
