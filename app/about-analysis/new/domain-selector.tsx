"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { getScoreTextColor } from "@/lib/utils";

interface DomainOption {
  id: string;
  normalizedUrl: string;
  isActive: boolean;
  hasAboutText: boolean;
  riskScore: number | null;
  lastCheckedAt: string | null;
}

export function DomainSelector({ domains }: { domains: DomainOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return domains;
    const q = search.toLowerCase();
    return domains.filter((d) => d.normalizedUrl.toLowerCase().includes(q));
  }, [domains, search]);

  const domainsWithAbout = useMemo(
    () => domains.filter((d) => d.hasAboutText),
    [domains]
  );

  const toggleDomain = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllWithAbout = () => {
    setSelected(new Set(domainsWithAbout.map((d) => d.id)));
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  const pairCount = (selected.size * (selected.size - 1)) / 2;

  const handleSubmit = async () => {
    if (selected.size < 2) return;
    setLoading(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header row: title + analyze button */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Select Domains</h2>
        <Button
          onClick={handleSubmit}
          disabled={selected.size < 2 || loading}
          size="sm"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting…
            </>
          ) : (
            <>
              Analyze {selected.size >= 2 ? `${selected.size} Domains` : "Domains"}
            </>
          )}
        </Button>
      </div>

      {/* Search + selection controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search domains\u2026"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 bg-card"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set(filtered.map((d) => d.id)))}>
            Select All ({filtered.length})
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll}>
            Deselect All
          </Button>
          <span className="text-sm text-muted-foreground ml-2">
            {selected.size} selected
            {selected.size >= 2 && (
              <span className="text-muted-foreground/60"> · {pairCount} pairs</span>
            )}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* Column headers */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div className="w-5 shrink-0" />
          <div className="flex-1 min-w-0">URL</div>
          <div className="w-14 shrink-0 text-right">Score</div>
          <div className="w-20 shrink-0 text-right">Status</div>
        </div>

        {/* Rows */}
        <div className="divide-y">
          {filtered.map((domain) => {
            const isSelected = selected.has(domain.id);
            return (
              <label
                key={domain.id}
                className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                  isSelected ? "bg-primary/5" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleDomain(domain.id)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30 shrink-0"
                />
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <span className="text-sm font-semibold truncate">
                    {domain.normalizedUrl}
                  </span>
                  <span className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={`https://${domain.normalizedUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={`Open ${domain.normalizedUrl}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Open link</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={`/scans/${domain.id}`}
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={`Website scan for ${domain.normalizedUrl}`}
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Open website scan</TooltipContent>
                    </Tooltip>
                  </span>
                </div>
                <div className="w-14 shrink-0 text-right">
                  {domain.riskScore !== null ? (
                    <span className={`text-sm font-bold tabular-nums ${getScoreTextColor(domain.riskScore)}`}>
                      {domain.riskScore}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <div className="w-20 shrink-0 text-right">
                  <Badge
                    variant={domain.isActive ? "success-subtle" : "danger-subtle"}
                    className="text-xs border-0"
                  >
                    {domain.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </label>
            );
          })}
          {filtered.length === 0 && (
            <div className="empty-state py-8">
              <Search className="h-5 w-5 text-muted-foreground mb-2" aria-hidden="true" />
              <p className="empty-state-title">No domains match your search</p>
              <p className="empty-state-description">Try a different search term or scan new domains first.</p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

    </div>
  );
}
