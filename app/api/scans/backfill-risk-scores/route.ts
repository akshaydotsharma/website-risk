import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    // The risk score is stored as JSON in domain_risk_assessment data point
    const result = await prisma.$executeRaw`
      UPDATE "Domain" d
      SET "riskScore" = (dp.value::jsonb ->> 'overall_risk_score')::int
      FROM "DomainDataPoint" dp
      WHERE dp."domainId" = d.id
        AND dp.key = 'domain_risk_assessment'
        AND d."riskScore" IS NULL
        AND dp.value::jsonb ->> 'overall_risk_score' IS NOT NULL
    `;

    return NextResponse.json({
      updated: result,
      message: `Backfilled riskScore for ${result} domains`,
    });
  } catch (error) {
    console.error("Backfill error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
