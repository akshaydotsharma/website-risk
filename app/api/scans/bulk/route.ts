import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  normalizeUrl,
  extractDomainFromInput,
  generateDomainHash,
} from "@/lib/utils";

// Reuse the scan processing from the main route
// We import dynamically to avoid circular deps
const MAX_CONCURRENCY = 5;
const MAX_URLS = 50;

export const maxDuration = 300;

const bulkScanSchema = z.object({
  urls: z.array(z.string()).min(1).max(MAX_URLS).optional(),
  domainIds: z.array(z.string()).min(1).max(MAX_URLS).optional(),
  source: z.enum(["search", "settings", "api"]).optional().default("search"),
}).refine((data) => data.urls || data.domainIds, {
  message: "Either urls or domainIds must be provided",
});

interface ScanRecord {
  domainId: string;
  scanId: string;
  url: string;
  normalizedDomain: string;
}

/**
 * Run promises with a concurrency limit
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validationResult = bulkScanSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { urls, domainIds, source } = validationResult.data;
    const checkedAt = new Date();

    // Resolve domainIds to URLs if provided
    let resolvedUrls: string[] = [];
    if (domainIds && domainIds.length > 0) {
      const domains = await prisma.domain.findMany({
        where: { id: { in: domainIds } },
        select: { normalizedUrl: true },
      });
      resolvedUrls = domains.map((d) => `https://${d.normalizedUrl}`);
    }

    const inputUrls = urls || resolvedUrls;

    // Deduplicate by normalized domain
    const seen = new Set<string>();
    const uniqueUrls: string[] = [];
    for (const rawUrl of inputUrls) {
      try {
        const domain = extractDomainFromInput(rawUrl);
        if (!seen.has(domain)) {
          seen.add(domain);
          uniqueUrls.push(rawUrl);
        }
      } catch {
        // Skip invalid URLs
      }
    }

    if (uniqueUrls.length === 0) {
      return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
    }

    // Phase 1: Create all domain + scan records immediately
    const scanRecords: ScanRecord[] = [];

    for (const rawUrl of uniqueUrls) {
      try {
        const normalizedDomain = extractDomainFromInput(rawUrl);
        const url = normalizeUrl(`https://${normalizedDomain}`);
        const domainId = generateDomainHash(normalizedDomain);

        const result = await prisma.$transaction(async (tx) => {
          await tx.domain.upsert({
            where: { id: domainId },
            create: {
              id: domainId,
              normalizedUrl: normalizedDomain,
              isActive: false,
              statusCode: null,
              lastCheckedAt: checkedAt,
            },
            update: {
              lastCheckedAt: checkedAt,
            },
          });

          await tx.urlInput.create({
            data: {
              rawInput: rawUrl,
              domainId,
              source,
            },
          });

          const scan = await tx.websiteScan.create({
            data: {
              domainId,
              url,
              isActive: false,
              statusCode: null,
              status: "pending",
              checkedAt,
            },
          });

          return { domainId, scanId: scan.id, url, normalizedDomain };
        });

        scanRecords.push(result);
      } catch (error) {
        console.error(`Failed to create scan record for ${rawUrl}:`, error);
      }
    }

    if (scanRecords.length === 0) {
      return NextResponse.json({ error: "Failed to create any scan records" }, { status: 500 });
    }

    // Phase 2: Process scans in background with concurrency limit
    const runBulkProcessing = async () => {
      // Dynamic import to get processScanWrapper
      const { processScanForBulk } = await import("@/lib/bulk-scan-processor");

      const tasks = scanRecords.map((record) => () =>
        processScanForBulk(record.scanId, record.domainId, record.url, record.normalizedDomain)
      );

      const results = await runWithConcurrency(tasks, MAX_CONCURRENCY);

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      console.log(`[BulkScan] Completed: ${succeeded} succeeded, ${failed} failed out of ${scanRecords.length}`);
    };

    if (process.env.NODE_ENV !== "development") {
      after(runBulkProcessing);
    } else {
      void runBulkProcessing();
    }

    return NextResponse.json(
      {
        domainIds: scanRecords.map((r) => r.domainId),
        scanCount: scanRecords.length,
        status: "pending",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Bulk scan error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
