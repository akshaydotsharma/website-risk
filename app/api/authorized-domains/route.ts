import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthorizedDomains, addAuthorizedDomain } from "@/lib/discovery";

const addDomainSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  allowSubdomains: z.boolean().optional(),
  respectRobots: z.boolean().optional(),
  maxPagesPerScan: z.number().int().min(1).max(200).optional(),
  crawlDelayMs: z.number().int().min(100).max(10000).optional(),
  notes: z.string().optional(),
});

export async function GET() {
  try {
    const domains = await getAuthorizedDomains();
    return NextResponse.json({ domains });
  } catch (error) {
    console.error("Error fetching authorized domains:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const validationResult = addDomainSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const domain = await addAuthorizedDomain(validationResult.data);
    return NextResponse.json({ domain }, { status: 201 });
  } catch (error: any) {
    console.error("Error adding authorized domain:", error);

    // Handle unique constraint violation
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "Domain already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
