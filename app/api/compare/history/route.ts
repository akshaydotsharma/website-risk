import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10))
    );
    const query = searchParams.get("q") || "";
    const minScore = searchParams.get("minScore")
      ? parseInt(searchParams.get("minScore")!, 10)
      : undefined;
    const sort = searchParams.get("sort") || "createdAt";

    // Build where clause
    const where: any = {};

    // Search filter (matches urlA or urlB)
    if (query) {
      where.OR = [
        { urlA: { contains: query, mode: "insensitive" } },
        { urlB: { contains: query, mode: "insensitive" } },
      ];
    }

    // Min score filter
    if (minScore !== undefined && !isNaN(minScore)) {
      where.overallScore = { gte: minScore };
    }

    // Determine sort order
    let orderBy: any = {};
    switch (sort) {
      case "score":
        orderBy = { overallScore: "desc" };
        break;
      case "createdAt":
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    // Execute queries in parallel
    const [items, total] = await Promise.all([
      prisma.homepageComparison.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          urlA: true,
          urlB: true,
          overallScore: true,
          textScore: true,
          domScore: true,
          confidence: true,
        },
      }),
      prisma.homepageComparison.count({ where }),
    ]);

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Error fetching comparison history:", error);
    return NextResponse.json(
      { error: "Failed to fetch comparison history" },
      { status: 500 }
    );
  }
}
