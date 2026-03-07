import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { processScanWrapper } from "@/lib/scan-processor";

export const maxDuration = 300;

const MAX_CONCURRENCY = 5;
const STALE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
const MAX_RETRIES = 3;

/**
 * POST /api/scans/queue
 *
 * Queue processor that:
 * 1. Recovers stalled scans (processing > 10 min) by resetting to pending
 * 2. Picks up pending scans and processes them with concurrency limit
 * 3. Retries failed scans up to MAX_RETRIES times
 *
 * Can be called manually, from a cron job, or from the notification poller.
 */
export async function POST() {
  try {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_THRESHOLD_MS);

    // Step 1: Recover stalled scans (stuck in "processing" for too long)
    const stalledResult = await prisma.websiteScan.updateMany({
      where: {
        status: "processing",
        updatedAt: { lt: staleCutoff },
      },
      data: {
        status: "pending",
        error: "Auto-recovered: scan was stalled",
      },
    });

    if (stalledResult.count > 0) {
      console.log(`[Queue] Recovered ${stalledResult.count} stalled scans`);
    }

    // Step 2: Find pending scans (includes recovered stalled ones and retries)
    const pendingScans = await prisma.websiteScan.findMany({
      where: {
        status: "pending",
      },
      include: {
        domain: { select: { normalizedUrl: true } },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_CONCURRENCY * 2, // Grab a batch
    });

    if (pendingScans.length === 0) {
      return NextResponse.json({
        recovered: stalledResult.count,
        processing: 0,
        message: "No pending scans",
      });
    }

    // Step 3: Check retry counts — skip scans that have exceeded MAX_RETRIES
    // We count retries by looking at how many completed/failed scans exist for the same domain+url
    const scansToProcess = [];
    const scansToSkip = [];

    for (const scan of pendingScans) {
      // Count previous attempts for this exact URL
      const attemptCount = await prisma.websiteScan.count({
        where: {
          domainId: scan.domainId,
          url: scan.url,
          status: "failed",
          id: { not: scan.id },
        },
      });

      if (attemptCount >= MAX_RETRIES) {
        scansToSkip.push(scan);
      } else {
        scansToProcess.push(scan);
      }
    }

    // Mark over-retry scans as permanently failed
    if (scansToSkip.length > 0) {
      await prisma.websiteScan.updateMany({
        where: { id: { in: scansToSkip.map((s) => s.id) } },
        data: {
          status: "failed",
          error: `Exceeded max retries (${MAX_RETRIES})`,
        },
      });
      console.log(`[Queue] Skipped ${scansToSkip.length} scans (exceeded ${MAX_RETRIES} retries)`);
    }

    const batch = scansToProcess.slice(0, MAX_CONCURRENCY);

    if (batch.length === 0) {
      return NextResponse.json({
        recovered: stalledResult.count,
        processing: 0,
        skipped: scansToSkip.length,
        message: "No eligible scans to process",
      });
    }

    // Step 4: Process batch with concurrency limit
    const runBatch = async () => {
      const results = await Promise.allSettled(
        batch.map((scan) =>
          processScanWrapper(
            scan.id,
            scan.domainId,
            scan.url,
            scan.domain.normalizedUrl
          )
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      console.log(
        `[Queue] Batch complete: ${succeeded} succeeded, ${failed} failed out of ${batch.length}`
      );
    };

    // Run in background
    if (process.env.NODE_ENV !== "development") {
      after(runBatch);
    } else {
      void runBatch();
    }

    return NextResponse.json({
      recovered: stalledResult.count,
      processing: batch.length,
      skipped: scansToSkip.length,
      remaining: pendingScans.length - batch.length - scansToSkip.length,
    });
  } catch (error) {
    console.error("[Queue] Error:", error);
    return NextResponse.json(
      { error: "Queue processing failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/scans/queue
 *
 * Returns queue status: pending, processing, stalled counts.
 */
export async function GET() {
  try {
    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const [pending, processing, stalled, recentFailed] = await Promise.all([
      prisma.websiteScan.count({ where: { status: "pending" } }),
      prisma.websiteScan.count({
        where: { status: "processing", updatedAt: { gte: staleCutoff } },
      }),
      prisma.websiteScan.count({
        where: { status: "processing", updatedAt: { lt: staleCutoff } },
      }),
      prisma.websiteScan.count({
        where: {
          status: "failed",
          updatedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // last hour
        },
      }),
    ]);

    return NextResponse.json({
      pending,
      processing,
      stalled,
      recentFailed,
    });
  } catch (error) {
    console.error("[Queue] Status error:", error);
    return NextResponse.json(
      { error: "Failed to get queue status" },
      { status: 500 }
    );
  }
}
