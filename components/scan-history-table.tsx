"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScoreRing } from "@/components/score-ring";
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
  Bot,
  ShieldAlert,
  Search,
  ArrowUpDown,
  ChevronRight,
  Globe,
  AlertTriangle,
  Info,
  Check,
  X as XIcon,
} from "lucide-react";
import { getScoreTextColor, getScoreBgColor, getRiskLabel } from "@/lib/utils";

interface DataPoint {
  id: string;
  key: string;
  label: string;
  value: string;
}

interface Scan {
  id: string;
  status: string; // "pending" | "processing" | "completed" | "failed"
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

interface ScanHistoryTableProps {
  domains: Domain[];
  selected: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onDomainDeleted?: (domainId: string) => void;
  onRefresh?: () => void;
  totalDomainCount?: number;
  onSortChange?: (field: SortField, direction: "asc" | "desc") => void;
}

type SortField = "normalizedUrl" | "isActive" | "lastUpdatedAt" | "createdAt" | "riskScore";

const SORT_FIELD_KEY = "scans_sort_field";
const SORT_DIRECTION_KEY = "scans_sort_direction";

// Helper to check if a domain has contact details
function hasContactDetails(dataPoints: DataPoint[]): boolean {
  const contactDataPoint = dataPoints.find((dp) => dp.key === "contact_details");
  if (!contactDataPoint) return false;

  try {
    const value = JSON.parse(contactDataPoint.value);
    return Boolean(
      (value.emails && value.emails.length > 0) ||
      (value.phone_numbers && value.phone_numbers.length > 0) ||
      (value.addresses && value.addresses.length > 0)
    );
  } catch {
    return false;
  }
}

// Helper to get AI-generated likelihood score
function getAiScore(dataPoints: DataPoint[]): { score: number | null; confidence: number | null } {
  const aiDataPoint = dataPoints.find((dp) => dp.key === "ai_generated_likelihood");
  if (!aiDataPoint) return { score: null, confidence: null };

  try {
    const value = JSON.parse(aiDataPoint.value);
    return {
      score: value.ai_generated_score ?? null,
      confidence: value.confidence ?? null,
    };
  } catch {
    return { score: null, confidence: null };
  }
}

// Helper to get risk assessment score
function getRiskScore(dataPoints: DataPoint[]): {
  overallScore: number | null;
  primaryRiskType: string | null;
  confidence: string | null;
  phishing: number | null;
  shellCompany: number | null;
  compliance: number | null;
} {
  const riskDataPoint = dataPoints.find((dp) => dp.key === "domain_risk_assessment");
  if (!riskDataPoint) return { overallScore: null, primaryRiskType: null, confidence: null, phishing: null, shellCompany: null, compliance: null };

  try {
    const value = JSON.parse(riskDataPoint.value);
    const riskTypeScores = value.risk_type_scores || {};
    return {
      overallScore: value.overall_risk_score ?? null,
      primaryRiskType: value.primary_risk_type ?? null,
      confidence: value.confidence ?? null,
      phishing: riskTypeScores.phishing ?? null,
      shellCompany: riskTypeScores.shell_company ?? null,
      compliance: riskTypeScores.compliance ?? null,
    };
  } catch {
    return { overallScore: null, primaryRiskType: null, confidence: null, phishing: null, shellCompany: null, compliance: null };
  }
}

// Helper to check if domain has an in-progress scan
function isScanning(domain: Domain): boolean {
  const latestScan = domain.scans?.[0];
  if (!latestScan) return false;

  const status = latestScan.status;
  if (status === "completed" || status === "failed") return false;

  return status === "pending" || status === "processing";
}

// Helper to check if a scan is stalled (processing > 20 min since last update)
function isStalled(domain: Domain): boolean {
  const latestScan = domain.scans?.[0];
  if (!latestScan) return false;

  const status = latestScan.status;
  if (status !== "pending" && status !== "processing") return false;

  // Use updatedAt if available (reflects last status change), fallback to createdAt
  const lastUpdate = (latestScan as any).updatedAt || latestScan.createdAt;
  const sinceUpdate = Date.now() - new Date(lastUpdate).getTime();
  return sinceUpdate > 20 * 60 * 1000;
}

// Helper to check if domain has meaningful scan data
function hasMeaningfulData(dataPoints: DataPoint[]): boolean {
  const meaningfulKeys = [
    'domain_risk_assessment',
    'ai_generated_likelihood',
    'domain_intel_signals',
    'homepage_sku_summary',
    'contact_details',
    'policy_links'
  ];
  return dataPoints.some(dp => meaningfulKeys.includes(dp.key));
}

// Helper to get effective scan status
function getEffectiveScanStatus(domain: Domain): "completed" | "failed" | "pending" | "processing" | null {
  const rawStatus = domain.scans?.[0]?.status ?? null;

  if (rawStatus === "failed" && hasMeaningfulData(domain.dataPoints)) {
    return "completed";
  }

  return rawStatus as "completed" | "failed" | "pending" | "processing" | null;
}

// Helper to get scan summary checklist
function getScanSummary(domain: Domain) {
  const dp = domain.dataPoints;

  const hasContact = (() => {
    const cdp = dp.find((d) => d.key === "contact_details");
    if (!cdp) return false;
    try {
      const v = JSON.parse(cdp.value);
      return Boolean(v.emails?.length || v.phone_numbers?.length || v.addresses?.length);
    } catch { return false; }
  })();

  const hasAbout = (() => {
    const adp = dp.find((d) => d.key === "about_page");
    if (!adp) return false;
    try {
      const v = JSON.parse(adp.value);
      return !!v.text_content && v.text_content.length > 50;
    } catch { return false; }
  })();

  const hasPolicy = dp.some((d) => d.key === "policy_links");

  const hasSku = (() => {
    const sdp = dp.find((d) => d.key === "homepage_sku_summary");
    if (!sdp) return false;
    try {
      const v = JSON.parse(sdp.value);
      return (v.sku_count ?? 0) > 0;
    } catch { return false; }
  })();

  const hasScreenshot = domain.screenshotCount > 0;

  const domainAge = (() => {
    const sdp = dp.find((d) => d.key === "domain_intel_signals");
    if (!sdp) return null;
    try {
      const v = JSON.parse(sdp.value);
      if (v.domain_age_years != null) {
        return v.domain_age_years < 1
          ? `${v.domain_age_days ?? 0} days`
          : `${v.domain_age_years.toFixed(1)} years`;
      }
      return null;
    } catch { return null; }
  })();

  return { hasContact, hasAbout, hasPolicy, hasSku, hasScreenshot, domainAge };
}

// Format primary risk type for display
function formatRiskType(type: string | null): string {
  if (!type) return "Unknown";
  if (type === "shell_company") return "Shell Company";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function ScanHistoryTable({ domains, selected, onSelectionChange, onDomainDeleted, onRefresh, totalDomainCount, onSortChange }: ScanHistoryTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>("lastUpdatedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isLoading, setIsLoading] = useState(true);
  const [rescanning, setRescanning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Poll for updates when there are in-progress scans
  useEffect(() => {
    const hasInProgressScans = domains.some(isScanning);
    if (!hasInProgressScans || !onRefresh) return;

    const interval = setInterval(() => {
      onRefresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [domains, onRefresh]);

  // Load saved sort preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      try {
        const [fieldRes, directionRes] = await Promise.all([
          fetch(`/api/preferences?key=${SORT_FIELD_KEY}`),
          fetch(`/api/preferences?key=${SORT_DIRECTION_KEY}`),
        ]);

        const fieldData = await fieldRes.json();
        const directionData = await directionRes.json();

        if (fieldData.preference?.value) {
          // Migrate old preference name
          const field = fieldData.preference.value === "lastCheckedAt" ? "lastUpdatedAt" : fieldData.preference.value;
          setSortField(field as SortField);
          // Persist migrated value
          if (field !== fieldData.preference.value) {
            fetch("/api/preferences", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: SORT_FIELD_KEY, value: field }),
            }).catch(() => {});
          }
        }
        if (directionData.preference?.value) {
          setSortDirection(directionData.preference.value as "asc" | "desc");
        }
      } catch (error) {
        console.error("Failed to load sort preferences:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadPreferences();
  }, []);

  // Save preference to database
  const savePreference = useCallback(async (key: string, value: string) => {
    try {
      await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch (error) {
      console.error("Failed to save preference:", error);
    }
  }, []);

  // Handle sort
  const handleSort = useCallback(
    (field: SortField) => {
      let newField = field;
      let newDirection: "asc" | "desc" = "desc";
      if (sortField === field) {
        newDirection = sortDirection === "asc" ? "desc" : "asc";
      }
      setSortField(newField);
      setSortDirection(newDirection);
      savePreference(SORT_FIELD_KEY, newField);
      savePreference(SORT_DIRECTION_KEY, newDirection);
      onSortChange?.(newField, newDirection);
    },
    [sortField, sortDirection, savePreference, onSortChange]
  );

  // Filter and sort the domains
  const filteredAndSortedDomains = useMemo(() => {
    let filtered = domains;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = domains.filter((d) => d.normalizedUrl.toLowerCase().includes(q));
    }

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "normalizedUrl":
          comparison = a.normalizedUrl.localeCompare(b.normalizedUrl);
          break;
        case "isActive":
          comparison = Number(a.isActive) - Number(b.isActive);
          break;
        case "riskScore": {
          const aRisk = getRiskScore(a.dataPoints).overallScore ?? -1;
          const bRisk = getRiskScore(b.dataPoints).overallScore ?? -1;
          comparison = aRisk - bRisk;
          break;
        }
        case "lastUpdatedAt": {
          const aTime = new Date(a.scans?.[0]?.updatedAt || a.lastCheckedAt || 0).getTime();
          const bTime = new Date(b.scans?.[0]?.updatedAt || b.lastCheckedAt || 0).getTime();
          comparison = aTime - bTime;
          break;
        }
        case "createdAt":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [domains, sortField, sortDirection, searchQuery]);

  const handleRescan = useCallback(async (e: React.MouseEvent, domainId: string) => {
    e.stopPropagation();
    setRescanning(domainId);
    try {
      const response = await fetch(`/api/scans/${domainId}/rescan`, {
        method: "POST",
      });
      if (response.ok) {
        router.push(`/scans/${domainId}`);
      }
    } catch (error) {
      console.error("Failed to rescan:", error);
    } finally {
      setRescanning(null);
    }
  }, [router]);

  const handleDelete = useCallback(async (e: React.MouseEvent, domainId: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this domain and all its scan data?")) {
      return;
    }
    setDeleting(domainId);
    try {
      const response = await fetch(`/api/domains/${domainId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        onDomainDeleted?.(domainId);
      }
    } catch (error) {
      console.error("Failed to delete:", error);
    } finally {
      setDeleting(null);
    }
  }, [onDomainDeleted]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* Search skeleton */}
        <div className="h-10 bg-muted/50 rounded-lg animate-pulse" />
        {/* Card skeletons */}
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="domain-card animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 bg-muted rounded" />
                  <div className="h-3 w-24 bg-muted/60 rounded" />
                </div>
                <div className="h-6 w-16 bg-muted rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative max-w-sm">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="text"
          placeholder="Search domains\u2026"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search scanned domains"
          className="pl-9 h-10 bg-card"
        />
      </div>

      {/* Results count */}
      {searchQuery.trim() && (
        <p className="text-xs text-muted-foreground">
          {filteredAndSortedDomains.length} {filteredAndSortedDomains.length === 1 ? "result" : "results"} for &ldquo;{searchQuery}&rdquo;
        </p>
      )}

      {/* Column Headers — sortable */}
      <div className="flex items-center gap-0 pr-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {/* Select All checkbox — aligned with row checkboxes */}
        <div
          className="shrink-0 w-10 flex items-center justify-center cursor-pointer"
          onClick={async () => {
            const total = totalDomainCount ?? filteredAndSortedDomains.length;
            if (selected.size >= total) {
              // All selected → deselect all
              onSelectionChange(new Set());
            } else {
              // Fetch all domain IDs across all pages
              try {
                const res = await fetch("/api/domains/ids");
                if (res.ok) {
                  const data = await res.json();
                  onSelectionChange(new Set(data.ids));
                }
              } catch {
                // Fallback: select visible only
                onSelectionChange(new Set(filteredAndSortedDomains.map((d) => d.id)));
              }
            }
          }}
        >
          <input
            type="checkbox"
            checked={(totalDomainCount ?? filteredAndSortedDomains.length) > 0 && selected.size >= (totalDomainCount ?? filteredAndSortedDomains.length)}
            ref={(el) => {
              if (el) {
                const total = totalDomainCount ?? filteredAndSortedDomains.length;
                el.indeterminate = selected.size > 0 && selected.size < total;
              }
            }}
            readOnly
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer pointer-events-none"
            aria-label="Select all domains"
          />
        </div>
        <div className="flex items-center gap-4 flex-1 pl-4 sm:pl-5">
        <button
          className={`w-14 shrink-0 text-center cursor-pointer hover:text-foreground transition-colors ${sortField === "riskScore" ? "text-primary" : ""}`}
          onClick={() => handleSort("riskScore")}
        >
          Score <span className="text-[10px]">{sortField === "riskScore" ? (sortDirection === "desc" ? "↓" : "↑") : "↕"}</span>
        </button>
        <button
          className={`flex-1 min-w-0 text-left cursor-pointer hover:text-foreground transition-colors ${sortField === "normalizedUrl" ? "text-primary" : ""}`}
          onClick={() => handleSort("normalizedUrl")}
        >
          URL <span className="text-[10px]">{sortField === "normalizedUrl" ? (sortDirection === "desc" ? "↓" : "↑") : "↕"}</span>
        </button>
        <button
          className={`w-20 shrink-0 text-left cursor-pointer hover:text-foreground transition-colors ${sortField === "isActive" ? "text-primary" : ""}`}
          onClick={() => handleSort("isActive")}
        >
          Status <span className="text-[10px]">{sortField === "isActive" ? (sortDirection === "desc" ? "↓" : "↑") : "↕"}</span>
        </button>
        <button
          className={`w-32 shrink-0 text-left cursor-pointer hover:text-foreground transition-colors ${sortField === "lastUpdatedAt" ? "text-primary" : ""}`}
          onClick={() => handleSort("lastUpdatedAt")}
        >
          Last Updated <span className="text-[10px]">{sortField === "lastUpdatedAt" ? (sortDirection === "desc" ? "↓" : "↑") : "↕"}</span>
        </button>
        <div className="w-24 shrink-0" />
        </div>
      </div>

      {/* Domain Cards Grid */}
      <div className="grid gap-3">
        {filteredAndSortedDomains.map((domain) => {
          const risk = getRiskScore(domain.dataPoints);
          const ai = getAiScore(domain.dataPoints);
          const hasContacts = hasContactDetails(domain.dataPoints);
          const scanning = isScanning(domain);
          const effectiveStatus = getEffectiveScanStatus(domain);
          const summary = getScanSummary(domain);

          return (
            <div key={domain.id} className="flex items-center gap-0">
              {/* Checkbox — outside the clickable card */}
              <div
                className="shrink-0 w-10 flex items-center justify-center self-stretch cursor-pointer"
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(domain.id)) next.delete(domain.id);
                  else next.add(domain.id);
                  onSelectionChange(next);
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(domain.id)}
                  readOnly
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer pointer-events-none"
                />
              </div>
              {/* Clickable card */}
              <div
                className={`domain-card group/card flex-1 ${selected.has(domain.id) ? "!border-transparent !bg-primary/5" : ""}`}
                onClick={() => router.push(`/scans/${domain.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/scans/${domain.id}`);
                  }
                }}
                aria-label={`View scan report for ${domain.normalizedUrl}`}
              >
              <div className="flex items-center gap-4">
                {/* Score */}
                <div className="w-14 shrink-0 flex justify-center">
                  {risk.overallScore !== null ? (
                    <ScoreRing
                      score={risk.overallScore}
                      size={42}
                      strokeWidth={3.5}
                    />
                  ) : scanning ? (
                    <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                      <Globe className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
                    </div>
                  )}
                </div>

                {/* URL + Info */}
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <a
                    href={`https://${domain.normalizedUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate transition-colors duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {domain.normalizedUrl}
                  </a>
                  {effectiveStatus === "completed" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
                          aria-label="Scan summary"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="start" className="p-0 w-56">
                        <div className="p-3 space-y-1.5 text-xs">
                          <p className="font-semibold text-foreground text-xs mb-2">Scan Summary</p>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Contact Details</span>
                            {summary.hasContact
                              ? <Check className="h-3.5 w-3.5 text-success" />
                              : <XIcon className="h-3.5 w-3.5 text-muted-foreground/30" />}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">About Us</span>
                            {summary.hasAbout
                              ? <Check className="h-3.5 w-3.5 text-success" />
                              : <XIcon className="h-3.5 w-3.5 text-muted-foreground/30" />}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Policy Pages</span>
                            {summary.hasPolicy
                              ? <Check className="h-3.5 w-3.5 text-success" />
                              : <XIcon className="h-3.5 w-3.5 text-muted-foreground/30" />}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Homepage SKUs</span>
                            {summary.hasSku
                              ? <Check className="h-3.5 w-3.5 text-success" />
                              : <XIcon className="h-3.5 w-3.5 text-muted-foreground/30" />}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Screenshot</span>
                            {summary.hasScreenshot
                              ? <Check className="h-3.5 w-3.5 text-success" />
                              : <XIcon className="h-3.5 w-3.5 text-muted-foreground/30" />}
                          </div>
                          {summary.domainAge && (
                            <div className="flex items-center justify-between pt-1 border-t">
                              <span className="text-muted-foreground">Domain Age</span>
                              <span className="font-medium text-foreground">{summary.domainAge}</span>
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {/* Status */}
                <div className="w-20 shrink-0">
                  {scanning && isStalled(domain) ? (
                    <Badge variant="danger-subtle" className="gap-1 border-0">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      Stalled
                    </Badge>
                  ) : scanning ? (
                    <Badge variant="info-subtle" className="gap-1 border-0">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Scanning
                    </Badge>
                  ) : effectiveStatus === "failed" ? (
                    <Badge variant="danger-subtle" className="border-0">Failed</Badge>
                  ) : (
                    <Badge
                      variant={domain.isActive ? "success-subtle" : "danger-subtle"}
                      className="border-0"
                    >
                      {domain.isActive ? "Active" : "Inactive"}
                    </Badge>
                  )}
                </div>

                {/* Last Scan */}
                <div className="w-32 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {(domain.scans?.[0]?.updatedAt || domain.lastCheckedAt)
                      ? formatDistanceToNow(new Date((domain.scans?.[0]?.updatedAt || domain.lastCheckedAt)!), { addSuffix: true })
                      : "Never scanned"}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 w-24 shrink-0 justify-end" data-interactive>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/scans/${domain.id}`);
                        }}
                        aria-label={`View report for ${domain.normalizedUrl}`}
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>View Report</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => handleRescan(e, domain.id)}
                        disabled={rescanning === domain.id}
                        aria-label={`Rescan ${domain.normalizedUrl}`}
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {rescanning === domain.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Rescan</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => handleDelete(e, domain.id)}
                        disabled={deleting === domain.id}
                        aria-label={`Delete ${domain.normalizedUrl}`}
                        className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {deleting === domain.id ? (
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
            </div>
          );
        })}
      </div>

      {/* Empty search results */}
      {filteredAndSortedDomains.length === 0 && searchQuery.trim() && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="empty-state-title">No Domains Found</p>
          <p className="empty-state-description">
            No domains match &ldquo;{searchQuery}&rdquo;. Try a different search term.
          </p>
        </div>
      )}
    </div>
  );
}
