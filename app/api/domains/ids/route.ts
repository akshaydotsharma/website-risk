import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Lightweight endpoint that returns all domain IDs.
 * Used by the "select all" checkbox for cross-page selection.
 */
export async function GET() {
  try {
    const domains = await prisma.domain.findMany({
      select: { id: true },
      orderBy: { lastCheckedAt: "desc" },
    });

    return NextResponse.json({
      ids: domains.map((d) => d.id),
    });
  } catch (error) {
    console.error("Error fetching domain IDs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
