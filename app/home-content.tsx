"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNotifications } from "@/components/notification-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Search,
  ArrowRight,
  AlertCircle,
  Globe,
  ChevronRight,
  Network,
  ShieldCheck,
  FileSearch,
  Bot,
  Camera,
  Scale,
  GitBranch,
  Layers,
  BarChart3,
} from "lucide-react";
import { cleanUrl, getScoreTextColor, getScoreBgColorSubtle } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

type Mode = "scan" | "investigate";

interface RecentScan {
  id: string;
  normalizedUrl: string;
  isActive: boolean;
  riskScore: number | null;
  lastCheckedAt: string | null;
  scanStatus: string | null;
}

interface RecentInvestigation {
  id: string;
  name: string | null;
  status: string;
  domainCount: number;
  highRiskCount: number;
  createdAt: string;
}

interface HomePageContentProps {
  recentScans: RecentScan[];
  recentInvestigations: RecentInvestigation[];
}

function getStatusVariant(status: string): "success-subtle" | "info-subtle" | "danger-subtle" | "secondary" {
  switch (status) {
    case "completed": return "success-subtle";
    case "scanning":
    case "analyzing":
    case "pending": return "info-subtle";
    case "failed": return "danger-subtle";
    default: return "secondary";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "completed": return "Completed";
    case "scanning": return "Scanning";
    case "analyzing": return "Analyzing";
    case "pending": return "Pending";
    case "failed": return "Failed";
    default: return status;
  }
}

export default function HomePageContent({ recentScans, recentInvestigations }: HomePageContentProps) {
  const [mode, setMode] = useState<Mode>("scan");
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startPolling } = useNotifications();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam) setUrl(urlParam);
  }, [searchParams]);

  // Focus appropriate input on mode switch
  useEffect(() => {
    if (mode === "scan") {
      inputRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [mode]);

  const parseDomains = (input: string): string[] => {
    return input
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => cleanUrl(s));
  };

  const domainCount = parseDomains(url).length;

  // Validation error for scan mode with multiple domains
  const scanModeError = mode === "scan" && domainCount > 1
    ? "Only one domain allowed in Single Scan. Switch to Investigate Cluster for multiple domains."
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const domains = parseDomains(url);
    if (domains.length === 0) {
      setError(mode === "scan"
        ? "Enter a website URL to begin scanning."
        : "Enter at least 2 domains to investigate.");
      return;
    }

    if (mode === "investigate" && domains.length < 2) {
      setError("Enter at least 2 domains to run a cluster investigation.");
      return;
    }

    setIsLoading(true);

    try {
      if (mode === "scan") {
        if (domains.length > 1) return;
        const response = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://${domains[0]}` }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to create scan");
        startPolling();
        router.push(`/scans/${data.id}`);
      } else {
        // Investigation
        const response = await fetch("/api/investigations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: domains.map((d) => `https://${d}`) }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to create investigation");
        startPolling();
        router.push(`/investigations/${data.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred. Check the URL and try again.");
      setIsLoading(false);
    }
  };

  const hasHistory = recentScans.length > 0 || recentInvestigations.length > 0;

  return (
    <div className="flex flex-col items-center justify-start pt-12 sm:pt-16 px-4 sm:px-6 pb-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        {/* Heading */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Domain Risk Analysis
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground/80 leading-relaxed">
            Scan domains for risk signals or investigate clusters for coordinated patterns
          </p>
        </div>

        {/* Mode Segmented Control */}
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center bg-muted/50 rounded-lg p-1 gap-1">
            <button
              onClick={() => { setMode("scan"); setError(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                mode === "scan"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              Single Scan
            </button>
            <button
              onClick={() => { setMode("investigate"); setError(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                mode === "investigate"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Network className="h-3.5 w-3.5" />
              Investigate Cluster
            </button>
          </div>
        </div>

        {/* Input Area */}
        <form onSubmit={handleSubmit}>
          {mode === "scan" ? (
            /* Single-line: input + button inline */
            <>
            <div className="search-hero flex items-center gap-2 px-3 py-1.5">
              <Search
                className="h-4 w-4 text-muted-foreground/60 shrink-0"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                type="text"
                placeholder="Enter a domain, e.g. example.com"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                disabled={isLoading}
                aria-label="Website domain to scan"
                aria-invalid={error ? "true" : undefined}
                className="flex-1 min-w-0 text-sm sm:text-base py-2 border-none shadow-none outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 bg-transparent appearance-none placeholder:text-muted-foreground/50"
              />
              <Button
                type="submit"
                disabled={isLoading || !!scanModeError}
                className="h-9 px-4 rounded-full text-sm font-semibold shadow-sm hover:shadow-md active:shadow-none active:scale-[0.97] hover:brightness-110 transition-all duration-150 shrink-0"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span className="hidden sm:inline">Scanning{"\u2026"}</span>
                  </>
                ) : (
                  <>
                    Scan
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
            </>
          ) : (
            /* Textarea for investigate mode */
            <div className="search-hero flex flex-col p-2">
              <p className="text-xs text-muted-foreground px-3 pt-1.5 pb-0.5">Enter 2 or more domains, one per line or comma-separated</p>
              <div className="relative">
                <Network
                  className="absolute left-3 top-3 h-4 w-4 text-muted-foreground/60"
                  aria-hidden="true"
                />
                <textarea
                  ref={textareaRef}
                  placeholder={"site1.com\nsite2.org\nsite3.net"}
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(null); autoResize(); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  disabled={isLoading}
                  aria-label="Website domains to investigate"
                  aria-invalid={error ? "true" : undefined}
                  rows={3}
                  style={{ outline: "none", boxShadow: "none" }}
                  className="flex w-full rounded-md text-sm sm:text-base pl-10 pr-3 py-2.5 border-0 shadow-none outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 bg-transparent resize-none overflow-y-auto"
                />
              </div>
              <div className="flex items-center justify-between pt-1 pb-0.5 px-1">
                <div className="flex items-center gap-2">
                  {domainCount > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {domainCount} domain{domainCount !== 1 ? "s" : ""} detected
                    </span>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="h-9 px-4 rounded-full text-sm font-semibold shadow-sm hover:shadow-md active:shadow-none active:scale-[0.97] hover:brightness-110 transition-all duration-150"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span className="hidden sm:inline">Starting{"\u2026"}</span>
                    </>
                  ) : (
                    <>
                      Investigate
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Error state — right below the input */}
          {(scanModeError || error) && (
            <p className="text-xs text-destructive pt-2" role="alert">
              {scanModeError || error}
            </p>
          )}
        </form>

        {/* Deliverables preview */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground/70">
          {mode === "scan" ? (
            <>
              <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Risk Score</span>
              <span className="flex items-center gap-1"><Scale className="h-3 w-3" />Policy Check</span>
              <span className="flex items-center gap-1"><Bot className="h-3 w-3" />AI Content</span>
              <span className="flex items-center gap-1"><FileSearch className="h-3 w-3" />WHOIS</span>
              <span className="flex items-center gap-1"><Camera className="h-3 w-3" />Screenshot</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />Similarity</span>
              <span className="flex items-center gap-1"><Layers className="h-3 w-3" />Cluster Detection</span>
              <span className="flex items-center gap-1"><Network className="h-3 w-3" />Shared Infra</span>
              <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" />Risk Heatmap</span>
            </>
          )}
        </div>

        {/* Keyboard hint for investigate mode */}
        {mode === "investigate" && (
          <p className="text-center text-[11px] text-muted-foreground/50">
            Press <kbd className="px-1 py-0.5 bg-muted/50 rounded text-[10px] font-mono">Cmd+Enter</kbd> to submit
          </p>
        )}

        {/* Recent Activity */}
        {hasHistory && (
          <div className="grid sm:grid-cols-2 gap-6 pt-4 border-t border-border/50">
            {/* Recent Scans */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-label">Recent Scans</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground gap-1 h-7"
                  onClick={() => router.push("/scans")}
                >
                  View All
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
              {recentScans.length > 0 ? (
                <div className="bg-card border rounded-xl divide-y overflow-hidden">
                  {recentScans.map((scan) => (
                    <button
                      key={scan.id}
                      onClick={() => router.push(`/scans/${scan.id}`)}
                      className="recent-scan-item group w-full text-left px-4 py-2.5 hover:pl-5 transition-all duration-150"
                    >
                      <div className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${scan.riskScore !== null ? getScoreBgColorSubtle(scan.riskScore) : "bg-muted/50"}`}>
                        {scan.riskScore !== null ? (
                          <span className={`text-sm font-bold tabular-nums ${getScoreTextColor(scan.riskScore)}`}>
                            {scan.riskScore}
                          </span>
                        ) : (
                          <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{scan.normalizedUrl}</p>
                        <p className="text-xs text-muted-foreground">
                          {scan.lastCheckedAt
                            ? formatDistanceToNow(new Date(scan.lastCheckedAt), { addSuffix: true })
                            : "Not yet scanned"}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 group-hover:translate-x-0.5 transition-all duration-150" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="border rounded-xl p-6 text-center">
                  <Globe className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No scans yet</p>
                </div>
              )}
            </div>

            {/* Recent Investigations */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-label">Recent Investigations</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground gap-1 h-7"
                  onClick={() => router.push("/investigations")}
                >
                  View All
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
              {recentInvestigations.length > 0 ? (
                <div className="bg-card border rounded-xl divide-y overflow-hidden">
                  {recentInvestigations.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => router.push(`/investigations/${inv.id}`)}
                      className="recent-scan-item group w-full text-left px-4 py-2.5 hover:pl-5 transition-all duration-150"
                    >
                      <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 bg-primary/10">
                        <Network className="h-4 w-4 text-primary" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {inv.name || `Investigation`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {inv.domainCount} domain{inv.domainCount !== 1 ? "s" : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(inv.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge variant={getStatusVariant(inv.status)} className="shrink-0">
                        {getStatusLabel(inv.status)}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 group-hover:translate-x-0.5 transition-all duration-150" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="border rounded-xl p-6 text-center">
                  <Network className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No investigations yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* First-time empty state */}
        {!hasHistory && (
          <div className="pt-8 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">How it works</p>
              <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground pt-2">
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-primary">1</span>
                  </div>
                  <span>Enter domains</span>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-primary">2</span>
                  </div>
                  <span>Analyze risk</span>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-primary">3</span>
                  </div>
                  <span>Review findings</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
