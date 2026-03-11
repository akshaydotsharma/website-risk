import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { InvestigationsList } from "./investigations-list";

export default async function InvestigationsPage() {
  const investigations = await prisma.investigation.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      domains: {
        include: {
          domain: { select: { riskScore: true } },
        },
      },
    },
  });

  const data = investigations.map((inv) => ({
    id: inv.id,
    name: inv.name,
    status: inv.status,
    domainCount: inv.domainCount,
    highRiskCount: inv.domains.filter((d) => (d.domain.riskScore ?? 0) >= 60).length,
    createdAt: inv.createdAt.toISOString(),
  }));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <PageHeader title="Investigations" />
      <InvestigationsList investigations={data} />
    </div>
  );
}
