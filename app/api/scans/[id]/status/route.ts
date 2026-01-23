import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try to find by scan ID first
    let scan = await prisma.websiteScan.findUnique({
      where: { id },
      select: {
        id: true,
        domainId: true,
        status: true,
        error: true,
        isActive: true,
        statusCode: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // If not found, try to find the latest scan for a domain ID
    if (!scan) {
      scan = await prisma.websiteScan.findFirst({
        where: { domainId: id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          domainId: true,
          status: true,
          error: true,
          isActive: true,
          statusCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    if (!scan) {
      return NextResponse.json(
        { error: "Scan not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      scanId: scan.id,
      domainId: scan.domainId,
      status: scan.status,
      error: scan.error,
      isActive: scan.isActive,
      statusCode: scan.statusCode,
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching scan status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
