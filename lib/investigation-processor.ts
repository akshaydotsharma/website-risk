import { prisma } from "@/lib/prisma";
import {
  normalizeUrl,
} from "@/lib/utils";
import { processScanWrapper } from "@/lib/scan-processor";
import { runIncrementalSimilarity } from "@/lib/similarityCheck";

const MAX_CONCURRENT_SCANS = 3;
const SCAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per domain scan

/**
 * Process an investigation: scan all domains, then run cross-similarity.
 */
export async function processInvestigation(investigationId: string) {
  const logPrefix = `[Investigation ${investigationId.slice(-8)}]`;
  console.log(`${logPrefix} ▶ START`);

  try {
    // Mark as scanning
    await prisma.investigation.update({
      where: { id: investigationId },
      data: { status: "scanning" },
    });

    const investigation = await prisma.investigation.findUnique({
      where: { id: investigationId },
      include: { domains: { include: { domain: true } } },
    });

    if (!investigation) throw new Error("Investigation not found");

    // ── Phase 0: Reconcile — mark failed/pending domains as completed if they now have a scan ──
    const needsScan = investigation.domains.filter((d) => d.status === "pending" || d.status === "failed");
    for (const invDomain of needsScan) {
      const latestScan = await prisma.websiteScan.findFirst({
        where: { domainId: invDomain.domainId, status: "completed" },
        orderBy: { createdAt: "desc" },
      });
      if (latestScan) {
        console.log(`${logPrefix} Reconciling ${invDomain.domain.normalizedUrl} — already has completed scan`);
        await prisma.investigationDomain.update({
          where: { id: invDomain.id },
          data: { status: "completed", scanId: latestScan.id, error: null },
        });
        await prisma.investigation.update({
          where: { id: investigationId },
          data: { scannedCount: { increment: 1 } },
        });
      }
    }

    // Re-fetch after reconciliation
    const refreshed = await prisma.investigation.findUnique({
      where: { id: investigationId },
      include: { domains: { include: { domain: true } } },
    });
    if (!refreshed) throw new Error("Investigation not found after reconciliation");

    // ── Phase 1: Scan remaining pending domains ──
    const pending = refreshed.domains.filter((d) => d.status === "pending");
    console.log(`${logPrefix} Scanning ${pending.length} domains (max ${MAX_CONCURRENT_SCANS} concurrent)`);

    // Concurrency pool: always keep MAX_CONCURRENT_SCANS running until all are done
    await runWithConcurrencyPool(
      pending,
      MAX_CONCURRENT_SCANS,
      (invDomain) => scanSingleDomain(investigationId, invDomain)
    );

    // Check results
    const updated = await prisma.investigationDomain.findMany({
      where: { investigationId },
    });
    const completedCount = updated.filter((d) => d.status === "completed").length;
    const failedCount = updated.filter((d) => d.status === "failed").length;

    console.log(`${logPrefix} Scan phase done: ${completedCount} completed, ${failedCount} failed`);

    // ── Phase 2: Run cross-similarity analysis ──
    if (completedCount >= 2) {
      console.log(`${logPrefix} Running similarity analysis...`);
      await prisma.investigation.update({
        where: { id: investigationId },
        data: { status: "analyzing", scannedCount: completedCount },
      });

      const completedDomains = updated.filter((d) => d.status === "completed");

      // Fetch domain URLs for similarity check
      const domainRecords = await prisma.domain.findMany({
        where: { id: { in: completedDomains.map((d) => d.domainId) } },
        select: { id: true, normalizedUrl: true },
      });

      // Run cross-similarity between investigation domains with lower threshold
      const investigationDomainIds = domainRecords.map((d) => d.id);
      for (const domain of domainRecords) {
        try {
          await runIncrementalSimilarity(domain.id, domain.normalizedUrl, {
            minScore: 1,
            onlyAgainstIds: investigationDomainIds,
          });
        } catch (err) {
          console.error(`${logPrefix} Similarity error for ${domain.normalizedUrl}:`, err);
          // Non-fatal — continue with other domains
        }
      }
      console.log(`${logPrefix} Similarity analysis complete`);
    }

    // ── Mark complete ──
    await prisma.investigation.update({
      where: { id: investigationId },
      data: {
        status: "completed",
        scannedCount: completedCount,
        completedAt: new Date(),
        ...(failedCount > 0 && completedCount === 0
          ? { status: "failed", error: `All ${failedCount} domains failed to scan` }
          : {}),
      },
    });

    console.log(`${logPrefix} ✓ DONE`);
  } catch (error) {
    console.error(`${logPrefix} FATAL:`, error);
    await prisma.investigation.update({
      where: { id: investigationId },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      },
    }).catch(() => {});
  }
}

/**
 * Scan a single domain within an investigation.
 * Creates Domain + WebsiteScan if needed, runs the full pipeline.
 */
async function scanSingleDomain(
  investigationId: string,
  invDomain: { id: string; domainId: string; domain: { normalizedUrl: string } }
) {
  const normalizedDomain = invDomain.domain.normalizedUrl;
  const logPrefix = `[Investigation ${investigationId.slice(-8)}][${normalizedDomain}]`;

  try {
    // Mark as scanning
    await prisma.investigationDomain.update({
      where: { id: invDomain.id },
      data: { status: "scanning" },
    });

    // Always run a fresh scan for investigations
    // Create a new scan + log input
    const url = normalizeUrl(`https://${normalizedDomain}`);
    const checkedAt = new Date();

    const scan = await prisma.$transaction(async (tx) => {
      const s = await tx.websiteScan.create({
        data: {
          domainId: invDomain.domainId,
          url,
          isActive: false,
          statusCode: null,
          status: "pending",
          checkedAt,
        },
      });
      await tx.urlInput.create({
        data: {
          rawInput: url,
          domainId: invDomain.domainId,
          source: "investigation",
        },
      });
      return s;
    });

    console.log(`${logPrefix} Running scan ${scan.id.slice(-8)}...`);
    await Promise.race([
      processScanWrapper(scan.id, invDomain.domainId, url, normalizedDomain, { skipSimilarity: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Scan timed out after ${SCAN_TIMEOUT_MS / 1000}s`)), SCAN_TIMEOUT_MS)
      ),
    ]);

    // Mark as completed (clear any previous error from failed attempts)
    await prisma.investigationDomain.update({
      where: { id: invDomain.id },
      data: { status: "completed", scanId: scan.id, error: null },
    });
    await prisma.investigation.update({
      where: { id: investigationId },
      data: { scannedCount: { increment: 1 } },
    });

    console.log(`${logPrefix} ✓ Scan complete`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`${logPrefix} ✗ Failed:`, errorMsg);

    // Mark investigation domain as failed
    await prisma.investigationDomain.update({
      where: { id: invDomain.id },
      data: { status: "failed", error: errorMsg },
    }).catch(() => {});

    // Also mark any stuck scan as failed (e.g., after timeout)
    const stuckScans = await prisma.websiteScan.findMany({
      where: { domainId: invDomain.domainId, status: { in: ["pending", "processing"] } },
    }).catch(() => []);
    for (const s of stuckScans) {
      await prisma.websiteScan.update({
        where: { id: s.id },
        data: { status: "failed" },
      }).catch(() => {});
    }
  }
}

/**
 * Run tasks with a fixed concurrency pool.
 * As soon as one task finishes, the next one starts — keeps `limit` tasks running at all times.
 */
async function runWithConcurrencyPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const running = new Set<Promise<void>>();

  const startNext = () => {
    const item = queue.shift();
    if (!item) return;
    const task = fn(item).catch(() => {}).finally(() => {
      running.delete(task);
    });
    running.add(task);
  };

  // Seed the pool
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    startNext();
  }

  // As each task finishes, start the next
  while (running.size > 0) {
    await Promise.race(running);
    // Fill any open slots
    while (running.size < limit && queue.length > 0) {
      startNext();
    }
  }
}
