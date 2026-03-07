import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  normalizeUrl,
  extractDomainFromInput,
  generateDomainHash,
} from "@/lib/utils";
import { processScanWrapper } from "@/lib/scan-processor";

// Allow up to 5 minutes for scan processing (requires Vercel Pro or self-hosted)
export const maxDuration = 300;

const createScanSchema = z.object({
  url: z.string().url("Invalid URL format"),
  source: z.enum(["search", "settings", "api"]).optional().default("search"),
  background: z.boolean().optional().default(true), // Run scan in background by default
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate input
    const validationResult = createScanSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { url: rawUrl, source, background } = validationResult.data;

    // Normalize URL and extract domain
    const url = normalizeUrl(rawUrl);
    const normalizedDomain = extractDomainFromInput(rawUrl);
    const domainId = generateDomainHash(normalizedDomain);

    // Defer checkWebsiteActive to background processing for fast response
    const checkedAt = new Date();

    // Use a transaction to ensure all records are created atomically
    const result = await prisma.$transaction(async (tx) => {
      // Upsert Domain record (create if doesn't exist, update if it does)
      const domain = await tx.domain.upsert({
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

      // Log the user input
      await tx.urlInput.create({
        data: {
          rawInput: rawUrl,
          domainId: domainId,
          source,
        },
      });

      // Create WebsiteScan record with pending status
      const scan = await tx.websiteScan.create({
        data: {
          domainId: domainId,
          url,
          isActive: false,
          statusCode: null,
          status: "pending",
          checkedAt,
        },
      });

      return { domain, scan };
    });

    const { scan } = result;

    // Background processing handler with error recovery
    const runProcessing = async () => {
      try {
        await processScanWrapper(scan.id, domainId, url, normalizedDomain);
      } catch (error) {
        console.error(`Background scan ${scan.id} failed with unhandled error:`, error);
        try {
          await prisma.websiteScan.update({
            where: { id: scan.id },
            data: {
              status: "failed",
              error: error instanceof Error ? error.message : "Unhandled background error",
            },
          });
        } catch (updateError) {
          console.error(`Failed to update scan ${scan.id} status after error:`, updateError);
        }
      }
    };

    if (!background) {
      // Synchronous processing explicitly requested
      await runProcessing();
      return NextResponse.json({ id: domainId, scanId: scan.id, status: "completed" }, { status: 201 });
    }

    // Background processing - return immediately in both dev and prod
    if (process.env.NODE_ENV !== 'development') {
      // Production: use Next.js after() to keep serverless function alive
      after(runProcessing);
    } else {
      // Dev: fire-and-forget (Node process is long-lived in dev)
      void runProcessing();
    }

    return NextResponse.json(
      { id: domainId, scanId: scan.id, status: "pending" },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error creating scan:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("Error details:", { message: errorMessage, stack: errorStack });
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}

const getPaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10),
  page: z.coerce.number().min(1).optional(),
  cursor: z.string().optional(),
  sortField: z.enum(["normalizedUrl", "isActive", "lastUpdatedAt", "createdAt", "riskScore"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const validationResult = getPaginationSchema.safeParse({
      limit: searchParams.get("limit") ?? 10,
      page: searchParams.get("page") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      sortField: searchParams.get("sortField") ?? undefined,
      sortDirection: searchParams.get("sortDirection") ?? undefined,
    });

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid pagination parameters" },
        { status: 400 }
      );
    }

    const { limit, page, cursor, sortField, sortDirection } = validationResult.data;

    // Build orderBy based on sort params
    const dir = sortDirection || "desc";
    let orderBy: any;
    switch (sortField) {
      case "normalizedUrl":
        orderBy = [{ normalizedUrl: dir }, { id: "asc" }];
        break;
      case "isActive":
        orderBy = [{ isActive: dir }, { lastCheckedAt: "desc" }, { id: "asc" }];
        break;
      case "createdAt":
        orderBy = [{ createdAt: dir }, { id: "asc" }];
        break;
      case "riskScore":
        // Nulls last: sort nulls to end regardless of direction
        orderBy = [{ riskScore: { sort: dir, nulls: "last" } }, { id: "asc" }];
        break;
      default: // lastUpdatedAt
        orderBy = [{ lastCheckedAt: dir }, { id: "asc" }];
        break;
    }

    const includeFields = {
      dataPoints: true,
      _count: {
        select: { screenshots: true },
      },
      scans: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: {
          id: true,
          status: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      urlInputs: {
        orderBy: { createdAt: "desc" as const },
        take: 5,
      },
    };

    // Page-based pagination (used by the scan history UI)
    if (page) {
      const [domains, totalCount] = await Promise.all([
        prisma.domain.findMany({
          skip: (page - 1) * limit,
          take: limit,
          include: includeFields,
          orderBy,
        }),
        prisma.domain.count(),
      ]);

      return NextResponse.json({
        domains: domains.map((d) => ({
          id: d.id,
          normalizedUrl: d.normalizedUrl,
          isActive: d.isActive,
          statusCode: d.statusCode,
          lastCheckedAt: d.lastCheckedAt?.toISOString() || null,
          createdAt: d.createdAt.toISOString(),
          dataPoints: d.dataPoints,
          screenshotCount: d._count.screenshots,
          scanCount: d.scans.length,
          scans: d.scans.map((scan) => ({
            id: scan.id,
            status: scan.status,
            error: scan.error,
            createdAt: scan.createdAt.toISOString(),
            updatedAt: scan.updatedAt.toISOString(),
          })),
          recentInputs: d.urlInputs.map((input) => ({
            rawInput: input.rawInput,
            source: input.source,
            createdAt: input.createdAt.toISOString(),
          })),
        })),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page,
      });
    }

    // Cursor-based pagination (legacy)
    const domains = await prisma.domain.findMany({
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      include: includeFields,
      orderBy: [{ lastCheckedAt: "desc" }, { id: "asc" }],
    });

    let nextCursor: string | undefined;
    if (domains.length > limit) {
      const nextItem = domains.pop();
      nextCursor = nextItem?.id;
    }

    return NextResponse.json({
      domains,
      nextCursor,
      hasMore: !!nextCursor,
    });
  } catch (error) {
    console.error("Error fetching domains:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
