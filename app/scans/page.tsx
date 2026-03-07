import { prisma } from "@/lib/prisma";
import { ScanHistoryClient } from "@/components/scan-history-client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

async function getDomains(page: number) {
  const [domains, totalCount] = await Promise.all([
    prisma.domain.findMany({
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        dataPoints: true,
        _count: {
          select: { screenshots: true },
        },
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            error: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        urlInputs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: [
        { lastCheckedAt: "desc" },
        { id: "asc" },
      ],
    }),
    prisma.domain.count(),
  ]);

  return { domains, totalCount };
}

export default async function ScansPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const { domains, totalCount } = await getDomains(page);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Calculate summary stats across all domains
  const activeCount = await prisma.domain.count({ where: { isActive: true } });
  const riskDomains = await prisma.domain.findMany({
    where: { dataPoints: { some: { key: "domain_risk_assessment" } } },
    select: { dataPoints: { where: { key: "domain_risk_assessment" }, select: { value: true } } },
  });
  const highRiskCount = riskDomains.filter((d) => {
    try {
      return JSON.parse(d.dataPoints[0]?.value || "{}").overall_risk_score > 60;
    } catch { return false; }
  }).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <ScanHistoryClient
        stats={{ totalScans: totalCount, activeCount, highRiskCount }}
        currentPage={page}
        totalPages={totalPages}
        initialDomains={domains.map((domain) => ({
          id: domain.id,
          normalizedUrl: domain.normalizedUrl,
          isActive: domain.isActive,
          statusCode: domain.statusCode,
          lastCheckedAt: domain.lastCheckedAt?.toISOString() || null,
          createdAt: domain.createdAt.toISOString(),
          dataPoints: domain.dataPoints,
          screenshotCount: domain._count.screenshots,
          scanCount: domain.scans.length,
          scans: domain.scans.map((scan) => ({
            id: scan.id,
            status: scan.status,
            error: scan.error,
            createdAt: scan.createdAt.toISOString(),
            updatedAt: scan.updatedAt.toISOString(),
          })),
          recentInputs: domain.urlInputs.map((input) => ({
            rawInput: input.rawInput,
            source: input.source,
            createdAt: input.createdAt.toISOString(),
          })),
        }))}
      />
    </div>
  );
}
