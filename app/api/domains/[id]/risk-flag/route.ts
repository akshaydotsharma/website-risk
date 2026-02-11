import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const riskFlagSchema = z.object({
  isRisky: z.boolean(),
  note: z.string().max(1000).optional(),
});

// GET - Fetch current risk flag status
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const domain = await prisma.domain.findUnique({
      where: { id },
      select: {
        isManuallyRisky: true,
        manualRiskNote: true,
        manualRiskSetAt: true,
      },
    });

    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    return NextResponse.json(domain);
  } catch (error) {
    console.error("Error fetching risk flag:", error);
    return NextResponse.json(
      { error: "Failed to fetch risk flag" },
      { status: 500 }
    );
  }
}

// PATCH - Update risk flag
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const validation = riskFlagSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { isRisky, note } = validation.data;

    // Verify domain exists
    const existingDomain = await prisma.domain.findUnique({
      where: { id },
    });

    if (!existingDomain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const domain = await prisma.domain.update({
      where: { id },
      data: {
        isManuallyRisky: isRisky,
        manualRiskNote: isRisky ? note || null : null,
        manualRiskSetAt: isRisky ? new Date() : null,
      },
      select: {
        isManuallyRisky: true,
        manualRiskNote: true,
        manualRiskSetAt: true,
      },
    });

    return NextResponse.json(domain);
  } catch (error) {
    console.error("Error updating risk flag:", error);
    return NextResponse.json(
      { error: "Failed to update risk flag" },
      { status: 500 }
    );
  }
}
