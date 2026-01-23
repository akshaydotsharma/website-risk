import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
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

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Scan History</h1>
            <p className="text-muted-foreground">
              View and manage all website scans
            </p>
          </div>
          <Link href="/">
            <Button>New Scan</Button>
          </Link>
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
