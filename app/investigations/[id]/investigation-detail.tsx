"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/components/notification-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScoreRing } from "@/components/score-ring";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import {
  ContentSimilarityTab,
  UniquenessCheckTab,
} from "@/components/similarity/similarity-tabs";
import { ClusterAnalysis } from "@/components/similarity/cluster-analysis";
import type { InvestigationSimilarityData } from "./investigation-similarity";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import {
  Globe,
  Loader2,
  XCircle,
  BarChart3,
  RotateCcw,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Pencil,
  Eye,
  RefreshCw,
  Network,
  Fingerprint,
  Search,
} from "lucide-react";

interface InvestigationData {
  id: string;
  name: string | null;
  status: string;
  domainCount: number;
  scannedCount: number;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  summary: {
    totalDomains: number;
    completed: number;
    failed: number;
    scanning: number;
    pending: number;
    highRiskCount: number;
    avgRiskScore: number;
    clusterCount: number;
    hasUniqueness: boolean;
  };
  domains: Array<{
    domainId: string;
    url: string;
    riskScore: number | null;
    isActive: boolean;
    statusCode: number | null;
    status: string;
    scanId: string | null;
    error: string | null;
    hasUniqueness?: boolean;
  }>;
}

type DomainSortField = "riskScore" | "url" | "status";

export function InvestigationDetail({
  data: initialData,
  similarityData,
}: {
  data: InvestigationData;
  similarityData: InvestigationSimilarityData | null;
}) {
  const router = useRouter();
  const { startPolling } = useNotifications();
  const [data, setData] = useState(initialData);
  const [rerunning, setRerunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(data.name || "Investigation");
  const [rescanning, setRescanning] = useState<string | null>(null);
  const [sortField, setSortField] = useState<DomainSortField>("riskScore");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState("domains");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const isActive = data.status === "pending" || data.status === "scanning" || data.status === "analyzing";
  const canRerun = !isActive && !rerunning;

  // Sync state when server props change (after router.refresh)
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  // Poll for updates while active
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/investigations/${data.id}`);
      if (res.ok) {
        const updated = await res.json();
        setData(updated);
        // When investigation completes, reload to get server-side similarity data
        const wasActive = ["pending", "scanning", "analyzing"].includes(data.status);
        const nowDone = updated.status === "completed" || updated.status === "failed";
        if (wasActive && nowDone) {
          // Small delay to ensure DB writes are flushed before server fetch
          setTimeout(() => router.refresh(), 500);
        }
      }
    } catch {}
  }, [data.id, data.status, router]);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [isActive, poll]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const failedCount = data.domains.filter((d) => d.status === "failed" && d.isActive !== false).length;

  const handleRetryFailed = async () => {
    setRerunning(true);
    try {
      const res = await fetch(`/api/investigations/${data.id}/retry-failed`, { method: "POST" });
      if (res.ok) {
        setData((prev) => ({ ...prev, status: "pending", error: null }));
        startPolling();
      }
    } catch {} finally {
      setRerunning(false);
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      const res = await fetch(`/api/investigations/${data.id}/rerun`, { method: "POST" });
      if (res.ok) {
        setData((prev) => ({ ...prev, status: "pending", scannedCount: 0, error: null }));
        startPolling();
      }
    } catch {} finally {
      setRerunning(false);
    }
  };

  const handleSaveName = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === data.name) {
      setEditing(false);
      setEditName(data.name || "Investigation");
      return;
    }
    try {
      const res = await fetch(`/api/investigations/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setData((prev) => ({ ...prev, name: trimmed }));
      }
    } catch {}
    setEditing(false);
  };

  const handleSort = useCallback((field: DomainSortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }, [sortField]);

  const handleRescan = useCallback(async (e: React.MouseEvent, domainId: string) => {
    e.stopPropagation();
    setRescanning(domainId);
    try {
      const res = await fetch(`/api/scans/${domainId}/rescan`, { method: "POST" });
      if (res.ok) router.push(`/scans/${domainId}`);
    } catch {} finally {
      setRescanning(null);
    }
  }, [router]);

  // Compute cluster assignments: domainId → cluster number (1-based)
  const clusterMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!similarityData?.allPairs.length) return map;
    // Union-find on all pairs with score >= 50
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
    for (const p of similarityData.allPairs) {
      union(p.domainAId, p.domainBId);
    }
    // Group by root
    const groups = new Map<string, Set<string>>();
    for (const p of similarityData.allPairs) {
      for (const id of [p.domainAId, p.domainBId]) {
        const root = find(id);
        if (!groups.has(root)) groups.set(root, new Set());
        groups.get(root)!.add(id);
      }
    }
    // Assign cluster numbers, largest first
    const sorted = [...groups.values()].filter((g) => g.size >= 2).sort((a, b) => b.size - a.size);
    sorted.forEach((members, i) => {
      for (const id of members) map.set(id, i + 1);
    });
    return map;
  }, [similarityData]);

  const sortedDomains = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? data.domains.filter((d) => d.url.toLowerCase().includes(q)) : data.domains;
    return [...filtered].sort((a, b) => {
      // Primary: group by cluster (C1 first, C2 next, unclustered last)
      const ca = clusterMap.get(a.domainId) ?? Infinity;
      const cb = clusterMap.get(b.domainId) ?? Infinity;
      if (ca !== cb) return ca - cb;

      // Secondary: user-chosen sort
      let cmp = 0;
      switch (sortField) {
        case "riskScore":
          cmp = (a.riskScore ?? -1) - (b.riskScore ?? -1);
          break;
        case "url":
          cmp = a.url.localeCompare(b.url);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [data.domains, sortField, sortDirection, searchQuery, clusterMap]);

  const toggleCluster = (key: string) => {
    setCollapsedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const progress = data.domainCount > 0
    ? Math.round((data.scannedCount / data.domainCount) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header: back + editable title + re-run */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/investigations"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted flex-shrink-0"
            aria-label="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          {editing ? (
            <div className="flex items-center gap-2 min-w-0">
              <input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") { setEditing(false); setEditName(data.name || "Investigation"); }
                }}
                onBlur={handleSaveName}
                className="text-page-title border border-primary/50 rounded-md px-2 py-1 bg-card shadow-inner transition-all duration-200 outline-none min-w-0"
              />
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="group flex items-center gap-2 min-w-0 hover:bg-muted rounded-md px-1 -mx-1 transition-colors"
            >
              <h1 className="text-page-title truncate underline decoration-muted-foreground/20 underline-offset-4 decoration-dotted">{data.name || "Investigation"}</h1>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canRerun && failedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryFailed}
              disabled={rerunning}
              className="gap-2"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry Failed ({failedCount})
            </Button>
          )}
          {canRerun && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRerun}
              disabled={rerunning}
              className="gap-2"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Re-run All
            </Button>
          )}
        </div>
      </div>

      {/* Status + Progress */}
      {isActive && (
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
              <span className="font-medium">
                {data.status === "analyzing" ? "Running similarity analysis..." : `Scanning ${data.scannedCount} of ${data.domainCount} domains...`}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5">
              <div
                className="bg-gradient-to-r from-primary/80 to-primary h-2.5 rounded-full transition-all duration-500 relative overflow-hidden"
                style={{ width: `${data.status === "analyzing" ? 95 : progress}%` }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
                    backgroundSize: "200% 100%",
                    animation: "shimmer 2s ease-in-out infinite",
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {data.status === "failed" && data.error && (
        <Card className="border-destructive/30 bg-danger-tint">
          <CardContent className="py-4 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <span className="text-sm text-destructive">{data.error}</span>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {data.summary.completed > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Domains"
            value={data.summary.totalDomains}
            icon={<Globe className="h-4 w-4" />}
            tint="bg-gradient-to-b from-primary/5 to-transparent"
          />
          <SummaryCard
            label="Clusters"
            value={data.summary.clusterCount}
            icon={<Network className="h-4 w-4" />}
            tint="bg-gradient-to-b from-violet-500/5 to-transparent"
          />
          <SummaryCard
            label="Avg Risk"
            value={data.summary.avgRiskScore}
            icon={<BarChart3 className="h-4 w-4" />}
            color={data.summary.avgRiskScore >= 60 ? "text-destructive" : data.summary.avgRiskScore >= 30 ? "text-warning" : "text-success"}
            tint={data.summary.avgRiskScore >= 60 ? "bg-gradient-to-b from-destructive/5 to-transparent" : data.summary.avgRiskScore >= 30 ? "bg-gradient-to-b from-amber-500/5 to-transparent" : "bg-gradient-to-b from-emerald-500/5 to-transparent"}
          />
          <SummaryCard
            label="Uniqueness"
            valueText={data.summary.hasUniqueness ? "Yes" : "No"}
            icon={<Fingerprint className="h-4 w-4" />}
            color={data.summary.hasUniqueness ? "text-destructive" : "text-success"}
            tint={data.summary.hasUniqueness ? "bg-gradient-to-b from-destructive/5 to-transparent" : "bg-gradient-to-b from-emerald-500/5 to-transparent"}
          />
        </div>
      )}

      {/* Tabbed Content: Domains + Similarity tabs */}
      <Tabs
        className="bg-[hsl(var(--surface-elevated))] dark:bg-card rounded-xl p-4 sm:p-6"
        tabs={[
          { key: "domains", label: "Domains" },
          ...(similarityData
            ? [
                { key: "clusters-test", label: "Clusters", badge: similarityData.summary.totalClusters || undefined },
                { key: "shared", label: "Content Similarity" },
                { key: "scam", label: "Uniqueness Check" },
              ]
            : []),
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        <TabPanel tabKey="domains" activeTab={activeTab}>
          <div className="space-y-3">
            {/* Search */}
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                type="text"
                placeholder="Search domains…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search domains"
                className="pl-9 h-9 bg-card"
              />
            </div>

            {/* Column Headers — sortable */}
            <div className="flex items-center gap-4 pr-4 text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
              <button
                className={`w-14 shrink-0 text-center cursor-pointer hover:text-foreground transition-colors ${sortField === "riskScore" ? "text-primary" : ""}`}
                onClick={() => handleSort("riskScore")}
              >
                Score <span className="text-[10px]">{sortField === "riskScore" ? (sortDirection === "desc" ? "↓" : "↑") : "↕"}</span>
              </button>
              <button
                className={`flex-1 min-w-0 text-left cursor-pointer hover:text-foreground transition-colors ${sortField === "url" ? "text-primary" : ""}`}
                onClick={() => handleSort("url")}
              >
                URL <span className="text-[10px]">{sortField === "url" ? (sortDirection === "desc" ? "↓" : "↑") : "↕"}</span>
              </button>
              <button
                className={`w-20 shrink-0 text-left cursor-pointer hover:text-foreground transition-colors ${sortField === "status" ? "text-primary" : ""}`}
                onClick={() => handleSort("status")}
              >
                Status <span className="text-[10px]">{sortField === "status" ? (sortDirection === "desc" ? "↓" : "↑") : "↕"}</span>
              </button>
              <div className="w-20 shrink-0" />
            </div>

            {/* Domain Cards — grouped by cluster, scrollable */}
            <div className="overflow-y-auto overscroll-contain pr-1 space-y-1" style={{ maxHeight: "600px" }}>
              {sortedDomains.length === 0 && searchQuery.trim() !== "" ? (
                <div className="py-12 text-center">
                  <Search className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" aria-hidden="true" />
                  <p className="text-sm font-medium text-muted-foreground">No domains match your search</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Try a different search term or clear the filter.
                  </p>
                </div>
              ) : null}
              {(() => {
                // Group domains by cluster for visual grouping
                const grouped: { cluster: number | null; key: string; domains: typeof sortedDomains }[] = [];
                let currentCluster: number | null | undefined = undefined;
                for (const domain of sortedDomains) {
                  const c = clusterMap.get(domain.domainId) ?? null;
                  if (c !== currentCluster) {
                    const key = c != null ? `c${c}` : "unclustered";
                    grouped.push({ cluster: c, key, domains: [] });
                    currentCluster = c;
                  }
                  grouped[grouped.length - 1].domains.push(domain);
                }

                return grouped.map((group, gi) => {
                  const isCollapsed = collapsedClusters.has(group.key);
                  return (
                  <div key={`g-${gi}`}>
                    {group.cluster != null && (
                      <button
                        onClick={() => toggleCluster(group.key)}
                        className="flex items-center gap-2 mb-2 mt-3 first:mt-0 w-full group/cluster"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3 w-3 text-violet-500" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-violet-500" />
                        )}
                        <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">
                          Cluster {group.cluster}
                        </span>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                          {group.domains.length}
                        </Badge>
                        <div className="flex-1 h-px bg-violet-200/50 dark:bg-violet-800/30" />
                      </button>
                    )}
                    {group.cluster == null && gi > 0 && (
                      <button
                        onClick={() => toggleCluster(group.key)}
                        className="flex items-center gap-2 mb-2 mt-3 w-full group/cluster"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Unclustered
                        </span>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                          {group.domains.length}
                        </Badge>
                        <div className="flex-1 h-px bg-border/50" />
                      </button>
                    )}
                    {!isCollapsed && (
                    <div className="grid gap-3">
                      {group.domains.map((domain) => (
                <div
                  key={domain.domainId}
                  className="domain-card group/card cursor-pointer"
                  onClick={() => domain.status === "completed" && router.push(`/scans/${domain.domainId}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && domain.status === "completed") {
                      e.preventDefault();
                      router.push(`/scans/${domain.domainId}`);
                    }
                  }}
                  aria-label={`View scan for ${domain.url}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-14 shrink-0 flex justify-center">
                      {domain.riskScore != null ? (
                        <ScoreRing score={domain.riskScore} size={42} strokeWidth={3.5} />
                      ) : domain.status === "scanning" ? (
                        <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                          <Globe className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`https://${domain.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate transition-colors duration-150"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {domain.url}
                        </a>
                      </div>
                      {domain.error && !(domain.status === "failed" && domain.isActive === false) && (
                        <p className="text-xs text-destructive mt-0.5 truncate">{domain.error}</p>
                      )}
                    </div>

                    {domain.hasUniqueness && domain.status === "completed" && (
                      <Badge variant="danger-subtle" className="border-0 shrink-0">
                        Uniqueness
                      </Badge>
                    )}

                    <div className="w-20 shrink-0">
                      {domain.status === "scanning" ? (
                        <Badge variant="info-subtle" className="gap-1 border-0">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          Scanning
                        </Badge>
                      ) : domain.status === "failed" && domain.isActive === false ? (
                        <Badge variant="danger-subtle" className="border-0">Inactive</Badge>
                      ) : domain.status === "failed" ? (
                        <Badge variant="danger-subtle" className="border-0">Failed</Badge>
                      ) : domain.status === "pending" ? (
                        <Badge variant="secondary" className="border-0">Pending</Badge>
                      ) : (
                        <Badge
                          variant={domain.isActive ? "success-subtle" : "danger-subtle"}
                          className="border-0"
                        >
                          {domain.isActive ? "Active" : "Inactive"}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-1 w-20 shrink-0 justify-end" data-interactive>
                      {domain.status === "completed" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/scans/${domain.domainId}`);
                              }}
                              aria-label={`View report for ${domain.url}`}
                              className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>View Report</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => handleRescan(e, domain.domainId)}
                            disabled={rescanning === domain.domainId || domain.status === "scanning"}
                            aria-label={`Rescan ${domain.url}`}
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {rescanning === domain.domainId ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <RefreshCw className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Rescan</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
                      ))}
                    </div>
                    )}
                  </div>
                  );
                });
              })()}
            </div>
          </div>
        </TabPanel>

        {similarityData && (
          <>
            <TabPanel tabKey="clusters-test" activeTab={activeTab}>
              <ClusterAnalysis allPairs={similarityData.allPairs} />
            </TabPanel>
            <TabPanel tabKey="shared" activeTab={activeTab}>
              <ContentSimilarityTab
                pairs={similarityData.allPairs}
                domainTexts={similarityData.domainTexts}
                targetDomainId={similarityData.hubDomainId}
                domainUrl={similarityData.hubDomainUrl}
              />
            </TabPanel>
            <TabPanel tabKey="scam" activeTab={activeTab}>
              <UniquenessCheckTab
                domainId={similarityData.hubDomainId}
                domainUrl={similarityData.hubDomainUrl}
                domainTexts={similarityData.domainTexts}
                scanAllDomains
              />
            </TabPanel>
          </>
        )}
      </Tabs>

    </div>
  );
}

function SummaryCard({
  label,
  value,
  valueText,
  icon,
  color,
  tint,
}: {
  label: string;
  value?: number;
  valueText?: string;
  icon: React.ReactNode;
  color?: string;
  tint?: string;
}) {
  return (
    <Card className={tint || ""}>
      <CardContent className="py-4 px-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <span className={`text-2xl font-bold tabular-nums ${color || ""}`}>
          {valueText ?? value}
        </span>
      </CardContent>
    </Card>
  );
}
