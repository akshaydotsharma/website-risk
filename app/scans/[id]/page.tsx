import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DataPointKey } from "@/lib/constants";
import { getScoreTextColor, getScoreBgColor, getScoreBgColorSubtle, getScoreBorderLeftColor, getRiskLabel, getAiLikelihoodLabel, safeJsonParse } from "@/lib/utils";
import { format } from "date-fns";
import { ExternalLink, Globe, ChevronLeft, Bot, AlertTriangle, ShoppingCart, Calendar, Info } from "lucide-react";
import Link from "next/link";
import { ScoreRing } from "@/components/score-ring";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { RescanButton } from "./rescan-button";
import { HomepageSkuCountClient } from "./homepage-sku-count-client";
import { ScanStatusBadge } from "./scan-status-badge";
import { InvestigationNotes } from "./investigation-notes";
import { ScanDetailTabs } from "./scan-detail-tabs";
import type { TabData } from "./scan-detail-tabs";
import { SimilarityCard } from "./similarity-card";
import { ScanStatusRefresher } from "./scan-status-refresher";

export const dynamic = "force-dynamic";

// This page can receive either a domain ID (hash) or a scan ID
async function getDomainData(id: string) {
  // First try to find as domain ID
  let domain = await prisma.domain.findUnique({
    where: { id },
    include: {
      dataPoints: true,
      scans: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          dataPoints: true,
        },
      },
      investigationNotes: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  // If not found as domain, try to find the scan and get its domain
  if (!domain) {
    const scan = await prisma.websiteScan.findUnique({
      where: { id },
      include: { domain: true },
    });

    if (scan) {
      domain = await prisma.domain.findUnique({
        where: { id: scan.domainId },
        include: {
          dataPoints: true,
          scans: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              dataPoints: true,
              crawlFetchLogs: {
                orderBy: { createdAt: "asc" },
                take: 100,
              },
              signalLogs: {
                orderBy: { createdAt: "asc" },
                take: 100,
              },
            },
          },
          investigationNotes: {
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }
  }

  return domain;
}

export default async function ScanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = await getDomainData(id);

  if (!domain) {
    notFound();
  }

  const latestScan = domain.scans[0];

  // Load crawl/signal logs only for the latest scan (not all 10)
  const [crawlFetchLogs, signalLogs] = latestScan
    ? await Promise.all([
        prisma.crawlFetchLog.findMany({
          where: { scanId: latestScan.id },
          orderBy: { createdAt: "asc" },
          take: 100,
        }),
        prisma.signalLog.findMany({
          where: { scanId: latestScan.id },
          orderBy: { createdAt: "asc" },
          take: 100,
        }),
      ])
    : [[], []];

  // Pre-parse data points for the client component
  const aiDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.AI_LIKELIHOOD);
  const riskDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.RISK_ASSESSMENT);
  const contactDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.CONTACT_DETAILS);
  const signalsDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.DOMAIN_INTEL_SIGNALS);
  const aboutPageDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.ABOUT_PAGE);

  // Fetch counts for tab badges
  const [skuCount, screenshotCount] = await Promise.all([
    latestScan ? prisma.homepageSku.count({ where: { scanId: latestScan.id } }) : Promise.resolve(0),
    prisma.screenshot.count({ where: { domainId: domain.id } }),
  ]);

  const tabData: TabData = {
    domainId: domain.id,
    latestScanStatus: latestScan?.status ?? null,
    skuCount,
    screenshotCount,
    ai: aiDataPoint
      ? {
          data: safeJsonParse<any>(aiDataPoint.value, null),
          rawOpenAIResponse: safeJsonParse<any>(aiDataPoint.rawOpenAIResponse, {}),
        }
      : null,
    risk: riskDataPoint
      ? { data: safeJsonParse<any>(riskDataPoint.value, null) }
      : null,
    contact: contactDataPoint
      ? {
          data: safeJsonParse<any>(contactDataPoint.value, null),
          sources: safeJsonParse<any>(contactDataPoint.sources, []),
        }
      : null,
    aboutPage: aboutPageDataPoint ? safeJsonParse<any>(aboutPageDataPoint.value, null) : null,
    signals: signalsDataPoint ? safeJsonParse<any>(signalsDataPoint.value, null) : null,
    dataPoints: domain.dataPoints.map((dp: any) => ({
      id: dp.id,
      key: dp.key,
      label: dp.label,
      value: safeJsonParse<any>(dp.value, {}),
      sources: safeJsonParse<any>(dp.sources, []),
      rawOpenAIResponse: safeJsonParse<any>(dp.rawOpenAIResponse, {}),
    })),
    crawlFetchLogs: crawlFetchLogs.map((log: any) => ({
      id: log.id,
      url: log.url,
      statusCode: log.statusCode,
      errorMessage: log.errorMessage,
      source: log.source,
      fetchDurationMs: log.fetchDurationMs,
      robotsAllowed: log.robotsAllowed,
    })),
    signalLogs: signalLogs.map((log: any) => ({
      id: log.id,
      category: log.category,
      name: log.name,
      valueType: log.valueType,
      valueBoolean: log.valueBoolean,
      valueNumber: log.valueNumber,
      valueString: log.valueString,
      severity: log.severity,
    })),
    scans: domain.scans.map((scan: any) => ({
      id: scan.id,
      isActive: scan.isActive,
      statusCode: scan.statusCode,
      checkedAt: scan.checkedAt.toISOString(),
      dataPoints: scan.dataPoints.map((dp: any) => ({ id: dp.id })),
    })),
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <ScanStatusRefresher domainId={domain.id} initialScanStatus={latestScan?.status ?? null} />
      {/* Sticky Report Header */}
      <div className="sticky top-16 z-20 px-4 sm:px-6 py-4 bg-[hsl(var(--surface-elevated))]/85 backdrop-blur-xl border border-border/60 rounded-xl shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/scans"
              className="text-muted-foreground hover:text-foreground transition-colors duration-150 p-1 rounded-md hover:bg-muted"
              aria-label="Back to scan history"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <a
                href={`https://${domain.normalizedUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-semibold text-link hover:underline flex items-center gap-2"
              >
                {domain.normalizedUrl}
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
          <RescanButton
            scanId={domain.id}
            domainId={domain.id}
            isManuallyRisky={domain.isManuallyRisky}
            initialScanStatus={latestScan?.status ?? null}
            initialScanCreatedAt={latestScan?.createdAt?.toISOString() ?? null}
          />
        </div>
      </div>

      {/* Summary Card -- redesigned with prominent score ring */}
      <SummaryCard domain={domain} latestScan={latestScan} />

      {/* Tabbed Content */}
      <ScanDetailTabs data={tabData} />

      {/* Content Similarity */}
      <Suspense fallback={<SimilarityCardSkeleton />}>
        <SimilarityCard domainId={domain.id} domainUrl={domain.normalizedUrl} />
      </Suspense>

      {/* Investigation Notes - always visible below tabs */}
      <InvestigationNotes
        domainId={domain.id}
        initialNotes={domain.investigationNotes}
      />
    </div>
  );
}

// =============================================================================
// Summary Card Component -- Redesigned with focal score ring
// =============================================================================

function SummaryCard({
  domain,
  latestScan,
}: {
  domain: any;
  latestScan: any;
}) {
  const riskDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.RISK_ASSESSMENT);
  const aiDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.AI_LIKELIHOOD);
  const signalsDataPoint = domain.dataPoints.find((dp: any) => dp.key === DataPointKey.DOMAIN_INTEL_SIGNALS);

  const riskData = riskDataPoint ? safeJsonParse<any>(riskDataPoint.value, null) : null;
  const riskScore = riskData?.overall_risk_score ?? null;
  const primaryRiskType = riskData?.primary_risk_type ?? null;
  const riskTypeScores = riskData?.risk_type_scores ?? {};
  const aiScore = aiDataPoint ? safeJsonParse<any>(aiDataPoint.value, {}).ai_generated_score ?? null : null;

  let domainAgeYears: number | null = null;
  let domainAgeDays: number | null = null;
  let registrationDate: string | null = null;
  let rdapAvailable = false;

  if (signalsDataPoint) {
    const signals = safeJsonParse<any>(signalsDataPoint.value, {});
    if (signals.rdap) {
      domainAgeYears = signals.rdap.domain_age_years;
      domainAgeDays = signals.rdap.domain_age_days;
      registrationDate = signals.rdap.registration_date;
      rdapAvailable = signals.rdap.rdap_available;
    }
  }

  const formatRegistrationDate = () => {
    if (!registrationDate) return null;
    const date = new Date(registrationDate);
    return format(date, "MMM d, yyyy");
  };

  const formatDomainAge = () => {
    if (domainAgeDays === null || domainAgeYears === null) return null;
    const totalDays = domainAgeDays;
    if (totalDays < 30) {
      return [{ num: totalDays, label: totalDays === 1 ? "Day" : "Days" }];
    }
    const totalMonths = Math.floor(totalDays / 30.44);
    if (totalMonths < 12) {
      const remainingDays = Math.floor(totalDays - totalMonths * 30.44);
      const parts = [{ num: totalMonths, label: totalMonths === 1 ? "Month" : "Months" }];
      if (remainingDays > 0) parts.push({ num: remainingDays, label: remainingDays === 1 ? "Day" : "Days" });
      return parts;
    }
    const years = Math.floor(domainAgeYears);
    const remainingMonths = Math.floor((totalDays - years * 365.25) / 30.44);
    const parts = [{ num: years, label: years === 1 ? "Year" : "Years" }];
    if (remainingMonths > 0) parts.push({ num: remainingMonths, label: remainingMonths === 1 ? "Month" : "Months" });
    return parts;
  };

  const getDomainAgeBgColor = () => {
    if (domainAgeDays !== null && domainAgeDays < 90) return "bg-destructive/10";
    if (domainAgeYears !== null && domainAgeYears < 1) return "bg-orange-500/10";
    if (domainAgeYears !== null && domainAgeYears >= 5) return "bg-success/10";
    return "bg-muted/50";
  };

  const getDomainAgeBorderColor = () => {
    if (domainAgeDays !== null && domainAgeDays < 90) return "border-l-destructive";
    if (domainAgeYears !== null && domainAgeYears < 1) return "border-l-orange-500";
    if (domainAgeYears !== null && domainAgeYears >= 5) return "border-l-success";
    return "border-l-transparent";
  };

  const getDomainAgeTextColor = () => {
    if (domainAgeDays !== null && domainAgeDays < 90) return "text-destructive";
    if (domainAgeYears !== null && domainAgeYears < 1) return "text-orange-500";
    if (domainAgeYears !== null && domainAgeYears >= 5) return "text-success";
    return "text-foreground";
  };

  // Format risk type label
  const formatRiskType = (type: string | null) => {
    if (!type) return "Unknown";
    if (type === "shell_company") return "Shell Company";
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <div>
    <div className="relative bg-card border rounded-xl overflow-hidden">
      {/* Last scanned — inside card */}
      <span className="absolute top-4 right-5 text-[11px] text-muted-foreground/70">
        Last scanned {domain.lastCheckedAt ? format(new Date(domain.lastCheckedAt), "MMM d, h:mm a") : "Never"}
      </span>
      {/* Top section: Score ring + risk signal pills */}
      <div className="p-6 flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
        {/* Focal score ring */}
        <div className="shrink-0">
          {riskScore !== null ? (
            <ScoreRing
              score={riskScore}
              size={110}
              strokeWidth={8}
              label="Risk"
            />
          ) : (
            <div className="w-[110px] h-[110px] rounded-full bg-muted/30 flex items-center justify-center">
              <span className="text-2xl font-bold text-muted-foreground">&mdash;</span>
            </div>
          )}
        </div>

        {/* Risk details and pills */}
        <div className="flex-1 space-y-3 text-center sm:text-left">
          {/* Risk level headline + Active badge */}
          {riskScore !== null && (
            <div>
              <div className="flex items-center justify-between">
                <h2 className={`text-xl font-bold ${getScoreTextColor(riskScore)}`}>
                  {getRiskLabel(riskScore)} Risk
                </h2>
                <ScanStatusBadge
                  domainId={domain.id}
                  initialIsActive={domain.isActive}
                  initialStatusCode={domain.statusCode}
                  initialScanStatus={latestScan?.status ?? null}
                  initialScanCreatedAt={latestScan?.createdAt?.toISOString() ?? null}
                />
              </div>
            </div>
          )}

          {/* Signal pills row */}
          <div className="flex flex-wrap gap-1.5 justify-center sm:justify-start">
            {riskTypeScores.phishing != null && (
              <span className={`signal-pill px-3 hover:scale-[1.03] transition-transform duration-100 ${riskTypeScores.phishing > 60 ? "signal-pill-risk" : riskTypeScores.phishing > 30 ? "signal-pill-warning" : "signal-pill-safe"}`}>
                Phishing: <span className="font-semibold">{riskTypeScores.phishing}</span>
              </span>
            )}
            {riskTypeScores.shell_company != null && (
              <span className={`signal-pill px-3 hover:scale-[1.03] transition-transform duration-100 ${riskTypeScores.shell_company > 60 ? "signal-pill-risk" : riskTypeScores.shell_company > 30 ? "signal-pill-warning" : "signal-pill-safe"}`}>
                Shell: <span className="font-semibold">{riskTypeScores.shell_company}</span>
              </span>
            )}
            {riskTypeScores.compliance != null && (
              <span className={`signal-pill px-3 hover:scale-[1.03] transition-transform duration-100 ${riskTypeScores.compliance > 60 ? "signal-pill-risk" : riskTypeScores.compliance > 30 ? "signal-pill-warning" : "signal-pill-safe"}`}>
                Compliance: <span className="font-semibold">{riskTypeScores.compliance}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom stat tiles */}
      <div className="grid grid-cols-3 gap-3 px-4 pb-4 pt-1">
        {/* AI Score stat */}
        <div className={`rounded-xl p-4 min-h-[88px] bg-[hsl(var(--surface-elevated))] shadow-[0_1px_2px_0_hsl(var(--foreground)/0.02)] border-l-4 flex flex-col justify-between ${aiScore !== null ? getScoreBorderLeftColor(aiScore) : "border-l-transparent"}`}>
          <p className="text-label mb-1 flex items-center gap-1">
            AI Score
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                Likelihood the site content is AI-generated, scored 0–100 based on language patterns, repetition, and stylistic signals.
              </TooltipContent>
            </Tooltip>
          </p>
          {aiScore !== null ? (
            <div className="flex items-baseline gap-2">
              <p className={`text-2xl font-bold tabular-nums ${getScoreTextColor(aiScore)}`}>{aiScore}<span className="text-sm font-medium text-muted-foreground">/100</span></p>
            </div>
          ) : (
            <p className="text-2xl font-bold text-muted-foreground">&mdash;</p>
          )}
        </div>

        {/* Domain Age stat */}
        <div className={`rounded-xl p-4 min-h-[88px] bg-[hsl(var(--surface-elevated))] shadow-[0_1px_2px_0_hsl(var(--foreground)/0.02)] border-l-4 flex flex-col justify-between ${rdapAvailable ? getDomainAgeBorderColor() : "border-l-transparent"}`}>
          <p className="text-label mb-1 flex items-center gap-1">
            Domain Age
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {registrationDate ? `Registered ${formatRegistrationDate()}` : "Registration date unknown"}
              </TooltipContent>
            </Tooltip>
          </p>
          {rdapAvailable && domainAgeYears !== null && formatDomainAge() ? (
            <p className={`tabular-nums ${getDomainAgeTextColor()}`}>
              {formatDomainAge()!.map((part, i) => (
                <span key={i}>{i > 0 && " "}<span className="text-2xl font-bold">{part.num}</span>{" "}<span className="text-sm font-medium">{part.label}</span></span>
              ))}
            </p>
          ) : (
            <p className="text-2xl font-bold text-muted-foreground" title={!rdapAvailable ? "RDAP lookup not available for this TLD" : "No data"}>&mdash;</p>
          )}
        </div>

        {/* SKU Count stat */}
        <div className="rounded-xl p-4 min-h-[88px] bg-[hsl(var(--surface-elevated))] shadow-[0_1px_2px_0_hsl(var(--foreground)/0.02)] border-l-4 border-l-transparent flex flex-col justify-between">
          <p className="text-label mb-1">Detected SKUs</p>
          <HomepageSkuCountClient domainId={domain.id} initialScanStatus={latestScan?.status} />
        </div>
      </div>
    </div>
    </div>
  );
}

// =============================================================================
// Skeleton for SimilarityCard while it streams in via Suspense
// =============================================================================

function SimilarityCardSkeleton() {
  return (
    <div className="bg-card border rounded-xl overflow-hidden animate-pulse">
      {/* Tab bar skeleton */}
      <div className="border-b px-4 pt-4 pb-0">
        <div className="flex gap-4">
          <div className="h-4 w-28 bg-muted rounded mb-3" />
          <div className="h-4 w-24 bg-muted/60 rounded mb-3" />
          <div className="h-4 w-20 bg-muted/40 rounded mb-3" />
        </div>
      </div>
      {/* Content area skeleton */}
      <div className="p-6 space-y-4">
        {/* Summary stats row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="h-3 w-20 bg-muted/60 rounded" />
            <div className="h-7 w-12 bg-muted rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 bg-muted/60 rounded" />
            <div className="h-7 w-16 bg-muted rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-16 bg-muted/60 rounded" />
            <div className="h-7 w-10 bg-muted rounded" />
          </div>
        </div>
        {/* List items skeleton */}
        <div className="space-y-3 pt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-t first:border-t-0">
              <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-3 w-32 bg-muted/60 rounded" />
              </div>
              <div className="h-6 w-16 bg-muted rounded-full shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
