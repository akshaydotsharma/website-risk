import { NextResponse } from "next/server";
import { runHomepageComparison, compareInputSchema } from "@/lib/compare";
import { normalizeUrl } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

// Allow up to 2 minutes for comparison (embeddings can be slow)
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate input
    const validation = compareInputSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { urlA: rawUrlA, urlB: rawUrlB } = validation.data;

    // Normalize URLs
    const urlA = normalizeUrl(rawUrlA);
    const urlB = normalizeUrl(rawUrlB);

    // Check if URLs are the same
    if (urlA === urlB) {
      return NextResponse.json(
        { error: "URLs must be different" },
        { status: 400 }
      );
    }

    // Check if comparison already exists (in either order)
    const existingComparison = await prisma.homepageComparison.findFirst({
      where: {
        OR: [
          { AND: [{ urlA }, { urlB }] },
          { AND: [{ urlA: urlB }, { urlB: urlA }] },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    // If comparison exists, return it
    if (existingComparison) {
      return NextResponse.json(
        {
          id: existingComparison.id,
          urlA: existingComparison.urlA,
          urlB: existingComparison.urlB,
          overallScore: existingComparison.overallScore,
          textScore: existingComparison.textScore,
          domScore: existingComparison.domScore,
          confidence: existingComparison.confidence,
          existing: true, // Flag to indicate this was an existing comparison
        },
        { status: 200 }
      );
    }

    // Run comparison
    const { comparisonId, result } = await runHomepageComparison(urlA, urlB);

    return NextResponse.json(
      {
        id: comparisonId,
        urlA: result.urlA,
        urlB: result.urlB,
        overallScore: result.overallScore,
        textScore: result.textScore,
        domScore: result.domScore,
        confidence: result.confidence,
        existing: false, // Flag to indicate this is a new comparison
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating comparison:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Comparison failed", details: errorMessage },
      { status: 500 }
    );
  }
}
