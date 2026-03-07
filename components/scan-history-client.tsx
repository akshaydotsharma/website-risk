"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ScanHistoryTable } from "@/components/scan-history-table";
import { PageHeader } from "@/components/page-header";
import { useNotifications } from "@/components/notification-context";
import { Globe, Plus, FileSearch, Loader2, ShieldAlert, RefreshCw } from "lucide-react";

interface DataPoint {
  id: string;
  key: string;
  label: string;
  value: string;
}

interface Scan {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface Domain {
  id: string;
  normalizedUrl: string;
  isActive: boolean;
  statusCode: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  dataPoints: DataPoint[];
  screenshotCount: number;
  scanCount: number;
  scans: Scan[];
  recentInputs: {
    rawInput: string;
    source: string;
    createdAt: string;
  }[];
}

interface ScanHistoryClientProps {
  initialDomains: Domain[];
  stats: { totalScans: number; activeCount: number; highRiskCount: number };
  currentPage: number;
  totalPages: number;
}

export function ScanHistoryClient({ initialDomains, stats, currentPage: initialPage, totalPages: initialTotalPages }: ScanHistoryClientProps) {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>(initialDomains);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const sortRef = useRef<{ field: string; direction: string }>({ field: "lastUpdatedAt", direction: "desc" });

  // Sync from server on initial load only
  useEffect(() => {
    setDomains(initialDomains);
    setPage(initialPage);
    setTotalPages(initialTotalPages);
  }, [initialDomains, initialPage, initialTotalPages]);

  const [startingSimilarity, setStartingSimilarity] = useState(false);
  const [startingRescan, setStartingRescan] = useState(false);
  const { notifications, activeScans, startPolling } = useNotifications();
  const prevNotifCountRef = useRef(notifications.length);
  const prevActiveCountRef = useRef(activeScans.length);

  const fetchDomains = useCallback(async (p: number) => {
    try {
      const { field, direction } = sortRef.current;
      const response = await fetch(`/api/scans?page=${p}&limit=10&sortField=${field}&sortDirection=${direction}`);
      const data = await response.json();
      if (data.domains) {
        setDomains(data.domains);
      }
      if (data.totalCount != null) {
        setTotalPages(Math.ceil(data.totalCount / 10));
      }
    } catch (error) {
      console.error("Failed to fetch domains:", error);
    }
  }, []);

  // Auto-refresh when scans complete (new notification) or active count changes
  useEffect(() => {
    const notifChanged = notifications.length !== prevNotifCountRef.current;
    const activeChanged = activeScans.length !== prevActiveCountRef.current;
    prevNotifCountRef.current = notifications.length;
    prevActiveCountRef.current = activeScans.length;

    if (notifChanged || activeChanged) {
      fetchDomains(page);
    }
  }, [notifications.length, activeScans.length, page, fetchDomains]);

  const goToPage = useCallback((p: number) => {
    setPage(p);
    fetchDomains(p);
    // Update URL without full page reload
    window.history.replaceState(null, "", `/scans?page=${p}`);
  }, [fetchDomains]);

  const handleDomainDeleted = (domainId: string) => {
    setDomains((prev) => prev.filter((d) => d.id !== domainId));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(domainId);
      return next;
    });
  };

  const handleRefresh = useCallback(async () => {
    await fetchDomains(page);
  }, [page, fetchDomains]);

  const handleSortChange = useCallback(async (field: string, direction: string) => {
    sortRef.current = { field, direction };
    setPage(1);
    window.history.replaceState(null, "", `/scans?page=1`);
    await fetchDomains(1);
  }, [fetchDomains]);

  const handleBulkRescan = async () => {
    if (selected.size === 0) return;
    setStartingRescan(true);
    try {
      const res = await fetch("/api/scans/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainIds: Array.from(selected), source: "api" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start rescan");
      }
      startPolling();
      setSelected(new Set());
      await handleRefresh();
    } catch (err) {
      console.error("Failed to start bulk rescan:", err);
    } finally {
      setStartingRescan(false);
    }
  };

  const handleRunSimilarity = async () => {
    if (selected.size < 2) return;
    setStartingSimilarity(true);
    try {
      const res = await fetch("/api/about-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create analysis");
      }
      const data = await res.json();
      router.push(`/about-analysis/${data.id}`);
    } catch (err) {
      console.error("Failed to start similarity analysis:", err);
      setStartingSimilarity(false);
    }
  };

  if (domains.length === 0) {
    return (
      <div className="border rounded-xl bg-card">
        <div className="empty-state py-16">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
            <Globe className="h-8 w-8 text-primary" aria-hidden="true" />
          </div>
          <p className="text-base font-semibold text-foreground mb-1">No Scans Yet</p>
          <p className="empty-state-description">
            Scan a domain to extract risk signals, policies, and contact information.
          </p>
          <Link href="/" className="mt-5">
            <Button size="lg">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Your First Scan
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Scan History"
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleBulkRescan}
              disabled={selected.size === 0 || startingRescan}
            >
              {startingRescan ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Rescanning…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Rescan{selected.size >= 1 ? ` (${selected.size})` : ""}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleRunSimilarity}
              disabled={selected.size < 2 || startingSimilarity}
            >
              {startingSimilarity ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <FileSearch className="h-4 w-4" aria-hidden="true" />
                  Run Similarity{selected.size >= 2 ? ` (${selected.size})` : ""}
                </>
              )}
            </Button>
            <Link href="/">
              <Button>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Scan
              </Button>
            </Link>
          </>
        }
      />

      {/* Stats bar */}
      {stats.totalScans > 0 && (
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
              <Globe className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <span className="font-semibold text-foreground tabular-nums">{stats.totalScans}</span> domain{stats.totalScans !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-success" aria-hidden="true" />
            </div>
            <div>
              <span className="font-semibold text-success tabular-nums">{stats.activeCount}</span> Active
            </div>
          </div>
          {stats.highRiskCount > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
              </div>
              <div>
                <span className="font-semibold text-destructive tabular-nums">{stats.highRiskCount}</span> high risk
              </div>
            </div>
          )}
        </div>
      )}
      <ScanHistoryTable
        domains={domains}
        selected={selected}
        onSelectionChange={setSelected}
        onDomainDeleted={handleDomainDeleted}
        onRefresh={handleRefresh}
        totalDomainCount={stats.totalScans}
        onSortChange={handleSortChange}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
            >
              Previous
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | "...")[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] ?? 0) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((item, i) =>
                item === "..." ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">
                    ...
                  </span>
                ) : (
                  <Button
                    key={item}
                    variant={item === page ? "default" : "outline"}
                    size="sm"
                    className="w-9"
                    onClick={() => goToPage(item as number)}
                  >
                    {item}
                  </Button>
                )
              )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
