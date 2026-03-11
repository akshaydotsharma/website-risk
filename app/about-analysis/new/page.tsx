import { prisma } from "@/lib/prisma";
import { DomainSelector } from "./domain-selector";
import { DataPointKey } from "@/lib/constants";

export const dynamic = "force-dynamic";

async function getDomainsWithAboutData() {
  const domains = await prisma.domain.findMany({
    include: {
      dataPoints: {
        where: { key: { in: [DataPointKey.ABOUT_PAGE, DataPointKey.RISK_ASSESSMENT] } },
      },
    },
    orderBy: { lastCheckedAt: "desc" },
  });

  return domains.map((d) => {
    const aboutDp = d.dataPoints.find((dp) => dp.key === DataPointKey.ABOUT_PAGE);
    const riskDp = d.dataPoints.find((dp) => dp.key === DataPointKey.RISK_ASSESSMENT);
    let hasAboutText = false;
    if (aboutDp) {
      try {
        const data = JSON.parse(aboutDp.value);
        hasAboutText = !!data.text_content && data.text_content.length > 50;
      } catch {}
    }
    let riskScore: number | null = null;
    if (riskDp) {
      try {
        riskScore = JSON.parse(riskDp.value).overall_risk_score;
      } catch {}
    }

    return {
      id: d.id,
      normalizedUrl: d.normalizedUrl,
      isActive: d.isActive,
      hasAboutText,
      riskScore,
      lastCheckedAt: d.lastCheckedAt?.toISOString() || null,
    };
  });
}

export default async function NewAnalysisPage() {
  const domains = await getDomainsWithAboutData();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-page-title">Website Similarity</h1>
      </div>

      <DomainSelector domains={domains} />
    </div>
  );
}
