import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { captureScreenshot } from "@/lib/screenshots";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const screenshots = await prisma.screenshot.findMany({
      where: {
        domainId: id,
        error: null, // exclude failed captures
        fileSize: { gt: 0 },
      },
      select: {
        id: true,
        url: true,
        captureType: true,
        format: true,
        width: true,
        height: true,
        fileSize: true,
        durationMs: true,
        scanId: true,
        segment: true,
        segmentGroup: true,
        segmentIndex: true,
        pageHeight: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { segmentIndex: "asc" }],
    });

    return NextResponse.json({ screenshots });
  } catch (error: any) {
    console.error("Error listing screenshots:", error);
    return NextResponse.json(
      { error: "Failed to list screenshots" },
      { status: 500 }
    );
  }
}

// Allow up to 2 minutes for screenshot capture
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const domain = await prisma.domain.findUnique({
      where: { id },
    });

    if (!domain) {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    const url = domain.normalizedUrl.startsWith("http")
      ? domain.normalizedUrl
      : `https://${domain.normalizedUrl}`;

    const result = await captureScreenshot({
      url,
      domainId: domain.id,
      captureType: "manual",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Screenshot capture failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      screenshotIds: result.screenshotIds,
      segmentCount: result.segmentCount,
      pageHeight: result.pageHeight,
      durationMs: result.durationMs,
    });
  } catch (error: any) {
    console.error("Error capturing screenshot:", error);
    return NextResponse.json(
      { error: "Failed to capture screenshot" },
      { status: 500 }
    );
  }
}
