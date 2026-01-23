import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runHomepageSkuExtraction } from "@/lib/domainIntel";
import type { DomainPolicy } from "@/lib/domainIntel/schemas";

// Query parameter schema - handle null from searchParams.get()
const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().nullish().transform(v => v || undefined),
  hasPrice: z.enum(["true", "false"]).nullish().transform(v => v || undefined),
  minConfidence: z.coerce.number().int().min(0).max(100).nullish().transform(v => v ?? undefined),
  sortBy: z.enum(["confidence", "amount", "title"]).default("confidence"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * GET /api/scans/{id}/homepage-skus
 *
 * Get paginated list of homepage SKUs for a domain/scan.
 * Supports filtering and sorting.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const queryResult = querySchema.safeParse({
      page: searchParams.get("page") || 1,
      pageSize: searchParams.get("pageSize") || 50,
      search: searchParams.get("search"),
      hasPrice: searchParams.get("hasPrice"),
      minConfidence: searchParams.get("minConfidence"),
      sortBy: searchParams.get("sortBy") || "confidence",
      sortDir: searchParams.get("sortDir") || "desc",
    });

    if (!queryResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: queryResult.error.issues },
        { status: 400 }
      );
    }

    const query = queryResult.data;

    // Find the scan - try as domain ID first, then as scan ID
    // IMPORTANT: Use the most recent COMPLETED scan to avoid showing empty data
    // when a new scan is stuck in pending/processing state
    let scanId: string | null = null;
    let scanInProgress = false;

    // First try as domain ID
    const domain = await prisma.domain.findUnique({
      where: { id },
      include: {
        scans: {
          orderBy: { createdAt: "desc" },
          take: 2, // Get latest 2 to check for in-progress and completed
        },
      },
    });

    if (domain) {
      // Check if there's a scan in progress
      const latestScan = domain.scans[0];
      if (latestScan && (latestScan.status === "pending" || latestScan.status === "processing")) {
        scanInProgress = true;
      }

      // Find the most recent completed scan
      const completedScan = domain.scans.find(s => s.status === "completed");
      if (completedScan) {
        scanId = completedScan.id;
      } else if (latestScan) {
        // No completed scan yet, use the latest scan (will return empty data)
        scanId = latestScan.id;
      }
    } else {
      // Try as scan ID directly
      const scan = await prisma.websiteScan.findUnique({
        where: { id },
      });

      if (scan) {
        if (scan.status === "pending" || scan.status === "processing") {
          scanInProgress = true;
        }

        // If querying by specific scan ID, use that scan
        // But if it's not completed, try to find a completed one for this domain
        if (scan.status === "completed") {
          scanId = scan.id;
        } else {
          const completedScan = await prisma.websiteScan.findFirst({
            where: { domainId: scan.domainId, status: "completed" },
            orderBy: { createdAt: "desc" },
          });
          scanId = completedScan?.id || scan.id;
        }
      }
    }

    if (!scanId) {
      return NextResponse.json(
        { error: "Domain or scan not found" },
        { status: 404 }
      );
    }

    // Build where clause for filtering
    const where: any = { scanId };

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { productUrl: { contains: query.search, mode: "insensitive" } },
      ];
    }

    if (query.hasPrice === "true") {
      where.priceText = { not: null };
    } else if (query.hasPrice === "false") {
      where.priceText = null;
    }

    if (query.minConfidence !== undefined) {
      where.confidence = { gte: query.minConfidence };
    }

    // Build order clause
    const orderBy: any = {};
    if (query.sortBy === "confidence") {
      orderBy.confidence = query.sortDir;
    } else if (query.sortBy === "amount") {
      orderBy.amount = query.sortDir;
    } else if (query.sortBy === "title") {
      orderBy.title = query.sortDir;
    }

    // Get total count
    const total = await prisma.homepageSku.count({ where });

    // Get paginated items
    const items = await prisma.homepageSku.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    // Calculate summary stats
    const allSkus = await prisma.homepageSku.findMany({
      where: { scanId },
      select: {
        priceText: true,
        currency: true,
        amount: true,
        originalAmount: true,
        isOnSale: true,
      },
    });

    const withPrice = allSkus.filter((s) => s.priceText).length;
    const pricePercentage = total > 0 ? Math.round((withPrice / total) * 100) : 0;

    // Calculate average selling price (current price for all items with price)
    const itemsWithAmount = allSkus.filter((s) => s.amount !== null);
    const avgSellingPrice = itemsWithAmount.length > 0
      ? itemsWithAmount.reduce((sum, s) => sum + (s.amount || 0), 0) / itemsWithAmount.length
      : null;

    // Calculate average discount (only for items on sale)
    const saleItems = allSkus.filter((s) => s.isOnSale && s.amount !== null && s.originalAmount !== null);
    const avgDiscount = saleItems.length > 0
      ? saleItems.reduce((sum, s) => {
          const discount = ((s.originalAmount! - s.amount!) / s.originalAmount!) * 100;
          return sum + discount;
        }, 0) / saleItems.length
      : null;

    // Find top currency (still useful for formatting)
    const currencyCounts = new Map<string, number>();
    for (const sku of allSkus) {
      if (sku.currency) {
        currencyCounts.set(sku.currency, (currencyCounts.get(sku.currency) || 0) + 1);
      }
    }
    let topCurrency: string | null = null;
    let topCount = 0;
    for (const [currency, count] of currencyCounts) {
      if (count > topCount) {
        topCount = count;
        topCurrency = currency;
      }
    }

    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
      summary: {
        totalDetected: total,
        withPrice,
        pricePercentage,
        avgSellingPrice,
        avgDiscount,
        saleItemCount: saleItems.length,
        topCurrency,
      },
    });
  } catch (error) {
    console.error("Error fetching homepage SKUs:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * POST /api/scans/{id}/homepage-skus
 *
 * Trigger homepage SKU extraction for a domain/scan.
 * This will run the extraction and persist results to the database.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Find the domain and scan
    let domain = await prisma.domain.findUnique({
      where: { id },
      include: {
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    // If not found as domain, try as scan ID
    if (!domain) {
      const existingScan = await prisma.websiteScan.findUnique({
        where: { id },
        include: { domain: true },
      });

      if (existingScan) {
        domain = await prisma.domain.findUnique({
          where: { id: existingScan.domainId },
          include: {
            scans: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });
      }
    }

    if (!domain) {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    const latestScan = domain.scans[0];
    if (!latestScan) {
      return NextResponse.json(
        { error: "No scans found for this domain" },
        { status: 404 }
      );
    }

    // Check authorization
    const authorizedDomain = await prisma.authorizedDomain.findFirst({
      where: {
        OR: [
          { domain: domain.normalizedUrl },
          // Check if subdomain of authorized domain
          ...domain.normalizedUrl.split('.').slice(1).map((_, i, arr) => ({
            domain: arr.slice(i).join('.'),
            allowSubdomains: true,
          })),
        ],
      },
    });

    if (!authorizedDomain) {
      return NextResponse.json(
        { error: "Domain not authorized for SKU extraction" },
        { status: 403 }
      );
    }

    // Build policy
    const policy: DomainPolicy = {
      isAuthorized: true,
      allowSubdomains: authorizedDomain.allowSubdomains,
      respectRobots: authorizedDomain.respectRobots,
      allowRobotsDisallowed: false,
      maxPagesPerRun: authorizedDomain.maxPagesPerScan,
      maxDepth: 2,
      crawlDelayMs: authorizedDomain.crawlDelayMs,
      requestTimeoutMs: 8000,
    };

    // Run extraction
    const homepageUrl = latestScan.url || `https://${domain.normalizedUrl}`;
    console.log(`Running homepage SKU extraction for ${homepageUrl}...`);

    const result = await runHomepageSkuExtraction(
      latestScan.id,
      homepageUrl,
      policy
    );

    console.log(`Extracted ${result.items.length} homepage SKUs for ${domain.normalizedUrl}`);

    return NextResponse.json({
      success: true,
      domainId: domain.id,
      scanId: latestScan.id,
      summary: result.summary,
      itemCount: result.items.length,
    });
  } catch (error) {
    console.error("Error extracting homepage SKUs:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}
