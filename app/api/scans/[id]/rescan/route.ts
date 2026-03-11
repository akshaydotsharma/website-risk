import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUrl } from "@/lib/utils";
import { processScanWrapper } from "@/lib/scan-processor";
import { resolveDomainAndScan } from "@/lib/domainUtils";

export const maxDuration = 600;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await resolveDomainAndScan(id);
    if (!result) {
      return NextResponse.json({ error: "Domain or scan not found" }, { status: 404 });
    }

    const { domain, scanUrl } = result;
    const url = normalizeUrl(scanUrl);
    const checkedAt = new Date();

    // Create a new scan record
    const newScan = await prisma.websiteScan.create({
      data: {
        domainId: domain.id,
        url,
        isActive: false,
        statusCode: null,
        status: "pending",
        checkedAt,
      },
    });

    // Log the rescan input
    await prisma.urlInput.create({
      data: {
        rawInput: url,
        domainId: domain.id,
        source: "settings",
      },
    });

    // Run the full scan pipeline synchronously (rescan waits for result)
    await processScanWrapper(newScan.id, domain.id, url, domain.normalizedUrl);

    return NextResponse.json({
      id: domain.id,
      scanId: newScan.id,
      normalizedUrl: domain.normalizedUrl,
    });
  } catch (error) {
    console.error("[ERROR] Rescan failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
