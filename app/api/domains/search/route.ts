import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractDomainFromInput } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() || "";

    if (!query || query.length < 2) {
      return NextResponse.json({ domains: [] });
    }

    // Clean the query to match normalized domains
    const cleanedQuery = extractDomainFromInput(query);

    // Search for domains that match the query
    const domains = await prisma.domain.findMany({
      where: {
        normalizedUrl: {
          contains: cleanedQuery,
        },
      },
      include: {
        dataPoints: {
          select: {
            key: true,
            label: true,
          },
        },
        _count: {
          select: {
            scans: true,
          },
        },
      },
      orderBy: {
        lastCheckedAt: "desc",
      },
      take: 5,
    });

    return NextResponse.json({
      domains: domains.map((domain) => ({
        id: domain.id,
        normalizedUrl: domain.normalizedUrl,
        isActive: domain.isActive,
        statusCode: domain.statusCode,
        lastCheckedAt: domain.lastCheckedAt?.toISOString() || null,
        dataPointCount: domain.dataPoints.length,
        scanCount: domain._count.scans,
      })),
    });
  } catch (error) {
    console.error("Error searching domains:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
