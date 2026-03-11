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
} from "lucide-react";
import { cleanUrl, getScoreTextColor, getScoreBgColorSubtle } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface RecentScan {
  id: string;
  normalizedUrl: string;
  isActive: boolean;
  riskScore: number | null;
  lastCheckedAt: string | null;
  scanStatus: string | null;
}

interface HomePageContentProps {
  recentScans: RecentScan[];
}

export default function HomePageContent({ recentScans }: HomePageContentProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startPolling } = useNotifications();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam) setUrl(urlParam);
  }, [searchParams]);

  const parseDomains = (input: string): string[] => {
    return input
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => cleanUrl(s));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const domains = parseDomains(url);
    if (domains.length === 0) {
      setError("Enter a website URL to begin scanning.");
      return;
    }

    setIsLoading(true);

    try {
      if (domains.length === 1) {
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
        // Multiple URLs → create investigation
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

  return (
    <div className="flex flex-col items-center justify-start pt-52 sm:pt-60 px-4 sm:px-6">
      <div className="w-full max-w-xl mx-auto space-y-6">
        {/* Heading */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Domain Scanner
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground/80 leading-relaxed">
            Scan any domain for risk signals and compliance gaps
          </p>
        </div>

        {/* Search input */}
        <div className="search-hero">
          <form onSubmit={handleSubmit} className="flex flex-col p-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-3 h-4 w-4 text-muted-foreground/60"
                aria-hidden="true"
              />
              <textarea
                ref={textareaRef}
                placeholder="Enter domains, e.g. example.com, site.org"
                value={url}
                onChange={(e) => { setUrl(e.target.value); autoResize(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                disabled={isLoading}
                aria-label="Website domains to scan"
                aria-describedby="url-helper"
                aria-invalid={error ? "true" : undefined}
                rows={1}
                style={{ outline: "none", boxShadow: "none" }}
                className="flex w-full rounded-md text-sm sm:text-base pl-10 pr-3 py-2.5 border-0 shadow-none outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 bg-transparent resize-none overflow-y-auto"
              />
            </div>
            <div className="flex justify-end pt-1 pb-0.5 pr-1">
            <Button
              type="submit"
              disabled={isLoading}
              className="h-9 px-4 rounded-full text-sm font-semibold shadow-sm hover:shadow-md active:shadow-none active:scale-[0.97] hover:brightness-110 transition-all duration-150"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span className="hidden sm:inline">Scanning{"\u2026"}</span>
                </>
              ) : (
                <>
                  {parseDomains(url).length > 1 ? `Investigate (${parseDomains(url).length})` : "Scan"}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
            </div>
          </form>
        </div>

        {/* Error state */}
        {error && (
          <div
            className="p-3 bg-danger-tint border border-destructive/20 rounded-lg text-sm text-destructive flex items-start gap-2"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            {error}
          </div>
        )}

        {/* Recent scans */}
        {recentScans.length > 0 && (
          <div className="space-y-2 pt-6 border-t border-border/50">
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
            <div className="bg-card border rounded-xl divide-y overflow-hidden">
              {recentScans.map((scan) => (
                <button
                  key={scan.id}
                  onClick={() => router.push(`/scans/${scan.id}`)}
                  className="recent-scan-item group w-full text-left px-4 py-2.5 hover:pl-5 transition-all duration-150"
                >
                  {/* Score indicator */}
                  <div className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${scan.riskScore !== null ? getScoreBgColorSubtle(scan.riskScore) : "bg-muted/50"}`}>
                    {scan.riskScore !== null ? (
                      <span className={`text-sm font-bold tabular-nums ${getScoreTextColor(scan.riskScore)}`}>
                        {scan.riskScore}
                      </span>
                    ) : (
                      <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>

                  {/* Domain info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{scan.normalizedUrl}</p>
                    <p className="text-xs text-muted-foreground">
                      {scan.lastCheckedAt
                        ? formatDistanceToNow(new Date(scan.lastCheckedAt), { addSuffix: true })
                        : "Not yet scanned"}
                    </p>
                  </div>

                  {/* Status */}
                  <Badge
                    variant={scan.isActive ? "success-subtle" : "danger-subtle"}
                    className="shrink-0"
                  >
                    {scan.isActive ? "Active" : "Inactive"}
                  </Badge>

                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 group-hover:translate-x-0.5 transition-all duration-150" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
