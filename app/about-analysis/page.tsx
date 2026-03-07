import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import {
  Plus,
  FileSearch,
  Clock,
  Network,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/page-header";
import { SimilarityRunsTable } from "./similarity-runs-table";

export const dynamic = "force-dynamic";

export default async function AboutAnalysisHistoryPage() {
  const runs = await prisma.aboutUsAnalysisRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Compute summary stats
  const totalRuns = runs.length;
  const allClusteredDomains = new Set<string>();
  for (const r of runs) {
    if (!r.summary) continue;
    try {
      const parsed = JSON.parse(r.summary);
      for (const cluster of parsed.clusters || []) {
        for (const m of cluster.members || []) allClusteredDomains.add(m.domainId);
      }
    } catch { /* skip */ }
  }
  const totalClustered = allClusteredDomains.size;
  const latestRun = runs[0];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Website Similarity"
        actions={
          <Link href="/about-analysis/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Analysis
            </Button>
          </Link>
        }
      />

      {/* Stats bar */}
      {totalRuns > 0 && (
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
              <FileSearch className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <span className="font-semibold text-foreground tabular-nums">{totalRuns}</span> {totalRuns === 1 ? "run" : "runs"}
            </div>
          </div>
          {totalClustered > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-8 h-8 rounded-lg bg-[hsl(var(--warning-tint))] flex items-center justify-center">
                <Network className="h-4 w-4 text-[hsl(var(--caution))]" aria-hidden="true" />
              </div>
              <div>
                <span className="font-semibold text-[hsl(var(--caution))] tabular-nums">{totalClustered}</span> clustered domains
              </div>
            </div>
          )}
          {latestRun && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                <Clock className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                Latest {formatDistanceToNow(new Date(latestRun.createdAt), { addSuffix: true })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Run List */}
      {runs.length === 0 ? (
        <div className="border rounded-xl bg-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileSearch className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="empty-state-title">No Analysis Runs Yet</p>
            <p className="empty-state-description">
              Select domains to analyze for shared content and suspicious patterns.
            </p>
            <Link href="/about-analysis/new" className="mt-4">
              <Button variant="outline">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Run Your First Analysis
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <SimilarityRunsTable
          initialRuns={runs.map((run) => ({
            id: run.id,
            name: run.name,
            status: run.status,
            domainIds: run.domainIds,
            domainCount: run.domainCount,
            pairCount: run.pairCount,
            clusterCount: run.clusterCount,
            flaggedCount: run.flaggedCount,
            error: run.error,
            summary: run.summary,
            createdAt: run.createdAt.toISOString(),
            completedAt: run.completedAt?.toISOString() || null,
          }))}
        />
      )}
    </div>
  );
}
