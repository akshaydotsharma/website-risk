import { NextResponse } from "next/server";
import { getComparison } from "@/lib/compare";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await getComparison(id);

    if (!result) {
      return NextResponse.json(
        { error: "Comparison not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: result.comparisonId,
      urlA: result.urlA,
      urlB: result.urlB,
      overallScore: result.overallScore,
      textScore: result.textScore,
      domScore: result.domScore,
      confidence: result.confidence,
      reasons: result.reasons,
      statsA: result.featureDiff?.statsA || null,
      statsB: result.featureDiff?.statsB || null,
      featureDiff: result.featureDiff,
      artifacts: {
        a: {
          domain: result.artifactA.domain,
          finalUrl: result.artifactA.finalUrl,
          statusCode: result.artifactA.statusCode,
          ok: result.artifactA.ok,
          features: result.artifactA.features,
        },
        b: {
          domain: result.artifactB.domain,
          finalUrl: result.artifactB.finalUrl,
          statusCode: result.artifactB.statusCode,
          ok: result.artifactB.ok,
          features: result.artifactB.features,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching comparison:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if comparison exists
    const comparison = await prisma.homepageComparison.findUnique({
      where: { id },
    });

    if (!comparison) {
      return NextResponse.json(
        { error: "Comparison not found" },
        { status: 404 }
      );
    }

    // Delete the comparison
    await prisma.homepageComparison.delete({
      where: { id },
    });

    return NextResponse.json(
      { success: true, message: "Comparison deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting comparison:", error);
    return NextResponse.json(
      { error: "Failed to delete comparison" },
      { status: 500 }
    );
  }
}
