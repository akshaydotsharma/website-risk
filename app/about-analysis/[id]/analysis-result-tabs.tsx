"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, Suspense } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  BarChart3,
  AlertTriangle,
  Users,
  Globe,
  Fingerprint,
  Search,
  Copy,
  Link2,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Shield,
  ShieldAlert,
  Layers,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { getScoreTextColor, getScoreBgColorSubtle } from "@/lib/utils";
import {
  VW,
  VH,
  computeNodePositions,
} from "@/lib/aboutUsAnalysis/clusterGraphGeometry";

/** Maps domain URL → about page URL for linking. */
const AboutPageUrlContext = createContext<Map<string, string>>(new Map());

/** Maps domain URL → domainId for internal scan page linking. */
const DomainIdContext = createContext<Map<string, string>>(new Map());

/** Get the about page URL for a domain, falling back to /about. */
function useAboutPageUrl(domainUrl: string): string {
  const map = useContext(AboutPageUrlContext);
  return map.get(domainUrl) || `https://${domainUrl}/about`;
}

/** Get the domain ID for internal scan page linking. */
function useDomainId(domainUrl: string): string | undefined {
  const map = useContext(DomainIdContext);
  return map.get(domainUrl);
}

interface KeywordHit {
  keyword: string;
  count: number;
}

interface PageScoreData {
  pageType: string;
  label: string;
  score: number;
  sharedSentenceCount: number;
}

interface PairData {
  id: string;
  domainAId: string;
  domainBId: string;
  domainAUrl: string;
  domainBUrl: string;
  textScore: number;
  sharedSentences: string[];
  sharedSentenceCount: number;
  keywordHitsA: KeywordHit[];
  keywordHitsB: KeywordHit[];
  clusterId: number | null;
  flagged: boolean;
  flagReasons: string[];
  pageScores: PageScoreData[];
}

interface ClusterInfo {
  clusterId: number;
  members: { domainId: string; url: string }[];
  avgScore: number;
  maxScore: number;
  pairCount: number;
  confidence?: "high" | "moderate";
}

interface Summary {
  domainCount: number;
  pairCount: number;
  avgScore: number;
  maxScore: number;
  clusterCount: number;
  flaggedCount: number;
  clusters: ClusterInfo[];
  flags: { type: string; description: string; count: number }[];
  topPairs: { domainAUrl: string; domainBUrl: string; textScore: number }[];
}

interface DomainAboutText {
  domainId: string;
  url: string;
  aboutText: string;
  aboutPageUrl?: string | null;
  pageTexts?: { key: string; label: string; text: string }[];
}

const TAB_DEFS = [
  { key: "summary", label: "Summary" },
  { key: "clusters", label: "Clusters" },
  { key: "shared", label: "Content Similarity" },
  { key: "scam", label: "Uniqueness Check" },
];

/**
 * Blended similarity score: combines TF-IDF with shared sentence signal.
 * Raw TF-IDF undersells similarity when domains share many sentences,
 * so we boost by shared sentence count (same formula used for clustering).
 */
function blendedScore(textScore: number, sharedSentenceCount: number): number {
  const SENTENCE_BONUS = 2;
  const MAX_BONUS = 10;
  const bonus = Math.min(sharedSentenceCount * SENTENCE_BONUS, MAX_BONUS);
  return Math.min(100, textScore + bonus);
}

/** Stat card label with a visible info icon and tooltip on hover. */
function StatLabel({ label, tooltip, icon }: { label: string; tooltip: string; icon?: React.ReactNode }) {
  return (
    <div className="stat-card-label">
      {icon}
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="ml-1 inline-flex items-center">
            <Info className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed font-normal normal-case tracking-normal">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Icon link with styled tooltip on hover. */
function IconLink({
  href,
  label,
  icon,
  onClick,
  className = "",
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className={`p-0.5 rounded text-teal-600/60 hover:text-teal-700 dark:text-teal-400/60 dark:hover:text-teal-300 transition-colors ${className}`}
          aria-label={label}
        >
          {icon}
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-md ${getScoreBgColorSubtle(score)} ${getScoreTextColor(score)}`}
    >
      {score}
    </span>
  );
}

/** Compact row for a flagged domain in the Uniqueness Check summary. */
function FlaggedDomainRow({ match }: { match: { url: string; matchCount: number } }) {
  const aboutUrl = useAboutPageUrl(match.url);
  const domainId = useDomainId(match.url);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/30 transition-colors duration-100">
      <Globe className="h-3.5 w-3.5 text-teal-600/50 dark:text-teal-400/50 flex-shrink-0" aria-hidden="true" />
      <span className="font-medium text-teal-700 dark:text-teal-300 flex-1 min-w-0 truncate">
        {match.url}
      </span>
      <Badge variant="secondary" className="text-[10px] flex-shrink-0 tabular-nums">
        {match.matchCount} {match.matchCount === 1 ? "match" : "matches"}
      </Badge>
      <div className="flex items-center gap-1 flex-shrink-0">
        <IconLink href={aboutUrl} label="Open link" icon={<ExternalLink className="h-3.5 w-3.5" />} />
        {domainId && (
          <IconLink href={`/scans/${domainId}`} label="Open website scan" icon={<ShieldAlert className="h-3.5 w-3.5" />} />
        )}
      </div>
    </div>
  );
}

/** Collapsible "Most widespread" sentences for the Summary tab. */
function SummarySharedSentencesExpander({
  topSentences,
  totalDomains,
  totalCount,
}: {
  topSentences: DuplicatedSentence[];
  totalDomains: number;
  totalCount: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/30"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Most widespread
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {topSentences.length} shown
        </Badge>
      </button>
      {expanded && (
        <div className="border-t p-3 space-y-2">
          {topSentences.map((ds, i) => {
            const tier = getSeverityTier(ds.foundIn.length, totalDomains);
            return (
              <div
                key={i}
                className={`rounded-lg border p-3 ${tier.borderColor} ${tier.bgColor}`}
              >
                <div className="mb-2">
                  <p className="text-sm leading-relaxed line-clamp-2">
                    &ldquo;{ds.sentence}&rdquo;
                  </p>
                </div>
                <Badge variant={tier.badgeVariant}>{tier.label}</Badge>
              </div>
            );
          })}
          {totalCount > 5 && (
            <p className="text-xs text-muted-foreground pt-1">
              + {totalCount - 5} more. See the Shared Sentences tab for full details.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Page Type Matches Summary (used in Summary tab)
// =============================================================================

const PAGE_TYPE_ORDER = [
  "homepage_text", "about_page", "contact_page",
  "privacy_page", "refund_page", "terms_page",
];

const PAGE_TYPE_LABELS: Record<string, string> = {
  homepage_text: "Homepage",
  about_page: "About Us",
  contact_page: "Contact Us",
  privacy_page: "Privacy Policy",
  refund_page: "Refund Policy",
  terms_page: "Terms of Service",
};

function PageTypeMatchesSummary({ pairs }: { pairs: PairData[] }) {
  // Count pairs with matches per page type
  const pageTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pair of pairs) {
      if (!pair.pageScores) continue;
      for (const ps of pair.pageScores) {
        if (ps.score >= 60) {
          counts.set(ps.pageType, (counts.get(ps.pageType) || 0) + 1);
        }
      }
    }
    return counts;
  }, [pairs]);

  const hasAnyMatches = pageTypeCounts.size > 0;
  if (!hasAnyMatches) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          Page Type Matches
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Number of domain pairs with matching content per page type (score &ge; 60).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PAGE_TYPE_ORDER.map((key) => {
            const count = pageTypeCounts.get(key) || 0;
            if (count === 0) return null;
            return (
              <div
                key={key}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 border"
              >
                <span className="text-sm font-medium">{PAGE_TYPE_LABELS[key]}</span>
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {count} {count === 1 ? "pair" : "pairs"}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Summary Tab
// =============================================================================

function SummaryTab({
  summary,
  pairs,
  domainAboutTexts,
  scamMatches,
  duplicatedSentences,
}: {
  summary: Summary;
  pairs: PairData[];
  domainAboutTexts: DomainAboutText[];
  scamMatches: { flagged: ScamMatch[]; clean: string[] };
  duplicatedSentences: DuplicatedSentence[];
}) {
  // Compute cluster membership: which domains are clustered vs unclustered
  const clusteredUrls = new Set<string>();
  for (const cluster of summary.clusters) {
    for (const m of cluster.members) {
      clusteredUrls.add(m.url);
    }
  }
  const allDomainUrls = domainAboutTexts.map((d) => d.url);
  const unclusteredUrls = allDomainUrls.filter((u) => !clusteredUrls.has(u));

  // Shared sentences: sort by most widespread (most domains), take top 5
  const topSharedSentences = [...duplicatedSentences]
    .sort((a, b) => b.foundIn.length - a.foundIn.length)
    .slice(0, 5);

  // Count unique domains involved in any shared sentence
  const domainsWithSharedSentences = new Set<string>();
  for (const ds of duplicatedSentences) {
    for (const url of ds.foundIn) {
      domainsWithSharedSentences.add(url);
    }
  }

  const totalDomains = summary.domainCount;

  return (
    <div className="space-y-6">
      {/* ---- Stats strip ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="stat-card">
          <StatLabel label="Domains" tooltip="Total number of domains included in this analysis" />
          <p className="stat-card-value">{summary.domainCount}</p>
        </div>
        <div className="stat-card">
          <StatLabel label="Avg Score" tooltip="Average pairwise text similarity score (0-100) across all domain pairs" />
          <p className={`stat-card-value ${getScoreTextColor(summary.avgScore)}`}>
            {summary.avgScore}
          </p>
        </div>
        <div className="stat-card">
          <StatLabel label="Max Score" tooltip="Highest pairwise similarity score between any two domains. 99 means two sites have nearly identical content." />
          <p className={`stat-card-value ${getScoreTextColor(summary.maxScore)}`}>
            {summary.maxScore}
          </p>
        </div>
        <div className="stat-card">
          <StatLabel label="Clusters" tooltip="Groups of domains with similarity scores above the clustering threshold (70)" />
          <p className="stat-card-value">{summary.clusterCount}</p>
        </div>
      </div>

      {/* ---- Clusters Insight ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Clusters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary.clusters.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {clusteredUrls.size} of {totalDomains}
                </span>{" "}
                domains belong to a cluster.
                {unclusteredUrls.length > 0 && (
                  <>
                    {" "}
                    <span className="font-semibold text-foreground">
                      {unclusteredUrls.length}
                    </span>{" "}
                    {unclusteredUrls.length === 1 ? "domain is" : "domains are"} unclustered.
                  </>
                )}
              </p>

              {/* Clustered domains grouped by cluster */}
              <div className="space-y-3">
                {summary.clusters.map((cluster) => {
                  const cPairs = pairs.filter((p) => p.clusterId === cluster.clusterId);
                  const cScores = cPairs.map((p) => blendedScore(p.textScore, p.sharedSentenceCount));
                  const cAvg = cScores.length > 0
                    ? Math.round(cScores.reduce((s, v) => s + v, 0) / cScores.length)
                    : 0;
                  return (
                    <div
                      key={cluster.clusterId}
                      className="rounded-lg border border-border/60 bg-muted/20 p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Cluster {cluster.clusterId + 1}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Avg <ScoreBadge score={cAvg} />
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cluster.members.map((m) => (
                          <DomainLink key={m.domainId} url={m.url} tint="primary" />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Unclustered domains */}
              {unclusteredUrls.length > 0 && (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
                    Unclustered
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {unclusteredUrls.map((url) => (
                      <DomainLink key={url} url={url} />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No clusters were formed. No domains share enough textual similarity to be grouped together.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Shared Sentences Insight ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Copy className="h-4 w-4 text-primary" />
            Shared Sentences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {duplicatedSentences.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {duplicatedSentences.length}
                </span>{" "}
                shared {duplicatedSentences.length === 1 ? "sentence" : "sentences"} found
                across{" "}
                <span className="font-semibold text-foreground">
                  {domainsWithSharedSentences.size}
                </span>{" "}
                {domainsWithSharedSentences.size === 1 ? "domain" : "domains"}.
              </p>

              {/* Top shared sentences — collapsible */}
              <SummarySharedSentencesExpander
                topSentences={topSharedSentences}
                totalDomains={totalDomains}
                totalCount={duplicatedSentences.length}
              />
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              No shared sentences detected across domains.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Uniqueness Check Insight ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-primary" />
            Uniqueness Check
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scamMatches.flagged.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-orange-600 dark:text-orange-400">
                  {scamMatches.flagged.length}
                </span>{" "}
                {scamMatches.flagged.length === 1 ? "domain" : "domains"} flagged
                for uniqueness-related language in their About page.
              </p>
              <div className="rounded-lg border divide-y max-h-[340px] overflow-y-auto">
                {[...scamMatches.flagged]
                  .sort((a, b) => b.matchCount - a.matchCount)
                  .map((m) => (
                    <FlaggedDomainRow key={m.url} match={m} />
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">
                See the Uniqueness Check tab for excerpts and details.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              No domains flagged. None of the About pages contain uniqueness-related language.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Page Type Matches ---- */}
      <PageTypeMatchesSummary pairs={pairs} />

    </div>
  );
}

// =============================================================================
// Clusters Tab — Network Graph Visualization
// =============================================================================

type MemberStat = {
  domainId: string;
  url: string;
  connectionCount: number;
  avgScore: number;
  totalShared: number;
};

function computeMemberStats(
  members: ClusterInfo["members"],
  clusterPairs: PairData[]
): MemberStat[] {
  return members.map((m) => {
    const relevantPairs = clusterPairs.filter(
      (p) => p.domainAUrl === m.url || p.domainBUrl === m.url
    );
    // Use the best page-level score across all pairs for this node
    let bestScore = 0;
    for (const p of relevantPairs) {
      if (p.pageScores && p.pageScores.length > 0) {
        for (const ps of p.pageScores) {
          bestScore = Math.max(bestScore, ps.score);
        }
      } else {
        bestScore = Math.max(bestScore, p.textScore);
      }
    }
    const avgScore = bestScore;
    // Count unique shared sentences (dedupe by fingerprint across all pairs)
    const uniqueSentences = new Set<string>();
    for (const p of relevantPairs) {
      for (const s of p.sharedSentences) {
        uniqueSentences.add(
          s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim()
        );
      }
    }
    const totalShared = uniqueSentences.size;
    return {
      ...m,
      connectionCount: relevantPairs.length,
      avgScore,
      totalShared,
    };
  });
}

function scoreToColor(score: number): string {
  if (score >= 85) return "hsl(0, 72%, 51%)";
  if (score >= 70) return "hsl(25, 95%, 53%)";
  if (score >= 40) return "hsl(45, 93%, 47%)";
  return "hsl(142, 71%, 45%)";
}

function GraphNodeCard({ node, isSelected = false }: { node: { domainId: string; url: string; avgScore: number; totalShared: number }; isSelected?: boolean }) {
  const aboutUrl = useAboutPageUrl(node.url);
  const domainId = useDomainId(node.url);
  return (
    <div className={`bg-background border rounded-lg shadow-sm px-3 py-2.5 text-center min-w-[130px] max-w-[180px] cursor-pointer transition-all duration-200 hover:shadow-md ${isSelected ? "ring-2 ring-primary shadow-md" : ""}`}>
      <div className="flex items-center justify-center gap-1.5 mb-1.5">
        <Globe className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 flex-shrink-0" aria-hidden="true" />
        <span className="text-xs font-semibold truncate">{node.url}</span>
        <IconLink href={aboutUrl} label="Open link" icon={<ExternalLink className="h-3 w-3" />} />
        {domainId && (
          <IconLink href={`/scans/${domainId}`} label="Open website scan" icon={<ShieldAlert className="h-3 w-3" />} />
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <ScoreBadge score={node.avgScore} />
        {node.totalShared > 0 && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {node.totalShared} shared {node.totalShared === 1 ? "sentence" : "sentences"}
          </span>
        )}
      </div>
    </div>
  );
}

function ClusterGraph({
  cluster,
  memberStats,
  clusterPairs,
  computedAvg,
}: {
  cluster: ClusterInfo;
  memberStats: MemberStat[];
  clusterPairs: PairData[];
  computedAvg: number;
}) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const N = memberStats.length;

  // Sort by avgScore descending, then compute radial positions
  const sorted = [...memberStats].sort((a, b) => b.avgScore - a.avgScore);
  const positions = computeNodePositions(N);
  const nodes = sorted.map((m, i) => ({
    ...m,
    x: positions[i].x,
    y: positions[i].y,
  }));

  // Build node position lookup by URL for pair-based edges
  const nodeByUrl = new Map(nodes.map((n) => [n.url, n]));

  // Build edges from actual pairs (only pairs with score >= 40 to reduce clutter)
  const edges = clusterPairs
    .filter((p) => blendedScore(p.textScore, p.sharedSentenceCount) >= 40)
    .map((p) => {
      const nA = nodeByUrl.get(p.domainAUrl);
      const nB = nodeByUrl.get(p.domainBUrl);
      if (!nA || !nB) return null;
      const score = blendedScore(p.textScore, p.sharedSentenceCount);

      // Find the top-scoring page type driving this pair's similarity.
      // On tie, prefer the one with more shared sentences (more substance).
      let topPage: { label: string; score: number } | null = null;
      if (p.pageScores && p.pageScores.length > 0) {
        const sorted = [...p.pageScores].sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.sharedSentenceCount - a.sharedSentenceCount;
        });
        topPage = { label: sorted[0].label, score: sorted[0].score };
      }

      return { nA, nB, score, sharedCount: p.sharedSentenceCount, topPage };
    })
    .filter(Boolean) as { nA: typeof nodes[0]; nB: typeof nodes[0]; score: number; sharedCount: number; topPage: { label: string; score: number } | null }[];

  // Determine which nodes/edges are highlighted based on selection
  const connectedUrls = useMemo(() => {
    if (!selectedUrl) return null;
    const urls = new Set<string>([selectedUrl]);
    for (const e of edges) {
      if (e.nA.url === selectedUrl) urls.add(e.nB.url);
      if (e.nB.url === selectedUrl) urls.add(e.nA.url);
    }
    return urls;
  }, [selectedUrl, edges]);

  const isEdgeHighlighted = (edge: typeof edges[0]) => {
    if (!selectedUrl) return true;
    return edge.nA.url === selectedUrl || edge.nB.url === selectedUrl;
  };

  const isNodeHighlighted = (url: string) => {
    if (!connectedUrls) return true;
    return connectedUrls.has(url);
  };

  const NODE_INSET = 70;
  const toPct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <div
      className="relative w-full rounded-xl border bg-muted/40 overflow-hidden cursor-default"
      style={{ aspectRatio: `${VW} / ${VH}`, minHeight: 320 }}
      onClick={() => setSelectedUrl(null)}
    >
      {/* SVG edges layer — pair-based connections */}
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        {edges.map((edge, i) => {
          const dx = edge.nB.x - edge.nA.x;
          const dy = edge.nB.y - edge.nA.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return null;
          const ux = dx / len;
          const uy = dy / len;
          const x1 = edge.nA.x + ux * NODE_INSET;
          const y1 = edge.nA.y + uy * NODE_INSET;
          const x2 = edge.nB.x - ux * NODE_INSET;
          const y2 = edge.nB.y - uy * NODE_INSET;
          const displayScore = edge.score;
          const color = scoreToColor(displayScore);
          const highlighted = isEdgeHighlighted(edge);
          const strokeWidth = displayScore >= 85 ? 4 : displayScore >= 70 ? 3 : 2;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          // Perpendicular unit vector (points "left" of A→B direction)
          const px = -uy;
          const py = ux;
          // Offset label away from line (always push towards positive y for readability)
          const LABEL_OFFSET = 22;
          const sign = py >= 0 ? 1 : -1;
          const labelX = midX + px * LABEL_OFFSET * sign;
          const labelY = midY + py * LABEL_OFFSET * sign;

          return (
            <g key={i} style={{ transition: "opacity 0.2s" }} opacity={highlighted ? 1 : 0.12}>
              {/* Glow */}
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color}
                strokeWidth={strokeWidth + 5}
                strokeDasharray="14,10"
                strokeOpacity="0.10"
                strokeLinecap="round"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-48" dur="3s" repeatCount="indefinite" />
              </line>
              {/* Main line */}
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color}
                strokeWidth={highlighted && selectedUrl ? strokeWidth + 1 : strokeWidth}
                strokeDasharray="14,10"
                strokeOpacity={highlighted ? "0.55" : "0.15"}
                strokeLinecap="round"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-48" dur="3s" repeatCount="indefinite" />
              </line>
              {/* Score + page type pill — inline, offset perpendicular to the line */}
              <foreignObject
                x={labelX - 110} y={labelY - 16}
                width={220} height={32}
                style={{ transition: "opacity 0.2s", overflow: "visible", pointerEvents: "none" }}
                opacity={highlighted ? 1 : 0.1}
              >
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                  <span style={{ color, fontSize: 20, fontWeight: 800, lineHeight: 1 }}>
                    {edge.topPage ? edge.topPage.score : edge.score}%
                  </span>
                  {edge.topPage && (
                    <span style={{
                      background: "rgba(255,255,255,0.9)",
                      backdropFilter: "blur(4px)",
                      borderRadius: 10,
                      padding: "2px 10px",
                      fontSize: 13,
                      fontWeight: 600,
                      color,
                      whiteSpace: "nowrap",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      lineHeight: 1.4,
                    }}>
                      {edge.topPage.label}
                    </span>
                  )}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>

      {/* Domain node cards */}
      {nodes.map((node) => {
        const highlighted = isNodeHighlighted(node.url);
        const isSelected = selectedUrl === node.url;
        return (
          <div
            key={node.domainId}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
            style={{
              left: toPct(node.x, VW),
              top: toPct(node.y, VH),
              opacity: highlighted ? 1 : 0.25,
              transition: "opacity 0.2s, transform 0.2s",
              transform: `translate(-50%, -50%) ${isSelected ? "scale(1.05)" : "scale(1)"}`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedUrl(isSelected ? null : node.url);
            }}
          >
            <GraphNodeCard node={node} isSelected={isSelected} />
          </div>
        );
      })}

      {/* Legend */}
      <div className="absolute bottom-3 left-4 right-4 flex items-center gap-5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="24" height="2" className="flex-shrink-0">
            <line x1="0" y1="1" x2="24" y2="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4,3" strokeOpacity="0.6" />
          </svg>
          Pairwise similarity
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border bg-background flex-shrink-0" />
          Website node
        </span>
        {selectedUrl ? (
          <span className="ml-auto opacity-70">
            Showing connections for {selectedUrl} &middot; Click background to reset
          </span>
        ) : (
          <span className="ml-auto opacity-70">
            {N} sites &middot; {edges.length} connections &middot; Click a node to focus
          </span>
        )}
      </div>
    </div>
  );
}

/** Concise summary explaining why a cluster scores high. */
function ClusterSummary({
  members,
  clusterPairs,
  computedAvg,
}: {
  members: ClusterInfo["members"];
  clusterPairs: PairData[];
  computedAvg: number;
}) {
  const totalShared = clusterPairs.reduce((s, p) => s + p.sharedSentenceCount, 0);
  const avgSharedPerPair =
    clusterPairs.length > 0 ? Math.round(totalShared / clusterPairs.length) : 0;

  // Find the most common shared sentences across pairs
  const sentenceFreq = new Map<string, number>();
  for (const p of clusterPairs) {
    for (const s of p.sharedSentences) {
      const fp = s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      if (fp.length >= 15) sentenceFreq.set(fp, (sentenceFreq.get(fp) || 0) + 1);
    }
  }
  const topSentences = [...sentenceFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  // Get original sentence text from first pair that has it
  const topOriginals = topSentences.map(([fp]) => {
    for (const p of clusterPairs) {
      for (const s of p.sharedSentences) {
        const sFp = s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        if (sFp === fp) return s;
      }
    }
    return fp;
  });

  // Build a single flowing paragraph
  let paragraph = "";
  if (avgSharedPerPair > 0) {
    paragraph += `These ${members.length} websites share common sentences on their About Us pages, with an average of ${avgSharedPerPair} identical sentences per pair. `;
  }
  paragraph += `The About Us content between these websites is ${computedAvg >= 85 ? "very" : computedAvg >= 70 ? "quite" : "moderately"} similar with an avg. similarity score of ${computedAvg}.`;

  if (!paragraph) return null;

  // Severity config for left-border accent + badge
  const severity =
    computedAvg >= 85
      ? { accent: "border-l-orange-500", badge: "warning-subtle" as const, label: "High" }
      : computedAvg >= 70
        ? { accent: "border-l-orange-400", badge: "warning-subtle" as const, label: "Medium" }
        : { accent: "border-l-primary", badge: "info-subtle" as const, label: "Low" };

  return (
    <div className={`mx-4 mt-3 rounded-lg border bg-background overflow-hidden border-l-4 ${severity.accent}`}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-foreground">Summary</span>
          <Badge variant={severity.badge} className="text-[10px]">{severity.label}</Badge>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">{paragraph}</p>
        {topOriginals.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground italic truncate">
            e.g. &ldquo;{topOriginals[0].length > 100 ? topOriginals[0].slice(0, 100) + "..." : topOriginals[0]}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

/** Collapsible accordion card for a single cluster, matching the SentenceGroup / ScamDomainCard pattern. */
function ClusterAccordion({
  cluster,
  pairs,
  defaultExpanded = false,
}: {
  cluster: ClusterInfo;
  pairs: PairData[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const clusterPairs = pairs
    .filter((p) => p.clusterId === cluster.clusterId)
    .sort((a, b) => b.textScore - a.textScore);
  const memberStats = computeMemberStats(cluster.members, clusterPairs);

  // Compute avg/max from blended scores for consistency with node scores
  const pairBlendedScores = clusterPairs.map((p) =>
    blendedScore(p.textScore, p.sharedSentenceCount)
  );
  const computedAvg = pairBlendedScores.length > 0
    ? Math.round(pairBlendedScores.reduce((a, b) => a + b, 0) / pairBlendedScores.length)
    : 0;
  const computedMax = pairBlendedScores.length > 0
    ? Math.max(...pairBlendedScores)
    : 0;

  const isModerate = cluster.confidence === "moderate" || computedAvg < 70;

  const borderColor = "border-border";
  const bgColor = "";

  return (
    <div className={`rounded-lg border ${borderColor} bg-muted/30 overflow-hidden`}>
      {/* Accordion header */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/50 ${bgColor}`}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        <Users className={`h-4 w-4 flex-shrink-0 ${computedAvg >= 85 ? "text-destructive" : computedAvg >= 70 ? "text-orange-500" : "text-muted-foreground"}`} />

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-foreground">
            Cluster {cluster.clusterId + 1}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {cluster.members.length} {cluster.members.length === 1 ? "site" : "sites"}
          </Badge>
          {isModerate && (
            <Badge variant="info-subtle" className="text-[10px]">Moderate</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0">
          <span className="hidden sm:inline">Avg</span>
          <ScoreBadge score={computedAvg} />
          <span className="text-muted-foreground/40">/</span>
          <span className="hidden sm:inline">Max</span>
          <ScoreBadge score={computedMax} />
        </div>
      </button>

      {/* Expanded content: summary + graph */}
      {expanded && (
        <div className="border-t">
          <ClusterSummary
            members={cluster.members}
            clusterPairs={clusterPairs}
            computedAvg={computedAvg}
          />
          <div className="px-4 py-4">
            <ClusterGraph cluster={cluster} memberStats={memberStats} clusterPairs={clusterPairs} computedAvg={computedAvg} />
          </div>
        </div>
      )}
    </div>
  );
}

function ClustersTab({
  clusters,
  pairs,
  domainAboutTexts,
}: {
  clusters: ClusterInfo[];
  pairs: PairData[];
  domainAboutTexts: DomainAboutText[];
}) {
  const [showUnclustered, setShowUnclustered] = useState(false);

  // Derive stats
  const totalDomains = domainAboutTexts.length;
  const clusteredUrlSet = new Set(
    clusters.flatMap((c) => c.members.map((m) => m.url))
  );
  const clusteredCount = clusteredUrlSet.size;
  const unclusteredDomains = domainAboutTexts.filter(
    (d) => !clusteredUrlSet.has(d.url)
  );
  // Compute per-cluster avg from blended scores for consistency
  const clusterAvgs = clusters.map((c) => {
    const cPairs = pairs.filter((p) => p.clusterId === c.clusterId);
    const cScores = cPairs.map((p) => blendedScore(p.textScore, p.sharedSentenceCount));
    return cScores.length > 0
      ? Math.round(cScores.reduce((s, v) => s + v, 0) / cScores.length)
      : 0;
  });
  const avgClusterScore =
    clusterAvgs.length > 0
      ? Math.round(
          clusterAvgs.reduce((sum, a) => sum + a, 0) / clusterAvgs.length
        )
      : 0;
  const clusteringRate =
    totalDomains > 0 ? Math.round((clusteredCount / totalDomains) * 100) : 0;

  if (clusters.length === 0) {
    return (
      <div className="space-y-4">
        {/* Stats strip even when empty, for consistency */}
        <div className="flex items-stretch gap-3 flex-wrap">
          <div className="stat-card flex-1 min-w-[140px]">
            <StatLabel label="Total Clusters" tooltip="Number of groups formed by domains with similarity above the threshold (70)" />
            <p className="stat-card-value">0</p>
          </div>
          <div className="stat-card flex-1 min-w-[140px]">
            <StatLabel label="Clustered Domains" tooltip="Domains that belong to at least one cluster" />
            <p className="stat-card-value">
              0
              <span className="text-sm font-normal text-muted-foreground">
                {" "}/ {totalDomains}
              </span>
            </p>
          </div>
        </div>

        <div className="text-center text-muted-foreground py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="font-medium text-foreground">No clusters found</p>
          <p className="text-sm mt-1">
            No pairs scored above the clustering threshold (70).
            All domains appear independent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats strip */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel label="Total Clusters" tooltip="Number of groups formed by domains with similarity above the threshold (70)" />
          <p className="stat-card-value">{clusters.length}</p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel label="Clustered Domains" tooltip="Domains that belong to at least one cluster" />
          <p className="stat-card-value">
            {clusteredCount}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}/ {totalDomains}
            </span>
          </p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel label="Avg Cluster Score" tooltip="Average similarity score across all clusters" />
          <p className={`stat-card-value ${getScoreTextColor(avgClusterScore)}`}>
            {avgClusterScore}
          </p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel label="Clustering Rate" tooltip="Percentage of domains that are part of a cluster" />
          <p className="stat-card-value flex items-center gap-2">
            {clusteringRate}%
            <CoverageBar
              count={clusteredCount}
              total={totalDomains}
              barColor={clusteringRate > 50 ? "bg-destructive/80" : clusteringRate > 25 ? "bg-orange-400" : "bg-primary/60"}
            />
          </p>
        </div>
      </div>

      {/* Cluster accordion cards */}
      <div className="space-y-3">
        {clusters
          .sort((a, b) => b.avgScore - a.avgScore)
          .map((cluster, i) => (
            <ClusterAccordion
              key={cluster.clusterId}
              cluster={cluster}
              pairs={pairs}
              defaultExpanded={i === 0}
            />
          ))}
      </div>

      {/* Unclustered domains — collapsible, mirroring "Clean Domains" pattern */}
      {unclusteredDomains.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <button
            onClick={() => setShowUnclustered(!showUnclustered)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/30"
          >
            {showUnclustered ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground">
              Unclustered Domains
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {unclusteredDomains.length}
            </Badge>
          </button>
          {showUnclustered && (
            <div className="border-t px-4 py-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {unclusteredDomains.map((d) => (
                  <DomainLink key={d.domainId} url={d.url} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Shared Sentences Tab — Duplicated sentences across sites
// =============================================================================

interface DuplicatedSentence {
  sentence: string;
  foundIn: string[]; // domain URLs
}

/**
 * Find sentences that appear (nearly identically) in 2+ domains.
 * Normalizes by lowercasing, collapsing whitespace, and stripping
 * leading/trailing punctuation before comparing fingerprints.
 */
function findDuplicatedSentences(domains: DomainAboutText[]): DuplicatedSentence[] {
  // fingerprint → { original sentence, set of domain URLs }
  const sentenceMap = new Map<string, { original: string; urls: Set<string> }>();

  for (const d of domains) {
    if (!d.aboutText) continue;

    const cleaned = cleanAboutText(d.aboutText);
    const sentences = cleaned
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20); // require meaningful length

    const seenFingerprints = new Set<string>(); // dedupe within same domain

    for (const sentence of sentences) {
      const fingerprint = sentence
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (fingerprint.length < 15) continue; // skip very short
      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const entry = sentenceMap.get(fingerprint);
      if (entry) {
        entry.urls.add(d.url);
      } else {
        sentenceMap.set(fingerprint, {
          original: sentence,
          urls: new Set([d.url]),
        });
      }
    }
  }

  // Keep only sentences found in 2+ domains, sorted by most domains first
  return Array.from(sentenceMap.values())
    .filter((e) => e.urls.size >= 2)
    .sort((a, b) => b.urls.size - a.urls.size)
    .map((e) => ({
      sentence: e.original,
      foundIn: Array.from(e.urls),
    }));
}

/** Fingerprint a sentence for comparison (lowercase, strip punctuation, collapse spaces). */
function fingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Common English stopwords — excluded from keyword highlighting. */
const STOPWORDS = new Set([
  "a","about","above","after","again","all","am","an","and","any","are","as","at",
  "be","been","before","being","below","between","both","but","by","can","could",
  "did","do","does","doing","down","during","each","few","for","from","get","got",
  "had","has","have","having","he","her","here","hers","herself","him","himself",
  "his","how","i","if","in","into","is","it","its","itself","just","me","might",
  "more","most","my","myself","no","nor","not","now","of","off","on","once","only",
  "or","other","our","ours","ourselves","out","over","own","re","s","same","shall",
  "she","should","so","some","such","t","than","that","the","their","theirs","them",
  "themselves","then","there","these","they","this","those","through","to","too",
  "under","until","up","us","very","was","we","were","what","when","where","which",
  "while","who","whom","why","will","with","would","you","your","yours","yourself",
  "yourselves","also","may","must","one","two","new","used","use","using","make",
  "made","like","well","way","many","back","even","give","day","still","take",
  "come","say","see","go","part","know","let","including","without","within",
  "however","whether","please","otherwise",
]);

/**
 * Extract shared meaningful keywords between two texts.
 * Returns a set of lowercase words that appear in both texts (excluding stopwords
 * and short words). Only returns words that appear at least twice total.
 */
function getSharedKeywords(textA: string, textB: string): Set<string> {
  const tokenize = (text: string) => {
    const words = new Map<string, number>();
    for (const match of text.toLowerCase().matchAll(/[a-z]{3,}/g)) {
      const w = match[0];
      if (!STOPWORDS.has(w)) {
        words.set(w, (words.get(w) || 0) + 1);
      }
    }
    return words;
  };

  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);
  const shared = new Set<string>();

  for (const [word] of wordsA) {
    if (wordsB.has(word)) {
      shared.add(word);
    }
  }

  return shared;
}

/** Clean raw about text: unescape \\n literals, strip heading repetition, collapse noise. */
function cleanAboutText(raw: string): string {
  let text = raw
    .replace(/\\n/g, "\n") // unescape literal \n
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // collapse excessive newlines
    .trim();

  // Strip repeated "About Us" heading lines at the start
  text = text.replace(/^(?:\s*about\s*us\s*\n)+/i, "").trim();

  // Strip "Welcome to <domain> !" opener line
  text = text.replace(/^Welcome to\s+\S+\s*[.!]?\s*\n*/i, "").trim();

  return text;
}

/** Split about text into sentences (min length 20 chars). */
function splitSentences(text: string): string[] {
  const cleaned = cleanAboutText(text);
  return cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

// ---------------------------------------------------------------------------
// SharedSentencesView — helper components
// ---------------------------------------------------------------------------

/** Returns severity config based on what fraction of total domains share a sentence. */
function getSeverityTier(foundInCount: number, totalDomains: number) {
  const ratio = foundInCount / totalDomains;
  if (ratio >= 1) {
    return {
      level: "critical" as const,
      label: `All ${totalDomains} domains`,
      badgeVariant: "warning-subtle" as const,
      borderColor: "border-orange-300/50 dark:border-orange-500/30",
      bgColor: "bg-orange-50/50 dark:bg-orange-950/10",
      iconColor: "text-orange-600 dark:text-orange-400",
      barColor: "bg-orange-500",
    };
  }
  if (ratio >= 0.7) {
    return {
      level: "high" as const,
      label: `${foundInCount} of ${totalDomains} domains`,
      badgeVariant: "warning-subtle" as const,
      borderColor: "border-orange-200/50 dark:border-orange-500/20",
      bgColor: "bg-orange-50/30 dark:bg-orange-950/5",
      iconColor: "text-orange-500 dark:text-orange-400",
      barColor: "bg-orange-400",
    };
  }
  if (ratio >= 0.5) {
    return {
      level: "medium" as const,
      label: `${foundInCount} of ${totalDomains} domains`,
      badgeVariant: "secondary" as const,
      borderColor: "border-border",
      bgColor: "",
      iconColor: "text-muted-foreground",
      barColor: "bg-orange-300",
    };
  }
  return {
    level: "low" as const,
    label: `${foundInCount} of ${totalDomains} domains`,
    badgeVariant: "secondary" as const,
    borderColor: "border-border",
    bgColor: "",
    iconColor: "text-muted-foreground",
    barColor: "bg-primary/60",
  };
}

/** Clickable domain link pill that opens the domain's about page (or homepage fallback). */
function DomainLink({ url, href, tint = "neutral" }: { url: string; href?: string; tint?: "primary" | "neutral" }) {
  const aboutUrl = useAboutPageUrl(url);
  const domainId = useDomainId(url);
  const target = href || aboutUrl;
  return (
    <span
      className={`group/chip inline-flex items-center gap-1 text-xs font-medium pl-3 pr-1.5 py-1 rounded-full transition-colors duration-150 ${
        tint === "primary"
          ? "bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300"
          : "bg-teal-50/60 dark:bg-teal-500/10 text-teal-700/80 dark:text-teal-300/80"
      }`}
    >
      <Globe className="h-3 w-3 opacity-50" aria-hidden="true" />
      <span className="pr-0.5">{url}</span>
      <span className="inline-flex items-center gap-0.5">
        <IconLink href={target} label="Open link" icon={<ExternalLink className="h-3 w-3" />} className="p-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-500/25" />
        {domainId && (
          <IconLink href={`/scans/${domainId}`} label="Open website scan" icon={<ShieldAlert className="h-3 w-3" />} className="p-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-500/25" />
        )}
      </span>
    </span>
  );
}

/** A coverage bar showing the fraction of domains a sentence appears in. */
function CoverageBar({
  count,
  total,
  barColor,
}: {
  count: number;
  total: number;
  barColor: string;
}) {
  const pct = Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** A group of sentences shared by the exact same set of domains. */
interface DomainSetGroup {
  domainKey: string; // sorted domain URLs joined by "|"
  domains: string[]; // the actual domain URLs
  sentences: string[]; // sentence strings
}

/** Number of sentences shown initially before "Show more" is required. */
const SENTENCES_PER_PAGE = 5;

function SentenceGroup({
  group,
  totalDomains,
  allDomains,
  globalIndex,
  defaultExpanded = false,
}: {
  group: DomainSetGroup;
  totalDomains: number;
  allDomains: string[];
  globalIndex: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const foundInCount = group.domains.length;
  const severity = getSeverityTier(foundInCount, totalDomains);
  const isAllDomains = foundInCount >= totalDomains;

  const [visibleCount, setVisibleCount] = useState(SENTENCES_PER_PAGE);
  const visibleSentences = group.sentences.slice(0, visibleCount);
  const remainingCount = group.sentences.length - visibleCount;

  const missingDomains = useMemo(() => {
    if (isAllDomains) return [];
    const foundSet = new Set(group.domains);
    return allDomains.filter((d) => !foundSet.has(d));
  }, [isAllDomains, group.domains, allDomains]);

  const handleShowMore = () => {
    setVisibleCount((prev) => Math.min(prev + SENTENCES_PER_PAGE, group.sentences.length));
  };

  const handleShowAll = () => {
    setVisibleCount(group.sentences.length);
  };

  return (
    <div className={`rounded-lg border ${severity.borderColor} ${severity.bgColor} overflow-hidden`}>
      {/* Group header */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/20"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        )}

        {isAllDomains ? (
          <Shield className={`h-4 w-4 flex-shrink-0 ${severity.iconColor}`} aria-hidden="true" />
        ) : (
          <Layers className={`h-4 w-4 flex-shrink-0 ${severity.iconColor}`} aria-hidden="true" />
        )}

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-foreground">
            {severity.label}
          </span>
          <Badge variant={severity.badgeVariant} className="text-[10px]">
            {group.sentences.length} {group.sentences.length === 1 ? "sentence" : "sentences"}
          </Badge>
        </div>

        <CoverageBar
          count={foundInCount}
          total={totalDomains}
          barColor={severity.barColor}
        />
      </button>

      {/* Expanded content: domains shown once, then sentences */}
      {expanded && (
        <div className="border-t">
          {/* Domain chips — shown once for the entire group */}
          <div className="px-4 py-2.5 bg-muted/10 border-b border-border/50">
            <div className="flex items-center gap-1.5 flex-wrap">
              {group.domains.map((url) => (
                <DomainLink key={url} url={url} />
              ))}
              {missingDomains.length > 0 && missingDomains.length <= 3 && (
                <span className="text-[10px] text-muted-foreground/50 ml-1">
                  not in {missingDomains.join(", ")}
                </span>
              )}
            </div>
          </div>

          {/* Sentences list */}
          <div className="divide-y divide-border/50">
            {visibleSentences.map((sentence, i) => {
              const idx = globalIndex + i;
              return (
                <div
                  key={idx}
                  className="px-4 py-3 flex gap-3 group/sentence hover:bg-muted/20 transition-colors duration-100"
                >
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground/60 pt-0.5 w-5 text-right flex-shrink-0 select-none">
                    {idx + 1}
                  </span>
                  <p className="flex-1 min-w-0 text-sm text-foreground/90 leading-relaxed">
                    <span className="text-muted-foreground/40 select-none">&ldquo;</span>
                    {sentence}
                    <span className="text-muted-foreground/40 select-none">&rdquo;</span>
                  </p>
                </div>
              );
            })}
          </div>

          {/* Progressive disclosure footer */}
          {remainingCount > 0 && (
            <div className="px-4 py-2.5 flex items-center justify-between bg-muted/20 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                Showing {visibleCount} of {group.sentences.length} sentences
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleShowMore}
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors duration-150 px-2 py-1 rounded hover:bg-primary/5"
                >
                  Show {Math.min(SENTENCES_PER_PAGE, remainingCount)} more
                </button>
                {remainingCount > SENTENCES_PER_PAGE && (
                  <button
                    onClick={handleShowAll}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1 rounded hover:bg-muted/50"
                  >
                    Show all
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SharedSentencesView — main component (redesigned)
// ---------------------------------------------------------------------------

/** Maximum height (in px) for the scrollable sentence groups area.
 *  This keeps the stats strip and domain reference bar visible while
 *  the sentence groups scroll within a contained region. */
const SCROLL_AREA_MAX_HEIGHT = 600;

function SharedSentencesView({ domains }: { domains: DomainAboutText[] }) {
  const duplicated = findDuplicatedSentences(domains);

  if (duplicated.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <Copy className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="font-medium text-foreground">No duplicated sentences found</p>
        <p className="text-sm mt-1">
          No sentences appear in the About Us pages of multiple domains.
        </p>
      </div>
    );
  }

  const totalDomains = domains.length;
  const allDomainUrls = domains.map((d) => d.url);

  // Group sentences by exact domain set (domains that share them)
  const domainSetGroups = useMemo(() => {
    const map = new Map<string, DomainSetGroup>();
    for (const item of duplicated) {
      const sorted = [...item.foundIn].sort();
      const key = sorted.join("|");
      const existing = map.get(key);
      if (existing) {
        existing.sentences.push(item.sentence);
      } else {
        map.set(key, { domainKey: key, domains: sorted, sentences: [item.sentence] });
      }
    }
    // Sort groups: most domains first, then most sentences
    return Array.from(map.values()).sort(
      (a, b) => b.domains.length - a.domains.length || b.sentences.length - a.sentences.length
    );
  }, [duplicated]);

  // Count how many sentences appear in ALL domains
  const universalCount = duplicated.filter(
    (d) => d.foundIn.length >= totalDomains
  ).length;

  // Count domains that share 2+ sentences — filters out incidental single matches
  const domainSharedCount = new Map<string, number>();
  for (const d of duplicated) {
    for (const url of d.foundIn) {
      domainSharedCount.set(url, (domainSharedCount.get(url) || 0) + 1);
    }
  }
  const similarDomainCount = Array.from(domainSharedCount.values()).filter(
    (c) => c >= 2
  ).length;

  // Expand/collapse all toggle -- tracks a generation counter so child
  // groups can synchronize. null means "no override, use defaults".
  const [expandOverride, setExpandOverride] = useState<{
    expanded: boolean;
    gen: number;
  } | null>(null);

  const handleToggleAll = () => {
    setExpandOverride((prev) => ({
      expanded: prev ? !prev.expanded : false, // first click collapses all
      gen: (prev?.gen ?? 0) + 1,
    }));
  };

  return (
    <div className="space-y-4">
      {/* Summary stats strip -- always visible (above the scroll region) */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel label="Shared Sentences" tooltip="Sentences that appear word-for-word in two or more domains' pages" />
          <p className="stat-card-value">{duplicated.length}</p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel label="Similar Domains" tooltip="Domains that share 2 or more sentences with other domains" />
          <p className="stat-card-value">
            <span className={similarDomainCount >= totalDomains * 0.5 ? "text-orange-600 dark:text-orange-400" : ""}>
              {similarDomainCount}
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {" "}/ {totalDomains}
            </span>
          </p>
        </div>
        {universalCount > 0 && (
          <div className="stat-card flex-1 min-w-[140px] border-orange-200 dark:border-orange-500/30 bg-orange-50/50 dark:bg-orange-950/10">
            <StatLabel
              label="In Every Domain"
              tooltip="Sentences found in all analyzed domains — strong indicator of templated content"
            />
            <p className="stat-card-value text-orange-600 dark:text-orange-400">{universalCount}</p>
          </div>
        )}
      </div>

      {/* Toolbar: expand/collapse all toggle */}
      {domainSetGroups.length > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {domainSetGroups.length} groups
          </span>
          <button
            onClick={handleToggleAll}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1 rounded hover:bg-muted/50"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            {expandOverride?.expanded === false ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}

      {/* Sentence groups in a contained, scrollable region */}
      <div
        className="space-y-3 overflow-y-auto overscroll-contain pr-1"
        style={{ maxHeight: `${SCROLL_AREA_MAX_HEIGHT}px` }}
      >
        {(() => {
          let runningIndex = 0;
          return domainSetGroups.map((group, groupIdx) => {
            const globalIndex = runningIndex;
            runningIndex += group.sentences.length;

            const defaultExpanded =
              expandOverride != null ? expandOverride.expanded : groupIdx === 0;

            return (
              <SentenceGroup
                key={`${group.domainKey}-${expandOverride?.gen ?? "init"}`}
                group={group}
                totalDomains={totalDomains}
                allDomains={allDomainUrls}
                globalIndex={globalIndex}
                defaultExpanded={defaultExpanded}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}

// -- Side-by-Side pairwise comparison --

/**
 * Render about text as natural paragraphs with shared sentences highlighted inline.
 * Splits on double-newlines for paragraphs, then finds shared sentence spans within each.
 */
function AboutTextColumn({
  url,
  aboutText,
  sharedFps,
  sharedKeywords,
}: {
  url: string;
  aboutText: string;
  sharedFps: Set<string>;
  sharedKeywords?: Set<string>;
}) {
  const aboutUrl = useAboutPageUrl(url);
  const domainId = useDomainId(url);
  const cleaned = cleanAboutText(aboutText);
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);

  return (
    <div className="p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 mb-3 flex items-center gap-1.5">
        <Globe className="h-3 w-3" aria-hidden="true" />
        {url}
        <IconLink href={aboutUrl} label="Open link" icon={<ExternalLink className="h-3 w-3" />} />
        {domainId && (
          <IconLink href={`/scans/${domainId}`} label="Open website scan" icon={<ShieldAlert className="h-3 w-3" />} />
        )}
      </div>
      {paragraphs.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No about text available</p>
      ) : (
        <div className="space-y-3 text-[13px] leading-relaxed text-foreground/80">
          {paragraphs.map((para, pi) => (
            <HighlightedParagraph key={pi} text={para} sharedFps={sharedFps} sharedKeywords={sharedKeywords} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Highlight shared keywords within a text fragment.
 * Splits on word boundaries, highlights words in the sharedKeywords set.
 */
function KeywordHighlightedText({
  text,
  sharedKeywords,
}: {
  text: string;
  sharedKeywords: Set<string>;
}) {
  // Split text into tokens preserving whitespace/punctuation
  const tokens = text.split(/\b/);
  return (
    <>
      {tokens.map((token, i) => {
        const lower = token.toLowerCase().replace(/[^a-z]/g, "");
        if (lower.length >= 3 && sharedKeywords.has(lower)) {
          return (
            <mark
              key={i}
              className="bg-blue-100/70 dark:bg-blue-500/15 text-foreground rounded-sm"
            >
              {token}
            </mark>
          );
        }
        return <span key={i}>{token}</span>;
      })}
    </>
  );
}

/**
 * Render a paragraph, highlighting any sentence spans that match shared fingerprints.
 * For non-matching sentences, highlights shared keywords (vocabulary overlap).
 * Splits by sentence boundaries while preserving the full text flow.
 */
function HighlightedParagraph({
  text,
  sharedFps,
  sharedKeywords,
}: {
  text: string;
  sharedFps: Set<string>;
  sharedKeywords?: Set<string>;
}) {
  // Split into sentences but keep the delimiters to preserve punctuation
  const parts = text.split(/(?<=[.!?])\s+/);

  return (
    <p>
      {parts.map((part, i) => {
        const fp = fingerprint(part);
        const isShared = fp.length >= 15 && sharedFps.has(fp);
        if (isShared) {
          return (
            <mark
              key={i}
              className="bg-orange-100 dark:bg-orange-500/15 text-foreground rounded px-0.5 -mx-0.5"
            >
              {part}{" "}
            </mark>
          );
        }
        if (sharedKeywords && sharedKeywords.size > 0) {
          return (
            <span key={i}>
              <KeywordHighlightedText text={part} sharedKeywords={sharedKeywords} />{" "}
            </span>
          );
        }
        return <span key={i}>{part} </span>;
      })}
    </p>
  );
}

/** Number of pair cards shown initially before progressive disclosure kicks in. */
const PAIRS_PER_PAGE = 5;

/**
 * A single collapsible pair card for the Side-by-Side view.
 * Renders as an accordion: the header always shows domain names, similarity
 * score, and shared sentence count; the body expands to show the two-column
 * AboutTextColumn layout.
 */
function PairDomainLabel({ url }: { url: string }) {
  const aboutUrl = useAboutPageUrl(url);
  const domainId = useDomainId(url);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold truncate">
      <Globe className="h-4 w-4 text-teal-600 dark:text-teal-400 flex-shrink-0" aria-hidden="true" />
      {url}
      <IconLink href={aboutUrl} label="Open link" icon={<ExternalLink className="h-3 w-3" />} onClick={stop} />
      {domainId && (
        <IconLink href={`/scans/${domainId}`} label="Open website scan" icon={<ShieldAlert className="h-3 w-3" />} onClick={stop} />
      )}
    </span>
  );
}

function SideBySidePairCard({
  pair,
  domainMap,
  defaultExpanded = false,
}: {
  pair: PairData;
  domainMap: Map<string, DomainAboutText>;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activePageType, setActivePageType] = useState("about_page");

  const domA = domainMap.get(pair.domainAUrl);
  const domB = domainMap.get(pair.domainBUrl);

  // Get text for the active page type
  const getPageText = (dom: DomainAboutText | undefined, pageKey: string) => {
    if (!dom) return "";
    if (pageKey === "about_page") return dom.aboutText || "";
    const pt = dom.pageTexts?.find((p) => p.key === pageKey);
    return pt?.text || "";
  };

  const textA = getPageText(domA, activePageType);
  const textB = getPageText(domB, activePageType);

  // Which page types have text for both domains?
  const availablePageTypes = useMemo(() => {
    if (!domA?.pageTexts || !domB?.pageTexts) return [];
    const PAGE_LABELS: Record<string, string> = {
      homepage_text: "Homepage", about_page: "About Us", contact_page: "Contact Us",
      privacy_page: "Privacy Policy", refund_page: "Refund Policy", terms_page: "Terms of Service",
    };
    const keysA = new Set(domA.pageTexts.map((p) => p.key));
    // Always include about_page if aboutText exists
    if (domA.aboutText) keysA.add("about_page");
    const keysB = new Set(domB.pageTexts.map((p) => p.key));
    if (domB.aboutText) keysB.add("about_page");
    const common = Array.from(keysA).filter((k) => keysB.has(k));
    return common.map((k) => ({
      key: k,
      label: PAGE_LABELS[k] || k,
      score: pair.pageScores?.find((ps) => ps.pageType === k)?.score,
    }));
  }, [domA, domB, pair.pageScores]);

  // Build set of shared sentence fingerprints from both stored
  // sharedSentences AND cross-matching between the two texts
  const sharedFps = useMemo(() => {
    const fps = new Set(
      (pair.sharedSentences || []).map((s) => fingerprint(s))
    );
    const sentencesA = textA ? splitSentences(textA) : [];
    const sentencesB = textB ? splitSentences(textB) : [];
    const fpsA = new Set(sentencesA.map((s) => fingerprint(s)));
    for (const s of sentencesB) {
      const fp = fingerprint(s);
      if (fpsA.has(fp)) fps.add(fp);
    }
    return fps;
  }, [pair.sharedSentences, textA, textB]);

  // Shared keywords: important words that appear in both texts (drives TF-IDF score)
  const sharedKeywords = useMemo(() => {
    if (!textA || !textB) return undefined;
    return getSharedKeywords(textA, textB);
  }, [textA, textB]);

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Pair header -- acts as an accessible accordion trigger */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/30 bg-muted/30 border-b border-transparent data-[expanded=true]:border-border"
        data-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}

          <PairDomainLabel url={pair.domainAUrl} />
          <span className="text-muted-foreground flex items-center gap-1 flex-shrink-0">
            &mdash;
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            &mdash;
          </span>
          <PairDomainLabel url={pair.domainBUrl} />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {pair.pageScores?.filter((ps) => ps.score >= 60).length > 0 && (
            <div className="flex items-center gap-1">
              {pair.pageScores
                .filter((ps) => ps.score >= 60)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map((ps) => (
                  <Badge key={ps.pageType} variant="outline" className="text-[10px] py-0">
                    {ps.label} {ps.score}%
                  </Badge>
                ))}
              {pair.pageScores.filter((ps) => ps.score >= 60).length > 3 && (
                <Badge variant="outline" className="text-[10px] py-0">
                  +{pair.pageScores.filter((ps) => ps.score >= 60).length - 3}
                </Badge>
              )}
            </div>
          )}
          {pair.sharedSentenceCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {pair.sharedSentenceCount} shared {pair.sharedSentenceCount === 1 ? "sentence" : "sentences"}
            </Badge>
          )}
          <span
            className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-md ${getScoreBgColorSubtle(pair.textScore)} ${getScoreTextColor(pair.textScore)}`}
          >
            {pair.textScore}%
          </span>
        </div>
      </button>

      {/* Expanded: page type selector + side-by-side text columns */}
      {expanded && (
        <div>
          {availablePageTypes.length > 1 && (
            <div className="flex items-center gap-1 px-4 py-2 border-t bg-muted/20">
              {availablePageTypes.map((pt) => (
                <button
                  key={pt.key}
                  onClick={(e) => { e.stopPropagation(); setActivePageType(pt.key); }}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    activePageType === pt.key
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {pt.label}{pt.score != null ? ` (${pt.score}%)` : ""}
                </button>
              ))}
            </div>
          )}
          {/* Highlight legend */}
          <div className="flex items-center gap-4 px-4 py-1.5 border-t text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-orange-100 dark:bg-orange-500/15 border border-orange-200 dark:border-orange-500/30" />
              Identical sentence
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-blue-100/70 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30" />
              Shared keyword
            </span>
          </div>
          <div className="grid grid-cols-2 divide-x border-t">
            <AboutTextColumn
              url={pair.domainAUrl}
              aboutText={textA}
              sharedFps={sharedFps}
              sharedKeywords={sharedKeywords}
            />
            <AboutTextColumn
              url={pair.domainBUrl}
              aboutText={textB}
              sharedFps={sharedFps}
              sharedKeywords={sharedKeywords}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SideBySideView({
  pairs,
  domains,
}: {
  pairs: PairData[];
  domains: DomainAboutText[];
}) {
  const domainMap = useMemo(
    () => new Map(domains.map((d) => [d.url, d])),
    [domains]
  );

  const relevantPairs = useMemo(
    () =>
      [...pairs]
        .filter((p) => p.sharedSentenceCount > 0 || p.textScore >= 40)
        .sort((a, b) => b.textScore - a.textScore),
    [pairs]
  );

  // Progressive disclosure: show PAIRS_PER_PAGE initially, expand on demand
  const [visibleCount, setVisibleCount] = useState(PAIRS_PER_PAGE);
  const visiblePairs = relevantPairs.slice(0, visibleCount);
  const remainingCount = relevantPairs.length - visibleCount;

  const handleShowMore = () => {
    setVisibleCount((prev) =>
      Math.min(prev + PAIRS_PER_PAGE, relevantPairs.length)
    );
  };

  const handleShowAll = () => {
    setVisibleCount(relevantPairs.length);
  };

  // Expand/collapse all toggle -- uses a generation counter so child
  // SideBySidePairCard components re-mount with the new default state.
  const [expandOverride, setExpandOverride] = useState<{
    expanded: boolean;
    gen: number;
  } | null>(null);

  const handleToggleAll = () => {
    setExpandOverride((prev) => ({
      expanded: prev ? !prev.expanded : false, // first click collapses all
      gen: (prev?.gen ?? 0) + 1,
    }));
  };

  if (relevantPairs.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <Link2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="font-medium text-foreground">No comparable pairs</p>
        <p className="text-sm mt-1">
          No pairs have shared sentences or meaningful similarity.
        </p>
      </div>
    );
  }

  // Stats: average similarity across relevant pairs
  const avgSimilarity = Math.round(
    relevantPairs.reduce((sum, p) => sum + p.textScore, 0) /
      relevantPairs.length
  );
  const totalShared = relevantPairs.reduce(
    (sum, p) => sum + p.sharedSentenceCount,
    0
  );

  return (
    <div className="space-y-4">
      {/* Summary stats strip -- always visible above the scroll region */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel
            label="Comparable Pairs"
            tooltip="Domain pairs with shared sentences or similarity above 40%"
          />
          <p className="stat-card-value">{relevantPairs.length}</p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel
            label="Avg Similarity"
            tooltip="Average text similarity score across all comparable pairs"
          />
          <p className="stat-card-value">
            <span className={getScoreTextColor(avgSimilarity)}>
              {avgSimilarity}%
            </span>
          </p>
        </div>
        {totalShared > 0 && (
          <div className="stat-card flex-1 min-w-[140px]">
            <StatLabel
              label="Shared Sentences"
              tooltip="Total shared sentences found across all comparable pairs"
              icon={<Copy className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <p className="stat-card-value">{totalShared}</p>
          </div>
        )}
      </div>

      {/* Toolbar: expand/collapse all toggle */}
      {relevantPairs.length > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {visiblePairs.length} of {relevantPairs.length} pairs
          </span>
          <button
            onClick={handleToggleAll}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1 rounded hover:bg-muted/50"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            {expandOverride?.expanded === false ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}

      {/* Pair cards in a contained, scrollable region.
          The max-height keeps the stats strip and toolbar visible while
          letting the investigator scroll through pair cards without
          the overall page growing unboundedly. Uses overscroll-behavior
          to prevent scroll chaining per web interface guidelines. */}
      <div
        className="space-y-3 overflow-y-auto overscroll-contain pr-1"
        style={{ maxHeight: `${SCROLL_AREA_MAX_HEIGHT}px` }}
      >
        {visiblePairs.map((pair, idx) => {
          // Default: only first pair expanded; override when user toggles all
          const defaultExpanded =
            expandOverride != null ? expandOverride.expanded : idx === 0;

          return (
            <SideBySidePairCard
              key={`${pair.id}-${expandOverride?.gen ?? "init"}`}
              pair={pair}
              domainMap={domainMap}
              defaultExpanded={defaultExpanded}
            />
          );
        })}

        {/* "Show more" progressive disclosure footer */}
        {remainingCount > 0 && (
          <div className="px-4 py-2.5 flex items-center justify-between bg-muted/20 rounded-lg border">
            <span className="text-xs text-muted-foreground">
              Showing {visiblePairs.length} of {relevantPairs.length} pairs
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleShowMore}
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors duration-150 px-2 py-1 rounded hover:bg-primary/5"
              >
                Show {Math.min(PAIRS_PER_PAGE, remainingCount)} more
              </button>
              {remainingCount > PAIRS_PER_PAGE && (
                <button
                  onClick={handleShowAll}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1 rounded hover:bg-muted/50"
                >
                  Show all
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Wrapper with sub-tabs --

function SharedSentencesTab({
  domains,
  pairs,
  duplicatedCount,
}: {
  domains: DomainAboutText[];
  pairs: PairData[];
  duplicatedCount: number;
}) {
  const [subTab, setSubTab] = useState("shared");

  const relevantPairCount = pairs.filter(
    (p) => p.sharedSentenceCount > 0 || p.textScore >= 40
  ).length;

  const SUBTABS = useMemo(() => [
    {
      key: "shared",
      label: "Shared Sentences",
      badge: duplicatedCount > 0 ? duplicatedCount : undefined,
    },
    {
      key: "sidebyside",
      label: "Side-by-Side",
      badge: relevantPairCount > 0 ? relevantPairCount : undefined,
    },
  ], [duplicatedCount, relevantPairCount]);

  return (
    <Tabs
      tabs={SUBTABS}
      activeTab={subTab}
      onTabChange={setSubTab}
      variant="compact"
    >
      <TabPanel tabKey="shared" activeTab={subTab}>
        <SharedSentencesView domains={domains} />
      </TabPanel>
      <TabPanel tabKey="sidebyside" activeTab={subTab}>
        <SideBySideView pairs={pairs} domains={domains} />
      </TabPanel>
    </Tabs>
  );
}

// =============================================================================
// Scam Detection Tab — "Uniqueness" marker scanner
// =============================================================================

const SCAM_KEYWORDS = ["uniqueness", "unique"];

interface ScamMatch {
  url: string;
  aboutPageUrl: string;
  matchCount: number;
  excerpts: { sentence: string; keyword: string }[];
}

function findScamMatches(domains: DomainAboutText[]): {
  flagged: ScamMatch[];
  clean: string[];
} {
  const flagged: ScamMatch[] = [];
  const clean: string[] = [];

  for (const d of domains) {
    if (!d.aboutText) {
      clean.push(d.url);
      continue;
    }

    const text = cleanAboutText(d.aboutText);
    const sentences = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    const excerpts: ScamMatch["excerpts"] = [];

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      for (const keyword of SCAM_KEYWORDS) {
        // Word-boundary match to avoid partial matches inside other words
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(lower)) {
          // Avoid duplicate sentences
          if (!excerpts.some((e) => e.sentence === sentence)) {
            excerpts.push({ sentence, keyword });
          }
        }
      }
    }

    if (excerpts.length > 0) {
      const aboutPageUrl = d.aboutPageUrl || `https://${d.url}/about`;
      flagged.push({ url: d.url, aboutPageUrl, matchCount: excerpts.length, excerpts });
    } else {
      clean.push(d.url);
    }
  }

  return { flagged, clean };
}

/** Highlight keyword occurrences in text with a subtle <mark> tag. */
function HighlightedText({ text, keywords }: { text: string; keywords: string[] }) {
  // Build regex that matches any keyword (word-boundary, case-insensitive)
  const pattern = new RegExp(
    `(\\b(?:${keywords.join("|")})\\b)`,
    "gi"
  );
  const parts = text.split(pattern);

  return (
    <span>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark
            key={i}
            className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-semibold px-0.5 rounded-sm"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

/** Collapsible card for a single flagged domain in scam detection. */
function ScamDomainCard({ match }: { match: ScamMatch }) {
  const [expanded, setExpanded] = useState(true);
  const domainId = useDomainId(match.url);

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/30"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        )}

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Globe className="h-4 w-4 text-teal-600 dark:text-teal-400 flex-shrink-0" aria-hidden="true" />
            {match.url}
            <IconLink href={match.aboutPageUrl} label="Open link" icon={<ExternalLink className="h-3 w-3" />} onClick={(e) => e.stopPropagation()} />
            {domainId && (
              <IconLink href={`/scans/${domainId}`} label="Open website scan" icon={<ShieldAlert className="h-3 w-3" />} onClick={(e) => e.stopPropagation()} />
            )}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {match.matchCount} {match.matchCount === 1 ? "hit" : "hits"}
          </Badge>
        </div>
      </button>

      {expanded && (
        <div className="border-t divide-y divide-border/50">
          {match.excerpts.map((excerpt, i) => (
            <div
              key={i}
              className="px-4 py-3 flex gap-3 hover:bg-muted/20 transition-colors duration-100"
            >
              <span className="text-[10px] font-mono tabular-nums text-muted-foreground/60 pt-0.5 w-5 text-right flex-shrink-0 select-none">
                {i + 1}
              </span>
              <p className="text-sm text-foreground/90 leading-relaxed flex-1">
                <span className="text-muted-foreground/40 select-none">&ldquo;</span>
                <HighlightedText text={excerpt.sentence} keywords={SCAM_KEYWORDS} />
                <span className="text-muted-foreground/40 select-none">&rdquo;</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScamDetectionTab({ domains }: { domains: DomainAboutText[] }) {
  const { flagged, clean } = findScamMatches(domains);
  const [showClean, setShowClean] = useState(false);
  const totalMatches = flagged.reduce((s, m) => s + m.matchCount, 0);
  const detectionRate = domains.length > 0
    ? Math.round((flagged.length / domains.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Summary stats strip */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel
            label="Domains Scanned"
            tooltip={`Checked for keywords: ${SCAM_KEYWORDS.map((k) => `"${k}"`).join(", ")}`}
          />
          <p className="stat-card-value">{domains.length}</p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel
            label="Flagged"
            tooltip="Number of domains whose About page contains uniqueness keywords"
          />
          <p className={`stat-card-value ${flagged.length > 0 ? "text-orange-600 dark:text-orange-400" : ""}`}>
            {flagged.length}
          </p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel
            label="Total Hits"
            tooltip="Total sentences containing uniqueness keywords across all flagged domains. One domain can have multiple hits."
          />
          <p className="stat-card-value">{totalMatches}</p>
        </div>
        <div className="stat-card flex-1 min-w-[140px]">
          <StatLabel
            label="Detection Rate"
            tooltip="Percentage of scanned domains that were flagged"
          />
          <p className="stat-card-value flex items-center gap-2">
            {detectionRate}%
            <CoverageBar
              count={flagged.length}
              total={domains.length}
              barColor={detectionRate > 50 ? "bg-destructive/80" : detectionRate > 25 ? "bg-warning" : "bg-primary/60"}
            />
          </p>
        </div>
      </div>

      {/* Flagged domains */}
      {flagged.length > 0 && (
        <div className="space-y-3">
          {flagged
            .sort((a, b) => b.matchCount - a.matchCount)
            .map((match) => (
              <ScamDomainCard key={match.url} match={match} />
            ))}
        </div>
      )}

      {/* No matches state */}
      {flagged.length === 0 && (
        <div className="text-center text-muted-foreground py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Shield className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="font-medium text-foreground">No scam markers detected</p>
          <p className="text-sm mt-1">
            None of the analyzed domains contain known scam keywords
            in their About Us pages.
          </p>
        </div>
      )}

      {/* Clean domains — collapsible */}
      {clean.length > 0 && flagged.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <button
            onClick={() => setShowClean(!showClean)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/30"
          >
            {showClean ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <Shield className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground">
              Clean Domains
            </span>
            <Badge variant="success-subtle" className="text-[10px]">
              {clean.length}
            </Badge>
          </button>
          {showClean && (
            <div className="border-t px-4 py-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {clean.map((url) => (
                  <DomainLink key={url} url={url} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function AnalysisResultTabsInner({
  summary,
  pairs,
  clusterCount,
  domainAboutTexts,
}: {
  summary: Summary | null;
  pairs: PairData[];
  clusterCount: number;
  domainAboutTexts: DomainAboutText[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = searchParams.get("tab") || "summary";

  const handleTabChange = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const scamMatches = findScamMatches(domainAboutTexts);
  const duplicatedSentences = findDuplicatedSentences(domainAboutTexts);

  // Build lookups for DomainLink context
  const aboutPageUrlMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of domainAboutTexts) {
      if (d.aboutPageUrl) {
        map.set(d.url, d.aboutPageUrl);
      }
    }
    return map;
  }, [domainAboutTexts]);

  const domainIdMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of domainAboutTexts) {
      map.set(d.url, d.domainId);
    }
    return map;
  }, [domainAboutTexts]);

  const tabs = TAB_DEFS.map((t) => {
    if (t.key === "clusters" && clusterCount > 0) {
      return { ...t, badge: clusterCount };
    }
    if (t.key === "shared" && duplicatedSentences.length > 0) {
      return { ...t, badge: duplicatedSentences.length };
    }
    if (t.key === "scam" && scamMatches.flagged.length > 0) {
      return { ...t, badge: scamMatches.flagged.length };
    }
    return t;
  });

  return (
    <AboutPageUrlContext.Provider value={aboutPageUrlMap}>
    <DomainIdContext.Provider value={domainIdMap}>
    <Tabs
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      className="bg-white dark:bg-card rounded-xl p-4 sm:p-6"
    >
      <TabPanel tabKey="summary" activeTab={activeTab}>
        {summary ? (
          <SummaryTab
              summary={summary}
              pairs={pairs}
              domainAboutTexts={domainAboutTexts}
              scamMatches={scamMatches}
              duplicatedSentences={duplicatedSentences}
            />
        ) : (
          <p className="text-muted-foreground text-center py-8">
            No summary data available
          </p>
        )}
      </TabPanel>

      <TabPanel tabKey="clusters" activeTab={activeTab}>
        <ClustersTab
          clusters={summary?.clusters || []}
          pairs={pairs}
          domainAboutTexts={domainAboutTexts}
        />
      </TabPanel>

      <TabPanel tabKey="shared" activeTab={activeTab}>
        <SharedSentencesTab
          domains={domainAboutTexts}
          pairs={pairs}
          duplicatedCount={duplicatedSentences.length}
        />
      </TabPanel>

      <TabPanel tabKey="scam" activeTab={activeTab}>
        <ScamDetectionTab domains={domainAboutTexts} />
      </TabPanel>
    </Tabs>
    </DomainIdContext.Provider>
    </AboutPageUrlContext.Provider>
  );
}

export function AnalysisResultTabs(props: {
  summary: Summary | null;
  pairs: PairData[];
  clusterCount: number;
  domainAboutTexts: DomainAboutText[];
}) {
  return (
    <Suspense fallback={<div className="h-12 bg-muted/30 rounded animate-pulse" />}>
      <AnalysisResultTabsInner {...props} />
    </Suspense>
  );
}
