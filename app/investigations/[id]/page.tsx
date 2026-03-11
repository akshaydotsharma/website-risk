import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { InvestigationDetail } from "./investigation-detail";
import { fetchInvestigationSimilarity } from "./investigation-similarity";

export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const investigation = await prisma.investigation.findUnique({
    where: { id },
    include: {
      domains: {
        include: {
          domain: {
            select: {
              id: true,
              normalizedUrl: true,
              riskScore: true,
              isActive: true,
              statusCode: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!investigation) notFound();

  const completedDomains = investigation.domains.filter((d) => d.status === "completed");
  const completedDomainIds = completedDomains.map((d) => d.domainId);
  const highRiskCount = completedDomains.filter((d) => (d.domain.riskScore ?? 0) >= 60).length;
  const avgRiskScore = completedDomains.length > 0
    ? Math.round(completedDomains.reduce((s, d) => s + (d.domain.riskScore ?? 0), 0) / completedDomains.length)
    : 0;

  // Always fetch similarity data when we have completed domains
  const similarityData = completedDomainIds.length >= 2
    ? await fetchInvestigationSimilarity(completedDomainIds)
    : null;
  // Note: fetchInvestigationSimilarity always returns data (never null) when domainIds.length >= 2

  const clusterCount = similarityData?.summary.totalClusters ?? 0;

  // Check uniqueness keywords per domain
  const uniquenessDomainIds = new Set<string>();
  if (similarityData) {
    const SCAM_KEYWORDS = ["uniqueness", "unique"];
    for (const dt of similarityData.domainTexts) {
      const allTexts = [dt.aboutText, ...dt.pageTexts.map((p) => p.text)].filter(Boolean);
      const flagged = allTexts.some((text) =>
        SCAM_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(text))
      );
      if (flagged) uniquenessDomainIds.add(dt.domainId);
    }
  }
  const hasUniqueness = uniquenessDomainIds.size > 0;

  const data = {
    id: investigation.id,
    name: investigation.name,
    status: investigation.status,
    domainCount: investigation.domainCount,
    scannedCount: investigation.scannedCount,
    createdAt: investigation.createdAt.toISOString(),
    completedAt: investigation.completedAt?.toISOString() ?? null,
    error: investigation.error,
    summary: {
      totalDomains: investigation.domains.length,
      completed: completedDomains.length,
      failed: investigation.domains.filter((d) => d.status === "failed" && d.domain.isActive !== false).length,
      scanning: investigation.domains.filter((d) => d.status === "scanning").length,
      pending: investigation.domains.filter((d) => d.status === "pending").length,
      highRiskCount,
      avgRiskScore,
      clusterCount,
      hasUniqueness,
    },
    domains: investigation.domains.map((d) => ({
      domainId: d.domainId,
      url: d.domain.normalizedUrl,
      riskScore: d.domain.riskScore,
      isActive: d.domain.isActive,
      statusCode: d.domain.statusCode,
      status: d.status,
      scanId: d.scanId,
      error: d.error,
      hasUniqueness: uniquenessDomainIds.has(d.domainId),
    })),
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <InvestigationDetail data={data} similarityData={similarityData} />
    </div>
  );
}
