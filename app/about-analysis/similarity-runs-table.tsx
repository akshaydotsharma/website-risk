"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import {
  Eye,
  RefreshCw,
  Trash2,
  Loader2,
} from "lucide-react";
import { RunNameCell } from "./run-name-cell";

interface Run {
  id: string;
  name: string | null;
  status: string;
  domainIds: string;
  domainCount: number;
  pairCount: number;
  clusterCount: number;
  flaggedCount: number;
  error: string | null;
  summary: string | null;
  createdAt: string;
  completedAt: string | null;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <Badge variant="success-subtle" className="border-0">Completed</Badge>;
    case "processing":
      return (
        <Badge variant="info-subtle" className="border-0 gap-1">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Processing
        </Badge>
      );
    case "failed":
      return <Badge variant="danger-subtle" className="border-0">Failed</Badge>;
    default:
      return (
        <Badge variant="secondary" className="border-0 gap-1">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Pending
        </Badge>
      );
  }
}

export function SimilarityRunsTable({
  initialRuns,
}: {
  initialRuns: Run[];
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleRerun = useCallback(
    async (e: React.MouseEvent, run: Run) => {
      e.stopPropagation();
      setRerunning(run.id);
      try {
        const domainIds = JSON.parse(run.domainIds);
        const res = await fetch("/api/about-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domainIds }),
        });
        if (res.ok) {
          const data = await res.json();
          router.push(`/about-analysis/${data.id}`);
        }
      } catch (error) {
        console.error("Failed to rerun:", error);
      } finally {
        setRerunning(null);
      }
    },
    [router]
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, runId: string) => {
      e.stopPropagation();
      if (!confirm("Are you sure you want to delete this analysis run?")) return;
      setDeleting(runId);
      try {
        const res = await fetch(`/api/about-analysis/${runId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setRuns((prev) => prev.filter((r) => r.id !== runId));
        }
      } catch (error) {
        console.error("Failed to delete:", error);
      } finally {
        setDeleting(null);
      }
    },
    []
  );

  return (
    <div className="space-y-4">
      {/* Column Headers */}
      <div className="flex items-center gap-4 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <div className="flex-1 min-w-0">Name</div>
        <div className="w-24 shrink-0">Status</div>
        <div className="w-32 shrink-0">Time</div>
        <div className="w-24 shrink-0" />
      </div>

      {/* Runs */}
      <div className="grid gap-3">
        {runs.map((run) => {
          const isFailed = run.status === "failed";

          return (
            <div
              key={run.id}
              className={`domain-card group/card ${isFailed ? "border-destructive/30" : ""}`}
              onClick={() => router.push(`/about-analysis/${run.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/about-analysis/${run.id}`);
                }
              }}
              aria-label={`View analysis ${run.name || "Untitled run"}`}
            >
              <div className="flex items-center gap-4">
                {/* Name */}
                <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                  <RunNameCell runId={run.id} initialName={run.name} />
                  {isFailed && run.error && (
                    <p className="text-xs text-destructive truncate mt-0.5">
                      {run.error}
                    </p>
                  )}
                </div>

                {/* Status */}
                <div className="w-24 shrink-0">
                  <StatusBadge status={run.status} />
                </div>

                {/* Time */}
                <div className="w-32 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 w-24 shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/about-analysis/${run.id}`);
                        }}
                        aria-label="View analysis"
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>View Analysis</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => handleRerun(e, run)}
                        disabled={rerunning === run.id}
                        aria-label="Rerun analysis"
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {rerunning === run.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Rerun</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => handleDelete(e, run.id)}
                        disabled={deleting === run.id}
                        aria-label="Delete analysis"
                        className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {deleting === run.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
