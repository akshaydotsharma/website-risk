import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const screenshot = await prisma.screenshot.findUnique({
      where: { id },
      select: { data: true, format: true },
    });

    if (!screenshot) {
      return NextResponse.json(
        { error: "Screenshot not found" },
        { status: 404 }
      );
    }

    if (!screenshot.data) {
      return NextResponse.json(
        { error: "Screenshot has no image data" },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(screenshot.data, "base64");
    const contentType =
      screenshot.format === "png" ? "image/png" : "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error: any) {
    console.error("Error serving screenshot:", error);
    return NextResponse.json(
      { error: "Failed to serve screenshot" },
      { status: 500 }
    );
  }
}
