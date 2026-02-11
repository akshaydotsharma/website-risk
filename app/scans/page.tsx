import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Plus, Globe, ShieldAlert, Activity, Clock } from "lucide-react";
import { ScanHistoryClient } from "@/components/scan-history-client";

export const dynamic = "force-dynamic";

async function getDomains() {
  const domains = await prisma.domain.findMany({
    include: {
      dataPoints: true,
      scans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          error: true,
          createdAt: true,
        },
      },
      urlInputs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: {
      lastCheckedAt: "desc",
    },
  });

  return domains;
}

export default async function ScansPage() {
  const domains = await getDomains();

  // Calculate summary stats
  const totalScans = domains.length;
  const activeCount = domains.filter((d) => d.isActive).length;
  const last24h = domains.filter((d) => {
    if (!d.lastCheckedAt) return false;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return new Date(d.lastCheckedAt) > dayAgo;
  }).length;

  // Count high-risk domains (risk score > 60)
  const highRiskCount = domains.filter((d) => {
    const riskDp = d.dataPoints.find((dp) => dp.key === "domain_risk_assessment");
    if (!riskDp) return false;
    try {
      const value = JSON.parse(riskDp.value);
      return value.overall_risk_score > 60;
    } catch {
      return false;
    }
  }).length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-page-title">Scan History</h1>
          <p className="text-page-subtitle">
            Review scans, rescan domains, and open full intelligence reports.
          </p>
        </div>
        <Link href="/">
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Scan
          </Button>
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="stat-card">
          <p className="stat-card-label">
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            Total Scans
          </p>
          <p className="stat-card-value">{totalScans}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Active
          </p>
          <p className="stat-card-value text-success">{activeCount}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            High Risk
          </p>
          <p className="stat-card-value text-destructive">{highRiskCount}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Last 24h
          </p>
          <p className="stat-card-value">{last24h}</p>
        </div>
      </div>

      <ScanHistoryClient
        initialDomains={domains.map((domain) => ({
          id: domain.id,
          normalizedUrl: domain.normalizedUrl,
          isActive: domain.isActive,
          statusCode: domain.statusCode,
          lastCheckedAt: domain.lastCheckedAt?.toISOString() || null,
          createdAt: domain.createdAt.toISOString(),
          dataPoints: domain.dataPoints,
          scanCount: domain.scans.length,
          scans: domain.scans.map((scan) => ({
            id: scan.id,
            status: scan.status,
            error: scan.error,
            createdAt: scan.createdAt.toISOString(),
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
