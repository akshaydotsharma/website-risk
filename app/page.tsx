import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { DataPointKey } from "@/lib/constants";
import HomePageContent from "./home-content";

export const dynamic = "force-dynamic";

async function getRecentScans() {
  const domains = await prisma.domain.findMany({
    include: {
      dataPoints: {
        where: {
          key: {
            in: [DataPointKey.RISK_ASSESSMENT, DataPointKey.AI_LIKELIHOOD],
          },
        },
      },
      scans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      lastCheckedAt: "desc",
    },
    take: 5,
  });

  return domains.map((domain) => {
    let riskScore: number | null = null;
    const riskDp = domain.dataPoints.find((dp) => dp.key === DataPointKey.RISK_ASSESSMENT);
    if (riskDp) {
      try {
        riskScore = JSON.parse(riskDp.value).overall_risk_score ?? null;
      } catch { /* skip */ }
    }

    return {
      id: domain.id,
      normalizedUrl: domain.normalizedUrl,
      isActive: domain.isActive,
      riskScore,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      scanStatus: domain.scans[0]?.status ?? null,
    };
  });
}

export default async function HomePage() {
  const recentScans = await getRecentScans();

  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomePageContent recentScans={recentScans} />
    </Suspense>
  );
}

function HomePageSkeleton() {
  return (
    <div className="max-w-xl mx-auto pt-10 space-y-6">
      <div className="text-center space-y-2">
        <div className="h-8 w-48 bg-muted animate-pulse rounded-lg mx-auto" />
        <div className="h-4 w-72 bg-muted/60 animate-pulse rounded mx-auto" />
      </div>
      <div className="h-14 bg-muted/50 rounded-xl animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
