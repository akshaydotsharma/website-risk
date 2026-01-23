"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardDivider } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  ExternalLink,
  FileText,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  Shield,
  Scale,
  RotateCcw,
  ChevronDown,
} from "lucide-react";

// Inline expandable details component
function PolicyDetails({ link }: { link: PolicyLink }) {
  const [isOpen, setIsOpen] = useState(false);

  const hasDetails = link.verificationNotes || link.titleSnippet || link.contentType || link.lastCheckedAt;
  if (!hasDetails) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        {isOpen ? "Hide details" : "Show details"}
      </button>
      {isOpen && (
        <div className="mt-2 pl-4 border-l-2 border-border/50 space-y-1 text-xs text-muted-foreground">
          {link.titleSnippet && (
            <div>
              <span className="font-medium">Title:</span>{" "}
              <span className="text-foreground">{link.titleSnippet}</span>
            </div>
          )}
          {link.verificationNotes && (
            <div>
              <span className="font-medium">Verification:</span>{" "}
              <span className="text-foreground">{link.verificationNotes}</span>
            </div>
          )}
          {link.contentType && (
            <div>
              <span className="font-medium">Content type:</span>{" "}
              <span className="font-mono text-foreground">{link.contentType}</span>
            </div>
          )}
          {link.lastCheckedAt && (
            <div>
              <span className="font-medium">Checked:</span>{" "}
              <span className="text-foreground">{format(new Date(link.lastCheckedAt), "PPp")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PolicyLink {
  id: string;
  scanId: string;
  policyType: "privacy" | "refund" | "terms";
  url: string;
  discoveredOn: string;
  discoveryMethod: string;
  verifiedOk: boolean;
  statusCode: number | null;
  contentType: string | null;
  verificationNotes: string | null;
  titleSnippet: string | null;
  lastCheckedAt: string;
  createdAt: string;
}

interface PolicyLinksSummary {
  privacy: { url: string | null; verifiedOk: boolean; method: string | null };
  refund: { url: string | null; verifiedOk: boolean; method: string | null };
  terms: { url: string | null; verifiedOk: boolean; method: string | null };
  attempts: {
    homepage_html: boolean;
    common_paths: boolean;
    chromium_render: boolean;
    keyword_proximity: boolean;
  };
  notes: string | null;
}

interface PolicyLinksResponse {
  policyLinks: PolicyLink[];
  summary: PolicyLinksSummary | null;
}

interface PolicyLinksCardProps {
  domainId: string;
  initialScanStatus?: string | null;
}

const POLICY_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; description: string }
> = {
  privacy: {
    label: "Privacy Policy",
    icon: <Shield className="h-4 w-4" />,
    description: "Data handling and privacy practices",
  },
  refund: {
    label: "Refund / Returns",
    icon: <RotateCcw className="h-4 w-4" />,
    description: "Return and refund policies",
  },
  terms: {
    label: "Terms of Service",
    icon: <Scale className="h-4 w-4" />,
    description: "Legal terms and conditions",
  },
};

const METHOD_LABELS: Record<string, string> = {
  homepage_html: "Found on homepage",
  common_paths: "Common path",
  chromium_render: "Browser rendered",
  keyword_proximity: "Keyword search",
};

export function PolicyLinksCard({ domainId, initialScanStatus }: PolicyLinksCardProps) {
  const [data, setData] = useState<PolicyLinksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState(initialScanStatus);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/scans/${domainId}/policy-links`);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const result: PolicyLinksResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll for data while scan is processing
  useEffect(() => {
    const isScanning = scanStatus === "pending" || scanStatus === "processing";
    if (!isScanning) return;

    const pollInterval = setInterval(async () => {
      // Check scan status
      try {
        const statusResponse = await fetch(`/api/scans/${domainId}/status`);
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setScanStatus(statusData.status);

          // If scan completed, fetch data one more time
          if (statusData.status === "completed" || statusData.status === "failed") {
            fetchData();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [domainId, scanStatus, fetchData]);

  const handleExtract = async () => {
    try {
      setExtracting(true);
      setError(null);

      const response = await fetch(`/api/scans/${domainId}/policy-links`, {
        method: "POST",
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || `Failed to extract: ${response.status}`);
      }

      // Refresh data after extraction
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExtracting(false);
    }
  };

  const getStatusBadge = (link: PolicyLink | null, summaryData?: { url: string | null; verifiedOk: boolean; method: string | null }) => {
    // Check both link (from PolicyLink table) and summaryData (from DomainDataPoint)
    // to determine the correct status
    const hasUrl = link?.url || summaryData?.url;
    const isVerified = link?.verifiedOk || summaryData?.verifiedOk;

    if (!hasUrl) {
      return (
        <Badge variant="secondary" className="text-xs">
          <XCircle className="h-3 w-3 mr-1" />
          Not found
        </Badge>
      );
    }

    if (isVerified) {
      return (
        <Badge variant="default" className="text-xs bg-success hover:bg-success/90">
          <CheckCircle className="h-3 w-3 mr-1" />
          Verified
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="text-xs text-caution border-caution/30">
        <AlertCircle className="h-3 w-3 mr-1" />
        Unverified
      </Badge>
    );
  };

  const getMethodBadge = (method: string | null) => {
    if (!method) return null;

    return (
      <Badge variant="outline" className="text-xs">
        {METHOD_LABELS[method] || method}
      </Badge>
    );
  };

  // Map policy links by type
  const linksByType: Record<string, PolicyLink | null> = {
    privacy: null,
    refund: null,
    terms: null,
  };

  if (data?.policyLinks) {
    for (const link of data.policyLinks) {
      linksByType[link.policyType] = link;
    }
  }

  // Determine if we have any data at all
  const hasAnyData = data?.policyLinks?.length || data?.summary;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Policy Links
            </CardTitle>
            <CardDescription>
              Privacy, refund, and terms pages extracted from the website
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExtract}
            disabled={extracting}
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {hasAnyData ? "Re-extract" : "Extract"}
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardDivider className="-mt-1" />

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!loading && !hasAnyData && (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No policy links extracted yet.</p>
            <p className="text-sm mt-1">
              Click &quot;Extract&quot; to scan for policy pages.
            </p>
          </div>
        )}

        {/* Policy Links List */}
        {hasAnyData && (
          <div className="space-y-3">
            {(["privacy", "refund", "terms"] as const).map((policyType) => {
              const link = linksByType[policyType];
              const config = POLICY_TYPE_CONFIG[policyType];
              const summaryData = data?.summary?.[policyType];

              return (
                <div
                  key={policyType}
                  className={`rounded-lg border p-4 ${
                    link?.verifiedOk
                      ? "bg-success/5 border-success/30"
                      : !link
                        ? "bg-muted/30 border-muted"
                        : "bg-caution/5 border-caution/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="mt-0.5 text-muted-foreground">
                        {config.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{config.label}</span>
                          {getStatusBadge(link, summaryData)}
                          {(link || summaryData?.method) && getMethodBadge(link?.discoveryMethod || summaryData?.method || null)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {config.description}
                        </p>
                        {link ? (
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-link hover:underline flex items-center gap-1 mt-2 truncate"
                            title={link.url}
                          >
                            {link.url}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        ) : summaryData?.url ? (
                          <a
                            href={summaryData.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-link hover:underline flex items-center gap-1 mt-2 truncate"
                            title={summaryData.url}
                          >
                            {summaryData.url}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-2">
                            No policy link found
                          </p>
                        )}
                        {/* Inline Expandable Details - aligned with link text */}
                        {link && <PolicyDetails link={link} />}
                      </div>
                    </div>
                    {link?.statusCode && (
                      <Badge
                        variant={
                          link.statusCode >= 200 && link.statusCode < 400
                            ? "outline"
                            : "destructive"
                        }
                        className="text-xs"
                      >
                        {link.statusCode}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Extraction Methods Summary */}
        {data?.summary?.attempts && (
          <div className="text-xs text-muted-foreground border-t pt-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span>Methods tried:</span>
              {data.summary.attempts.homepage_html && (
                <Badge variant="outline" className="text-xs">
                  Homepage HTML
                </Badge>
              )}
              {data.summary.attempts.common_paths && (
                <Badge variant="outline" className="text-xs">
                  Common paths
                </Badge>
              )}
              {data.summary.attempts.chromium_render && (
                <Badge variant="outline" className="text-xs">
                  Browser render
                </Badge>
              )}
              {data.summary.attempts.keyword_proximity && (
                <Badge variant="outline" className="text-xs">
                  Keyword proximity
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Bot Protection Warning */}
        {data?.summary?.notes?.includes("bot protection") && (
          <div className="bg-caution/10 border border-caution/20 rounded-lg p-3 text-sm text-caution flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Site uses bot protection</p>
              <p className="text-xs mt-1 opacity-80">
                This site has Cloudflare or similar bot protection. Browser rendering was attempted but the site may still be blocking automated access.
              </p>
            </div>
          </div>
        )}

        {/* Notes */}
        {data?.summary?.notes && !data.summary.notes.includes("bot protection") && (
          <div className="text-xs text-muted-foreground border-t pt-3 flex items-start gap-2">
            <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span>{data.summary.notes}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
