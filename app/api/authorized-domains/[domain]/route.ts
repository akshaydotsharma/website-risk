import { NextResponse } from "next/server";
import { removeAuthorizedDomain } from "@/lib/discovery";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ domain: string }> }
) {
  try {
    const { domain } = await params;
    const decodedDomain = decodeURIComponent(domain);

    await removeAuthorizedDomain(decodedDomain);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error removing authorized domain:", error);

    // Handle not found
    if (error?.code === "P2025") {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
