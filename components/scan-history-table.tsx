"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SortableTableHead,
  SortDirection,
} from "@/components/ui/sortable-table-head";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { History, Eye, RefreshCw, Trash2, Loader2, Bot, ShieldAlert } from "lucide-react";
import { getScoreTextColor, getScoreBgColor } from "@/lib/utils";

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
}

interface Domain {
  id: string;
  normalizedUrl: string;
  isActive: boolean;
  statusCode: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  dataPoints: DataPoint[];
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
  onDomainDeleted?: (domainId: string) => void;
  onRefresh?: () => void;
}

type SortField = "normalizedUrl" | "isActive" | "lastCheckedAt" | "createdAt";

const SORT_FIELD_KEY = "scans_sort_field";
const SORT_DIRECTION_KEY = "scans_sort_direction";

// Helper to check if a domain has contact details
function hasContactDetails(dataPoints: DataPoint[]): boolean {
  const contactDataPoint = dataPoints.find((dp) => dp.key === "contact_details");
  if (!contactDataPoint) return false;

  try {
    const value = JSON.parse(contactDataPoint.value);
    // Check if there's any meaningful contact information
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
  fraud: number | null;
  compliance: number | null;
  credit: number | null;
} {
  const riskDataPoint = dataPoints.find((dp) => dp.key === "domain_risk_assessment");
  if (!riskDataPoint) return { overallScore: null, primaryRiskType: null, confidence: null, phishing: null, fraud: null, compliance: null, credit: null };

  try {
    const value = JSON.parse(riskDataPoint.value);
    return {
      overallScore: value.overall_risk_score ?? null,
      primaryRiskType: value.primary_risk_type ?? null,
      confidence: value.confidence ?? null,
      phishing: value.phishing_score ?? null,
      fraud: value.fraud_score ?? null,
      compliance: value.compliance_score ?? null,
      credit: value.credit_score ?? null,
    };
  } catch {
    return { overallScore: null, primaryRiskType: null, confidence: null, phishing: null, fraud: null, compliance: null, credit: null };
  }
}


// Helper to check if domain has an in-progress scan
// Only consider "pending" or "processing" if the scan was created recently (within 5 minutes)
// This handles legacy scans that were created before the status field existed
function isScanning(domain: Domain): boolean {
  const latestScan = domain.scans?.[0];
  if (!latestScan) return false;

  const status = latestScan.status;
  if (status === "completed" || status === "failed") return false;

  // For pending/processing, check if scan is recent (within 5 minutes)
  const scanAge = Date.now() - new Date(latestScan.createdAt).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  return (status === "pending" || status === "processing") && scanAge < fiveMinutes;
}

// Helper to check if domain has meaningful scan data
function hasMeaningfulData(dataPoints: DataPoint[]): boolean {
  // Check for key data points that indicate a successful scan
  // Any extracted data means the scan at least partially succeeded
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
// A scan is considered successful if it has meaningful data, even if status says "failed"
function getEffectiveScanStatus(domain: Domain): "completed" | "failed" | "pending" | "processing" | null {
  const rawStatus = domain.scans?.[0]?.status ?? null;

  // If status is failed but we have meaningful data, treat as completed
  if (rawStatus === "failed" && hasMeaningfulData(domain.dataPoints)) {
    return "completed";
  }

  return rawStatus as "completed" | "failed" | "pending" | "processing" | null;
}

export function ScanHistoryTable({ domains, onDomainDeleted, onRefresh }: ScanHistoryTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>("lastCheckedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isLoading, setIsLoading] = useState(true);
  const [rescanning, setRescanning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Poll for updates when there are in-progress scans
  useEffect(() => {
    const hasInProgressScans = domains.some(isScanning);
    if (!hasInProgressScans || !onRefresh) return;

    const interval = setInterval(() => {
      onRefresh();
    }, 3000); // Poll every 3 seconds

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
          setSortField(fieldData.preference.value as SortField);
        }
        if (directionData.preference?.value) {
          setSortDirection(directionData.preference.value as SortDirection);
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

  // Handle sort column click
  const handleSort = useCallback(
    (field: string) => {
      const newField = field as SortField;

      if (sortField === newField) {
        // Toggle direction if same field
        const newDirection = sortDirection === "asc" ? "desc" : "asc";
        setSortDirection(newDirection);
        savePreference(SORT_DIRECTION_KEY, newDirection);
      } else {
        // New field, default to descending
        setSortField(newField);
        setSortDirection("desc");
        savePreference(SORT_FIELD_KEY, newField);
        savePreference(SORT_DIRECTION_KEY, "desc");
      }
    },
    [sortField, sortDirection, savePreference]
  );

  // Sort the domains
  const sortedDomains = useMemo(() => {
    const sorted = [...domains].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "normalizedUrl":
          comparison = a.normalizedUrl.localeCompare(b.normalizedUrl);
          break;
        case "isActive":
          // Active first when ascending
          comparison = Number(a.isActive) - Number(b.isActive);
          break;
        case "lastCheckedAt":
          const aTime = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0;
          const bTime = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0;
          comparison = aTime - bTime;
          break;
        case "createdAt":
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [domains, sortField, sortDirection]);

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

  const handleView = useCallback((e: React.MouseEvent, domainId: string) => {
    e.stopPropagation();
    router.push(`/scans/${domainId}`);
  }, [router]);

  if (isLoading) {
    return (
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Website URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="whitespace-nowrap">AI</TableHead>
              <TableHead className="whitespace-nowrap">Risk</TableHead>
              <TableHead className="whitespace-nowrap">Last Scanned</TableHead>
              <TableHead className="whitespace-nowrap">Created</TableHead>
              <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              sortKey="normalizedUrl"
              currentSortKey={sortField}
              currentSortDirection={sortDirection}
              onSort={handleSort}
            >
              Website URL
            </SortableTableHead>
            <SortableTableHead
              sortKey="isActive"
              currentSortKey={sortField}
              currentSortDirection={sortDirection}
              onSort={handleSort}
            >
              Status
            </SortableTableHead>
            <TableHead className="w-[90px] whitespace-nowrap">
              <div className="flex items-center gap-1">
                <Bot className="h-3 w-3 flex-shrink-0" />
                AI
              </div>
            </TableHead>
            <TableHead className="w-[90px] whitespace-nowrap">
              <div className="flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 flex-shrink-0" />
                Risk
              </div>
            </TableHead>
            <SortableTableHead
              sortKey="lastCheckedAt"
              currentSortKey={sortField}
              currentSortDirection={sortDirection}
              onSort={handleSort}
              className="whitespace-nowrap"
            >
              Last Scanned
            </SortableTableHead>
            <SortableTableHead
              sortKey="createdAt"
              currentSortKey={sortField}
              currentSortDirection={sortDirection}
              onSort={handleSort}
              className="whitespace-nowrap"
            >
              Created
            </SortableTableHead>
            <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedDomains.map((domain) => {
            const hasContacts = hasContactDetails(domain.dataPoints);
            return (
              <TableRow
                key={domain.id}
                className={`cursor-pointer relative ${
                  hasContacts
                    ? "!border-l-[3px] !border-l-green-500"
                    : "!border-l-[3px] !border-l-red-400/50"
                }`}
                onClick={(e) => {
                  // Don't navigate if clicking on interactive elements
                  const target = e.target as HTMLElement;
                  if (
                    target.closest("a") ||
                    target.closest("button") ||
                    target.closest("[data-interactive]")
                  ) {
                    return;
                  }
                  router.push(`/scans/${domain.id}`);
                }}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://${domain.normalizedUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {domain.normalizedUrl}
                    </a>
                    {domain.recentInputs?.length > 0 && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="text-muted-foreground cursor-help"
                              data-interactive
                            >
                              <History className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <div className="space-y-1">
                              <p className="font-medium text-xs">Recent inputs:</p>
                              {domain.recentInputs.slice(0, 3).map((input, i) => (
                                <p key={i} className="text-xs text-muted-foreground truncate">
                                  {input.rawInput}
                                </p>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {isScanning(domain) ? (
                    <Badge variant="secondary" className="gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Scanning
                    </Badge>
                  ) : getEffectiveScanStatus(domain) === "failed" ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive" className="cursor-help">
                            Failed
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">{domain.scans?.[0]?.error || "Unknown error"}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <Badge variant={domain.isActive ? "success" : "destructive"}>
                      {domain.isActive
                        ? `Active (${domain.statusCode})`
                        : "Inactive"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {(() => {
                    const { score, confidence } = getAiScore(domain.dataPoints);
                    if (score === null) {
                      return <span className="text-muted-foreground text-xs">-</span>;
                    }
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2" data-interactive>
                              <span className={`font-bold text-sm ${getScoreTextColor(score)}`}>
                                {score}
                              </span>
                              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${getScoreBgColor(score)}`}
                                  style={{ width: `${score}%` }}
                                />
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <p>AI-generated likelihood: {score}/100</p>
                              <p className="text-muted-foreground">
                                Confidence: {confidence}%
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  {(() => {
                    const { overallScore, primaryRiskType, confidence, phishing, fraud, compliance, credit } = getRiskScore(domain.dataPoints);
                    if (overallScore === null) {
                      return <span className="text-muted-foreground text-xs">-</span>;
                    }
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2" data-interactive>
                              <span className={`font-bold text-sm ${getScoreTextColor(overallScore)}`}>
                                {overallScore}
                              </span>
                              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${getScoreBgColor(overallScore)}`}
                                  style={{ width: `${overallScore}%` }}
                                />
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <p className="font-medium">Risk Assessment: {overallScore}/100</p>
                              <p className="text-muted-foreground">Primary: {primaryRiskType} ({confidence})</p>
                              <div className="pt-1 border-t border-border/50 space-y-0.5">
                                <p>Phishing: {phishing}</p>
                                <p>Fraud: {fraud}</p>
                                <p>Compliance: {compliance}</p>
                                <p>Credit: {credit}</p>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {domain.lastCheckedAt
                    ? formatDistanceToNow(new Date(domain.lastCheckedAt), {
                        addSuffix: true,
                      })
                    : "Never"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDistanceToNow(new Date(domain.createdAt), {
                    addSuffix: true,
                  })}
                </TableCell>
                <TableCell className="text-right" data-interactive>
                  <TooltipProvider>
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => handleView(e, domain.id)}
                            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>View details</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => handleRescan(e, domain.id)}
                            disabled={rescanning === domain.id}
                            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          >
                            {rescanning === domain.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
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
                            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            {deleting === domain.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
