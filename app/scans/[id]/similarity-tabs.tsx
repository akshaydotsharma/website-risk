"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Users,
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Link2,
  Shield,
  Info,
  Network,
  ArrowRight,
  Copy,
  Fingerprint,
  CheckCircle2,
} from "lucide-react";
import { getScoreTextColor, getScoreBgColorSubtle, getScoreBorderLeftColor } from "@/lib/utils";
import Link from "next/link";

// =============================================================================
// Types
// =============================================================================

interface PageScoreData {
  pageType: string;
  label: string;
  score: number;
  sharedSentenceCount: number;
}

interface KeywordHit {
  keyword: string;
  count: number;
}

interface PairData {
  id: string;
  domainAId: string;
  domainBId: string;
  domainAUrl: string;
  domainBUrl: string;
  compositeScore: number;
  sharedSentences: string[];
  sharedSentenceCount: number;
  pageScores: PageScoreData[];
  keywordHitsA: KeywordHit[];
  keywordHitsB: KeywordHit[];
}

interface DomainText {
  domainId: string;
  url: string;
  aboutText: string;
  aboutPageUrl?: string | null;
  pageTexts: { key: string; label: string; text: string; pageUrl?: string }[];
}

interface SimilaritySummary {
  similarCount: number;
  highSimilarCount: number;
  maxSimilarity: number;
  avgSimilarity: number;
  uniquenessScore: number;
  clusterSize: number;
  clusterMembers: string[];
  topSimilar: Array<{
    domainId: string;
    url: string;
    score: number;
    sharedSentenceCount: number;
  }>;
  totalClusters: number;
  analyzedAt: string;
}

interface SimilarityTabsProps {
  domainId: string;
  domainUrl: string;
  summary: SimilaritySummary;
  pairs: PairData[];
  crossLinks?: PairData[];
  domainTexts: DomainText[];
}

// =============================================================================
// Helpers
// =============================================================================

function fingerprint(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

function cleanAboutText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function getSharedKeywords(textA: string, textB: string): Set<string> {
  const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
    "were", "be", "been", "being", "have", "has", "had", "do", "does",
    "did", "will", "would", "could", "should", "may", "might", "shall",
    "can", "not", "no", "we", "our", "us", "you", "your", "they", "their",
    "them", "he", "she", "his", "her", "its", "all", "each", "every",
    "any", "some", "as", "so", "if", "than", "more", "also", "very",
    "just", "about", "over", "such", "into", "through", "after", "before",
    "between", "under", "above", "up", "out", "off", "down", "then",
    "here", "there", "when", "where", "how", "what", "which", "who",
    "whom", "why", "while", "during", "because", "both", "many",
  ]);
  const tokenize = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  const wordsA = new Set(tokenize(textA));
  const wordsB = new Set(tokenize(textB));
  const shared = new Set<string>();
  for (const w of wordsA) {
    if (wordsB.has(w)) shared.add(w);
  }
  return shared;
}

const SCAM_KEYWORDS = ["uniqueness", "unique"];

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-md ${getScoreBgColorSubtle(score)} ${getScoreTextColor(score)}`}>
      {score}
    </span>
  );
}

function StatLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <div className="stat-card-label">
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

// =============================================================================
// Summary Tab
// =============================================================================

function SummaryTab({
  domainId,
  domainUrl,
  summary,
  pairs,
  domainTexts,
}: {
  domainId: string;
  domainUrl: string;
  summary: SimilaritySummary;
  pairs: PairData[];
  domainTexts: DomainText[];
}) {
  // Shared sentences: count across all pairs
  const totalSharedSentences = pairs.reduce((s, p) => s + p.sharedSentenceCount, 0);

  // Top shared sentences (deduplicated)
  const allSharedSentences = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const p of pairs) {
      for (const s of p.sharedSentences) {
        const fp = fingerprint(s);
        if (!seen.has(fp)) {
          seen.add(fp);
          result.push(s);
        }
      }
    }
    return result;
  }, [pairs]);

  // Uniqueness check: scan all page texts for keywords
  const targetDomain = domainTexts.find((d) => d.domainId === domainId);
  const uniquenessExcerpts = useMemo(() => {
    if (!targetDomain) return [];
    const allTexts: string[] = [];
    if (targetDomain.aboutText) allTexts.push(targetDomain.aboutText);
    for (const pt of targetDomain.pageTexts || []) {
      if (pt.text) allTexts.push(pt.text);
    }
    const hits: string[] = [];
    for (const rawText of allTexts) {
      const cleaned = cleanAboutText(rawText);
      const sentences = cleaned.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 10);
      for (const sentence of sentences) {
        for (const keyword of SCAM_KEYWORDS) {
          if (new RegExp(`\\b${keyword}\\b`, "i").test(sentence)) {
            if (!hits.includes(sentence)) hits.push(sentence);
          }
        }
      }
    }
    return hits;
  }, [targetDomain]);

  return (
    <div className="space-y-6">
      {/* ---- Stats strip ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="stat-card border-l-4 border-l-transparent">
          <StatLabel label="Domains" tooltip="Number of domains compared against" />
          <p className="stat-card-value">{summary.similarCount}</p>
        </div>
        <div className={`stat-card border-l-4 ${summary.uniquenessScore > 0 ? "border-l-destructive" : "border-l-success"}`}>
          <StatLabel label="Uniqueness" tooltip="Whether this domain's pages contain uniqueness-related keywords (e.g. 'unique', 'one of a kind')" />
          <p className={`stat-card-value ${summary.uniquenessScore > 0 ? "text-destructive" : "text-success"}`}>
            {summary.uniquenessScore > 0 ? "Yes" : "No"}
          </p>
        </div>
        <div className={`stat-card border-l-4 ${getScoreBorderLeftColor(summary.maxSimilarity)}`}>
          <StatLabel label="Max Score" tooltip="Highest pairwise similarity score between this domain and any other. 99 means nearly identical content." />
          <p className={`stat-card-value ${getScoreTextColor(summary.maxSimilarity)}`}>
            {summary.maxSimilarity}
          </p>
        </div>
        <div className="stat-card border-l-4 border-l-transparent">
          <StatLabel label="Clusters" tooltip="Number of content clusters this domain belongs to" />
          <p className="stat-card-value">{summary.clusterSize > 0 ? 1 : 0}</p>
        </div>
      </div>

      {/* ---- Clusters Insight ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Clusters</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            // Only show members connected via pairs >= 50
            const connectedUrls = new Set<string>();
            for (const p of pairs) {
              if (p.compositeScore >= 50 && summary.clusterMembers.includes(
                p.domainAId === domainId ? p.domainBUrl : p.domainAUrl
              )) {
                connectedUrls.add(p.domainAUrl);
                connectedUrls.add(p.domainBUrl);
              }
            }
            const filteredMembers = summary.clusterMembers.filter((u) => connectedUrls.has(u));

            if (filteredMembers.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  No clusters were formed. No domains share enough textual similarity to be grouped together.
                </p>
              );
            }

            return (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  In a cluster with{" "}
                  <span className="font-semibold text-foreground">{filteredMembers.length}</span>{" "}
                  {filteredMembers.length === 1 ? "domain" : "domains"}.
                </p>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="group/chip inline-flex items-center gap-1 text-xs font-medium pl-3 pr-1.5 py-1 rounded-full bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300">
                      <Globe className="h-3 w-3 opacity-50" aria-hidden="true" />
                      <span className="pr-0.5">{domainUrl}</span>
                      <span className="inline-flex items-center gap-0.5">
                        <a href={`https://${domainUrl}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-500/25 text-teal-600/60 hover:text-teal-700 transition-colors" aria-label="Open website">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link href={`/scans/${domainId}`} className="p-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-500/25 text-teal-600/60 hover:text-teal-700 transition-colors" aria-label="Open scan">
                              <Info className="h-3 w-3" />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Open scan</TooltipContent>
                        </Tooltip>
                      </span>
                    </span>
                    {filteredMembers.map((url) => {
                      const matched = summary.topSimilar.find((t) => t.url === url);
                      return (
                        <span
                          key={url}
                          className="group/chip inline-flex items-center gap-1 text-xs font-medium pl-3 pr-1.5 py-1 rounded-full bg-teal-50/60 dark:bg-teal-500/10 text-teal-700/80 dark:text-teal-300/80"
                        >
                          <Globe className="h-3 w-3 opacity-50" aria-hidden="true" />
                          <span className="pr-0.5">{url}</span>
                          <span className="inline-flex items-center gap-0.5">
                            <a href={`https://${url}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-500/25 text-teal-600/60 hover:text-teal-700 transition-colors" aria-label="Open website">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            {matched && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link href={`/scans/${matched.domainId}`} className="p-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-500/25 text-teal-600/60 hover:text-teal-700 transition-colors" aria-label="Open scan">
                                    <Info className="h-3 w-3" />
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">Open scan</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
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
          {uniquenessExcerpts.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-orange-600 dark:text-orange-400">
                  {uniquenessExcerpts.length}
                </span>{" "}
                {uniquenessExcerpts.length === 1 ? "sentence" : "sentences"} flagged
                for uniqueness-related language across all pages.
              </p>
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
    </div>
  );
}

// =============================================================================
// Cluster Graph Visualization
// =============================================================================

function scoreToColor(score: number): string {
  if (score >= 85) return "hsl(0, 72%, 51%)";
  if (score >= 70) return "hsl(25, 95%, 53%)";
  if (score >= 40) return "hsl(45, 93%, 47%)";
  return "hsl(142, 71%, 45%)";
}

interface GraphNode {
  domainId: string;
  url: string;
  score: number;
  sharedCount: number;
  x: number;
  y: number;
}

const GRAPH_VW = 1000;
const GRAPH_VH = 700;

function computeNodePositions(count: number): { x: number; y: number }[] {
  const cx = GRAPH_VW / 2;
  const cy = GRAPH_VH / 2;

  if (count <= 1) return [{ x: cx, y: cy }];
  if (count === 2) return [{ x: cx, y: cy }, { x: cx, y: GRAPH_VH - 140 }];

  // Hub-and-spoke: first node at center, rest on radial ring
  const others = count - 1;
  const baseRadius = Math.min(GRAPH_VW, GRAPH_VH) * 0.34;
  const radius = others > 8 ? baseRadius * (1 + (others - 8) * 0.04) : baseRadius;
  const positions: { x: number; y: number }[] = [{ x: cx, y: cy }];
  for (let i = 0; i < others; i++) {
    const angle = (2 * Math.PI * i) / others - Math.PI / 2;
    positions.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return positions;
}

function ClusterGraphNode({ node }: { node: GraphNode }) {
  return (
    <div className="bg-background border rounded-lg shadow-sm px-3 py-2.5 text-center min-w-[150px] max-w-[220px] cursor-pointer transition-all duration-200 hover:shadow-md">
      <div className="flex items-center justify-center gap-1.5 mb-1.5">
        <Globe className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
        <span className="text-xs font-semibold truncate">{node.url}</span>
        <a
          href={`https://${node.url}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground/50 hover:text-teal-600 transition-colors"
          onClick={(e) => e.stopPropagation()}
          title="Open website"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
        {node.domainId && (
          <Link
            href={`/scans/${node.domainId}`}
            className="text-muted-foreground/50 hover:text-teal-600 transition-colors"
            onClick={(e) => e.stopPropagation()}
            title="Open scan"
          >
            <Info className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <ScoreBadge score={node.score} />
        {node.sharedCount > 0 && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {node.sharedCount} shared {node.sharedCount === 1 ? "sentence" : "sentences"}
          </span>
        )}
      </div>
    </div>
  );
}

function ClusterGraph({
  domainId,
  domainUrl,
  clusterMembers,
  clusterPairs,
  crossLinks = [],
  topSimilar,
}: {
  domainId: string;
  domainUrl: string;
  clusterMembers: string[];
  clusterPairs: PairData[];
  crossLinks?: PairData[];
  topSimilar: SimilaritySummary["topSimilar"];
}) {
  const NODE_INSET = 80;
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Build nodes: hub + direct spokes (score >= 50) + 2nd-degree nodes from cross-links
  const connectedUrlSet = new Set<string>([domainUrl]);
  for (const p of clusterPairs) {
    if (p.compositeScore >= 50) {
      connectedUrlSet.add(p.domainAUrl);
      connectedUrlSet.add(p.domainBUrl);
    }
  }

  // Classify cross-link nodes by degree
  // Only show outer nodes connected through visible spokes (score >= 50 with hub)
  const secondDegreeUrls = new Set<string>();
  const thirdDegreeUrls = new Set<string>();

  // First pass: find outer nodes connected to a visible spoke
  for (const p of crossLinks) {
    const aIsDirect = connectedUrlSet.has(p.domainAUrl);
    const bIsDirect = connectedUrlSet.has(p.domainBUrl);
    if (aIsDirect && !bIsDirect) {
      secondDegreeUrls.add(p.domainBUrl);
    } else if (bIsDirect && !aIsDirect) {
      secondDegreeUrls.add(p.domainAUrl);
    }
  }

  // Second pass: find 3rd-degree nodes (connected to 2nd-degree but not direct or 2nd-degree)
  const knownUrls = new Set([...connectedUrlSet, ...secondDegreeUrls]);
  for (const p of crossLinks) {
    const aIs2nd = secondDegreeUrls.has(p.domainAUrl);
    const bIs2nd = secondDegreeUrls.has(p.domainBUrl);
    const aIsNew = !knownUrls.has(p.domainAUrl);
    const bIsNew = !knownUrls.has(p.domainBUrl);
    if (aIs2nd && bIsNew) thirdDegreeUrls.add(p.domainBUrl);
    if (bIs2nd && aIsNew) thirdDegreeUrls.add(p.domainAUrl);
  }

  const directUrls = [domainUrl, ...clusterMembers.filter((u) => connectedUrlSet.has(u))];
  const directPositions = computeNodePositions(directUrls.length);

  // Map each outer node to its parent (the node it's connected through)
  const outerParent = new Map<string, string>();
  for (const p of crossLinks) {
    const aIsDirect = connectedUrlSet.has(p.domainAUrl);
    const bIsDirect = connectedUrlSet.has(p.domainBUrl);
    // 2nd-degree parent mapping (spoke → 2nd-degree)
    if (aIsDirect && secondDegreeUrls.has(p.domainBUrl) && !outerParent.has(p.domainBUrl)) {
      outerParent.set(p.domainBUrl, p.domainAUrl);
    }
    if (bIsDirect && secondDegreeUrls.has(p.domainAUrl) && !outerParent.has(p.domainAUrl)) {
      outerParent.set(p.domainAUrl, p.domainBUrl);
    }
    // 3rd-degree parent mapping (2nd-degree → 3rd-degree)
    const aIs2nd = secondDegreeUrls.has(p.domainAUrl);
    const bIs2nd = secondDegreeUrls.has(p.domainBUrl);
    if (aIs2nd && thirdDegreeUrls.has(p.domainBUrl) && !outerParent.has(p.domainBUrl)) {
      outerParent.set(p.domainBUrl, p.domainAUrl);
    }
    if (bIs2nd && thirdDegreeUrls.has(p.domainAUrl) && !outerParent.has(p.domainAUrl)) {
      outerParent.set(p.domainAUrl, p.domainBUrl);
    }
  }

  // Build position map for direct nodes
  const positionByUrl = new Map<string, { x: number; y: number }>();
  directUrls.forEach((url, i) => positionByUrl.set(url, directPositions[i]));

  // Position outer nodes outward from their parent, along the hub→parent ray
  const cx = GRAPH_VW / 2;
  const cy = GRAPH_VH / 2;
  const OUTER_OFFSET = 210;
  const parentChildCount = new Map<string, number>();

  function positionOuterNodes(urls: Set<string>) {
    for (const url of urls) {
      const parentUrl = outerParent.get(url);
      const parentPos = parentUrl ? positionByUrl.get(parentUrl) : null;
      if (parentPos) {
        const dx = parentPos.x - cx;
        const dy = parentPos.y - cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const childIdx = parentChildCount.get(parentUrl!) || 0;
        parentChildCount.set(parentUrl!, childIdx + 1);
        // Wide fan: spread children with ~50° separation
        const totalChildren = [...urls].filter((u) => outerParent.get(u) === parentUrl).length;
        const fanAngle = totalChildren <= 1 ? 0 : ((childIdx / (totalChildren - 1)) - 0.5) * 1.8;
        const cosF = Math.cos(fanAngle);
        const sinF = Math.sin(fanAngle);
        const fx = ux * cosF - uy * sinF;
        const fy = ux * sinF + uy * cosF;
        positionByUrl.set(url, {
          x: parentPos.x + fx * OUTER_OFFSET,
          y: parentPos.y + fy * OUTER_OFFSET,
        });
      } else {
        positionByUrl.set(url, { x: GRAPH_VW - 100, y: GRAPH_VH - 100 });
      }
    }
  }

  // Position 2nd-degree first so 3rd-degree can use their positions
  positionOuterNodes(secondDegreeUrls);
  positionOuterNodes(thirdDegreeUrls);

  const allUrls = [...directUrls, ...Array.from(secondDegreeUrls), ...Array.from(thirdDegreeUrls)];

  const nodes: GraphNode[] = allUrls.map((url) => {
    let nodeScore = 0;
    let sharedCount = 0;

    if (url === domainUrl) {
      const maxPair = clusterPairs.reduce((best, p) =>
        p.compositeScore > (best?.compositeScore ?? 0) ? p : best, clusterPairs[0]);
      nodeScore = maxPair?.compositeScore ?? 0;
      sharedCount = clusterPairs.reduce((s, p) => s + p.sharedSentenceCount, 0);
    } else if (secondDegreeUrls.has(url) || thirdDegreeUrls.has(url)) {
      // 2nd/3rd-degree node: score from cross-link
      const crossPair = crossLinks.find(
        (p) => p.domainAUrl === url || p.domainBUrl === url
      );
      nodeScore = crossPair?.compositeScore ?? 0;
      sharedCount = crossPair?.sharedSentenceCount ?? 0;
    } else {
      const pair = clusterPairs.find(
        (p) => p.domainAUrl === url || p.domainBUrl === url
      );
      nodeScore = pair?.compositeScore ?? 0;
      sharedCount = pair?.sharedSentenceCount ?? 0;
    }

    const matched = topSimilar.find((t) => t.url === url);
    // For outer nodes not in topSimilar, find domainId from cross-links
    let did = matched?.domainId ?? "";
    if (!did && url !== domainUrl) {
      for (const p of crossLinks) {
        if (p.domainAUrl === url) { did = p.domainAId; break; }
        if (p.domainBUrl === url) { did = p.domainBId; break; }
      }
    }
    if (!did && url === domainUrl) did = domainId;
    const pos = positionByUrl.get(url) || { x: cx, y: cy };

    return {
      domainId: did,
      url,
      score: nodeScore,
      sharedCount,
      x: pos.x,
      y: pos.y,
    };
  });

  const nodeByUrl = new Map(nodes.map((n) => [n.url, n]));

  // Build edges from cluster pairs (hub → spoke)
  type EdgeData = { nA: GraphNode; nB: GraphNode; score: number; topPage: { label: string; score: number } | null; isCrossLink: boolean };

  const hubEdges = clusterPairs
    .filter((p) => p.compositeScore >= 50)
    .map((p) => {
      const nA = nodeByUrl.get(p.domainAUrl);
      const nB = nodeByUrl.get(p.domainBUrl);
      if (!nA || !nB) return null;

      let topPage: { label: string; score: number } | null = null;
      if (p.pageScores && p.pageScores.length > 0) {
        const sorted = [...p.pageScores].sort((a, b) => b.score - a.score);
        topPage = { label: sorted[0].label, score: sorted[0].score };
      }

      return { nA, nB, score: p.compositeScore, topPage, isCrossLink: false };
    })
    .filter(Boolean) as EdgeData[];

  // Build cross-link edges (spoke ↔ spoke)
  const hubEdgeSet = new Set(hubEdges.map((e) => [e.nA.url, e.nB.url].sort().join("|")));
  const crossEdges = crossLinks
    .filter((p) => p.compositeScore >= 50)
    .map((p) => {
      const nA = nodeByUrl.get(p.domainAUrl);
      const nB = nodeByUrl.get(p.domainBUrl);
      if (!nA || !nB) return null;
      // Skip if already a hub edge
      const key = [nA.url, nB.url].sort().join("|");
      if (hubEdgeSet.has(key)) return null;

      let topPage: { label: string; score: number } | null = null;
      if (p.pageScores && p.pageScores.length > 0) {
        const sorted = [...p.pageScores].sort((a, b) => b.score - a.score);
        topPage = { label: sorted[0].label, score: sorted[0].score };
      }

      return { nA, nB, score: p.compositeScore, topPage, isCrossLink: true };
    })
    .filter(Boolean) as EdgeData[];

  const edges = [...hubEdges, ...crossEdges];

  // Selection-based highlighting
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

  // Zoom — native listener with passive:false to prevent browser scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(3, Math.max(0.4, z - e.deltaY * 0.001)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }, []);

  const handlePointerUp = useCallback(() => { isPanning.current = false; }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedUrl(null);
  }, []);

  const toPct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <div className="relative w-full rounded-xl border bg-muted/40 overflow-hidden" style={{ minHeight: 420 }}>
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-lg border shadow-sm px-1 py-0.5">
        <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors" title="Zoom in">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="7" y1="3" x2="7" y2="11"/><line x1="3" y1="7" x2="11" y2="7"/></svg>
        </button>
        <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-center select-none">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors" title="Zoom out">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="7" x2="11" y2="7"/></svg>
        </button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button onClick={resetView} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors text-[10px] font-medium" title="Reset view">
          Reset
        </button>
      </div>

      {/* Pannable + zoomable canvas */}
      <div
        ref={containerRef}
        className="relative w-full cursor-grab active:cursor-grabbing"
        style={{ aspectRatio: `${GRAPH_VW} / ${GRAPH_VH}`, minHeight: 420 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={() => setSelectedUrl(null)}
      >
        <div
          className="absolute inset-0 origin-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            zoom,
            transition: isPanning.current ? "none" : "transform 0.15s ease-out, zoom 0.15s ease-out",
          }}
        >
          {/* SVG edges */}
          <svg
            viewBox={`0 0 ${GRAPH_VW} ${GRAPH_VH}`}
            className="absolute inset-0 w-full h-full pointer-events-none"
            shapeRendering="geometricPrecision"
          >
            {edges.map((edge, i) => {
              const dx = edge.nB.x - edge.nA.x;
              const dy = edge.nB.y - edge.nA.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;
              const ux = dx / len;
              const uy = dy / len;
              const inset = edge.isCrossLink ? 50 : NODE_INSET;
              const x1 = edge.nA.x + ux * inset;
              const y1 = edge.nA.y + uy * inset;
              const x2 = edge.nB.x - ux * inset;
              const y2 = edge.nB.y - uy * inset;
              const color = scoreToColor(edge.score);
              const highlighted = isEdgeHighlighted(edge);
              const isCross = edge.isCrossLink;
              const strokeWidth = isCross ? 1.5 : edge.score >= 85 ? 2.5 : edge.score >= 70 ? 2 : 1.5;
              const dashArray = "14,10";

              return (
                <g key={i} style={{ transition: "opacity 0.2s" }} opacity={highlighted ? 1 : 0.12}>
                  {/* Glow */}
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={color}
                    strokeWidth={strokeWidth + 3}
                    strokeDasharray={dashArray}
                    strokeOpacity={isCross ? "0.08" : "0.10"}
                    strokeLinecap="round"
                  >
                    <animate attributeName="stroke-dashoffset" from="0" to={isCross ? "-28" : "-48"} dur={isCross ? "4s" : "3s"} repeatCount="indefinite" />
                  </line>
                  {/* Main line */}
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={color}
                    strokeWidth={highlighted && selectedUrl ? strokeWidth + 0.5 : strokeWidth}
                    strokeDasharray={dashArray}
                    strokeOpacity={highlighted ? "0.55" : "0.15"}
                    strokeLinecap="round"
                  >
                    <animate attributeName="stroke-dashoffset" from="0" to={isCross ? "-28" : "-48"} dur={isCross ? "4s" : "3s"} repeatCount="indefinite" />
                  </line>
                  {/* Labels rendered as HTML overlay below */}
                </g>
              );
            })}
          </svg>

          {/* Node cards */}
          {nodes.map((node) => {
            const highlighted = isNodeHighlighted(node.url);
            const isSelected = selectedUrl === node.url;
            return (
              <div
                key={node.domainId || node.url}
                className="absolute z-10"
                style={{
                  left: toPct(node.x, GRAPH_VW),
                  top: toPct(node.y, GRAPH_VH),
                  opacity: highlighted ? 1 : 0.25,
                  transition: "opacity 0.2s, transform 0.2s",
                  transform: `translate(-50%, -50%) ${isSelected ? "scale(1.05)" : "scale(1)"}`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedUrl(isSelected ? null : node.url);
                }}
              >
                <ClusterGraphNode node={node} />
              </div>
            );
          })}

          {/* Edge labels — rendered above node cards */}
          {edges.map((edge, i) => {
            const dx = edge.nB.x - edge.nA.x;
            const dy = edge.nB.y - edge.nA.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len === 0) return null;
            const ux = dx / len;
            const uy = dy / len;
            const isCross = edge.isCrossLink;
            const inset = isCross ? 50 : NODE_INSET;
            const x1 = edge.nA.x + ux * inset;
            const y1 = edge.nA.y + uy * inset;
            const x2 = edge.nB.x - ux * inset;
            const y2 = edge.nB.y - uy * inset;
            // Stagger labels along each edge to avoid overlap
            const t = isCross ? 0.4 + (i % 3) * 0.1 : 0.65 + (i % 3) * 0.1;
            const labelAnchorX = x1 + (x2 - x1) * t;
            const labelAnchorY = y1 + (y2 - y1) * t;
            const px = -uy;
            const py = ux;
            const LABEL_OFFSET = isCross ? 18 : 22;
            const sign = py >= 0 ? 1 : -1;
            const labelX = labelAnchorX + px * LABEL_OFFSET * sign;
            const labelY = labelAnchorY + py * LABEL_OFFSET * sign;
            const color = scoreToColor(edge.score);
            const highlighted = isEdgeHighlighted(edge);

            return (
              <div
                key={`label-${i}`}
                className="absolute z-20 pointer-events-none"
                style={{
                  left: toPct(labelX, GRAPH_VW),
                  top: toPct(labelY, GRAPH_VH),
                  transform: "translate(-50%, -50%)",
                  opacity: highlighted ? (isCross ? 0.85 : 1) : 0.1,
                  transition: "opacity 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color, fontSize: isCross ? 11 : 14, fontWeight: isCross ? 600 : 800, lineHeight: 1 }}>
                    {edge.score}%
                  </span>
                  {edge.topPage && (
                    <span style={{
                      background: "rgba(255,255,255,0.9)",
                      backdropFilter: "blur(4px)",
                      borderRadius: 8,
                      padding: "1px 7px",
                      fontSize: 10,
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
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-4 right-4 z-20 flex items-center gap-5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="24" height="2" className="flex-shrink-0">
            <line x1="0" y1="1" x2="24" y2="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4,3" strokeOpacity="0.6" />
          </svg>
          Direct link
        </span>
        {crossEdges.length > 0 && (
          <span className="flex items-center gap-1.5">
            <svg width="24" height="2" className="flex-shrink-0">
              <line x1="0" y1="1" x2="24" y2="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2,3" strokeOpacity="0.4" />
            </svg>
            Cross-link
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border bg-background flex-shrink-0" />
          Website node
        </span>
        {selectedUrl ? (
          <span className="ml-auto opacity-70">
            Showing connections for {selectedUrl} · Click background to reset
          </span>
        ) : (
          <span className="ml-auto opacity-70">
            {nodes.length} sites · {hubEdges.length} direct{crossEdges.length > 0 ? ` + ${crossEdges.length} cross` : ""} · Click a node to focus
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Clusters Tab
// =============================================================================

function ClustersTab({
  domainId,
  domainUrl,
  summary,
  pairs,
  crossLinks = [],
}: {
  domainId: string;
  domainUrl: string;
  summary: SimilaritySummary;
  pairs: PairData[];
  crossLinks?: PairData[];
}) {
  if (summary.clusterSize === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <Network className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="font-medium text-foreground">No cluster found</p>
        <p className="text-sm mt-1">
          This domain does not share enough textual similarity with any other domains to form a cluster.
        </p>
      </div>
    );
  }

  // Build pairs within the cluster (high-similarity only)
  const clusterPairs = pairs.filter((p) => {
    const otherUrl = p.domainAId === domainId ? p.domainBUrl : p.domainAUrl;
    return summary.clusterMembers.includes(otherUrl) && p.compositeScore >= 50;
  });

  // Only count members that have at least one edge >= 50
  const connectedMembers = new Set<string>([domainUrl]);
  for (const p of clusterPairs) {
    connectedMembers.add(p.domainAUrl);
    connectedMembers.add(p.domainBUrl);
  }
  // Count 2nd-degree nodes from cross-links
  const secondDegreeCount = crossLinks.filter((p) => {
    const aNew = !connectedMembers.has(p.domainAUrl);
    const bNew = !connectedMembers.has(p.domainBUrl);
    return (connectedMembers.has(p.domainAUrl) && bNew) || (connectedMembers.has(p.domainBUrl) && aNew);
  }).reduce((urls, p) => {
    if (!connectedMembers.has(p.domainAUrl)) urls.add(p.domainAUrl);
    if (!connectedMembers.has(p.domainBUrl)) urls.add(p.domainBUrl);
    return urls;
  }, new Set<string>()).size;
  const visibleCount = connectedMembers.size + secondDegreeCount;

  const clusterScores = clusterPairs.map((p) => p.compositeScore);
  const avgScore = clusterScores.length > 0
    ? Math.round(clusterScores.reduce((s, v) => s + v, 0) / clusterScores.length)
    : 0;
  const maxScore = clusterScores.length > 0 ? Math.max(...clusterScores) : 0;

  // Total shared sentences in cluster
  const totalShared = clusterPairs.reduce((s, p) => s + p.sharedSentenceCount, 0);
  const avgSharedPerPair = clusterPairs.length > 0 ? Math.round(totalShared / clusterPairs.length) : 0;

  // Find an example shared sentence
  const exampleSentence = clusterPairs.find((p) => p.sharedSentences.length > 0)?.sharedSentences[0];

  // Confidence label
  const confidence = avgScore >= 70 ? "High" : "Moderate";

  return (
    <div className="space-y-6">
      {/* Cluster accordion-style header */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Cluster 1</span>
            <Badge variant="secondary" className="text-[10px]">
              {visibleCount} sites
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Avg</span>
            <ScoreBadge score={avgScore} />
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">Max</span>
            <ScoreBadge score={maxScore} />
          </div>
        </div>

        {/* Summary explanation */}
        <div className="px-4 py-3 border-t border-l-4 border-l-primary bg-card">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold">Summary</span>
            <Badge variant={confidence === "High" ? "danger-subtle" : "warning-subtle"} className="text-[10px]">
              {confidence}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            These {visibleCount} websites share common sentences on their pages,
            with an average of {avgSharedPerPair} identical {avgSharedPerPair === 1 ? "sentence" : "sentences"} per pair.
            The content between these websites is {avgScore >= 70 ? "very similar" : "moderately similar"} with
            an avg. similarity score of {avgScore}.
          </p>
          {exampleSentence && (
            <p className="text-sm text-muted-foreground/60 italic mt-2">
              e.g. &ldquo;{exampleSentence.length > 80 ? exampleSentence.slice(0, 80) + "..." : exampleSentence}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Cluster Graph */}
      <ClusterGraph
        domainId={domainId}
        domainUrl={domainUrl}
        clusterMembers={summary.clusterMembers}
        clusterPairs={clusterPairs}
        crossLinks={crossLinks}
        topSimilar={summary.topSimilar}
      />

    </div>
  );
}

// =============================================================================
// Content Similarity Tab — Shared Sentences + Side-by-Side
// =============================================================================

// Build aligned rows for side-by-side display:
// Shared sentences appear next to each other, unique text is collapsed between them.
function buildAlignedRows(
  textA: string,
  textB: string,
  sharedFps: Set<string>,
): Array<
  | { type: "shared"; sentenceA: string; sentenceB: string }
  | { type: "unique"; sentencesA: string[]; sentencesB: string[] }
> {
  const sentencesA = splitSentences(textA);
  const sentencesB = splitSentences(textB);

  // Build fingerprint → sentence maps, preserving order
  const fpToIdxA = new Map<string, number>();
  sentencesA.forEach((s, i) => {
    const fp = fingerprint(s);
    if (sharedFps.has(fp) && !fpToIdxA.has(fp)) fpToIdxA.set(fp, i);
  });
  const fpToIdxB = new Map<string, number>();
  sentencesB.forEach((s, i) => {
    const fp = fingerprint(s);
    if (sharedFps.has(fp) && !fpToIdxB.has(fp)) fpToIdxB.set(fp, i);
  });

  // Find shared fingerprints present in both, ordered by first appearance in A
  const sharedOrdered: string[] = [];
  const seen = new Set<string>();
  for (const s of sentencesA) {
    const fp = fingerprint(s);
    if (sharedFps.has(fp) && fpToIdxB.has(fp) && !seen.has(fp)) {
      seen.add(fp);
      sharedOrdered.push(fp);
    }
  }

  const rows: Array<
    | { type: "shared"; sentenceA: string; sentenceB: string }
    | { type: "unique"; sentencesA: string[]; sentencesB: string[] }
  > = [];

  let cursorA = 0;
  let cursorB = 0;

  for (const fp of sharedOrdered) {
    const idxA = fpToIdxA.get(fp)!;
    const idxB = fpToIdxB.get(fp)!;

    // Collect unique sentences before this shared one
    const uniqueA = sentencesA.slice(cursorA, idxA).filter((s) => !sharedFps.has(fingerprint(s)));
    const uniqueB = sentencesB.slice(cursorB, idxB).filter((s) => !sharedFps.has(fingerprint(s)));

    if (uniqueA.length > 0 || uniqueB.length > 0) {
      rows.push({ type: "unique", sentencesA: uniqueA, sentencesB: uniqueB });
    }

    rows.push({ type: "shared", sentenceA: sentencesA[idxA], sentenceB: sentencesB[idxB] });
    cursorA = idxA + 1;
    cursorB = idxB + 1;
  }

  // Remaining unique sentences after last shared
  const trailingA = sentencesA.slice(cursorA).filter((s) => !sharedFps.has(fingerprint(s)));
  const trailingB = sentencesB.slice(cursorB).filter((s) => !sharedFps.has(fingerprint(s)));
  if (trailingA.length > 0 || trailingB.length > 0) {
    rows.push({ type: "unique", sentencesA: trailingA, sentencesB: trailingB });
  }

  return rows;
}

function UniqueBlock({ sentences }: { sentences: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (sentences.length === 0) {
    return <div className="text-xs text-muted-foreground/40 italic px-2 py-1">—</div>;
  }
  const preview = sentences.slice(0, 2);
  const rest = sentences.slice(2);
  return (
    <div className="px-2 py-1 space-y-0.5">
      {(expanded ? sentences : preview).map((s, i) => (
        <p key={i} className="text-sm leading-relaxed text-muted-foreground">{s}</p>
      ))}
      {!expanded && rest.length > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          +{rest.length} more sentence{rest.length > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

function AlignedSideBySide({
  textA,
  textB,
  sharedFps,
  urlA,
  urlB,
  pageUrlA,
  pageUrlB,
}: {
  textA: string;
  textB: string;
  sharedFps: Set<string>;
  urlA: string;
  urlB: string;
  pageUrlA?: string;
  pageUrlB?: string;
}) {
  const rows = useMemo(() => buildAlignedRows(textA, textB, sharedFps), [textA, textB, sharedFps]);

  if (rows.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-6 text-sm italic">
        No text available for comparison.
      </div>
    );
  }

  return (
    <div className="divide-y">
      {/* Column headers */}
      <div className="grid grid-cols-2 divide-x">
        <a href={pageUrlA || `https://${urlA}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 px-3 py-2 flex items-center gap-1.5 hover:underline cursor-pointer">
          <Globe className="h-3 w-3" />
          {urlA}
        </a>
        <a href={pageUrlB || `https://${urlB}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 px-3 py-2 flex items-center gap-1.5 hover:underline cursor-pointer">
          <Globe className="h-3 w-3" />
          {urlB}
        </a>
      </div>
      {rows.map((row, i) => {
        if (row.type === "shared") {
          return (
            <div key={i} className="grid grid-cols-2 divide-x bg-orange-50/60 dark:bg-orange-500/5">
              <div className="px-3 py-1.5">
                <p className="text-sm leading-relaxed px-2 py-0.5 rounded bg-orange-100/80 dark:bg-orange-500/15 border-l-2 border-orange-400">
                  {row.sentenceA}
                </p>
              </div>
              <div className="px-3 py-1.5">
                <p className="text-sm leading-relaxed px-2 py-0.5 rounded bg-orange-100/80 dark:bg-orange-500/15 border-l-2 border-orange-400">
                  {row.sentenceB}
                </p>
              </div>
            </div>
          );
        }
        return (
          <div key={i} className="grid grid-cols-2 divide-x">
            <div className="px-3 py-1">
              <UniqueBlock sentences={row.sentencesA} />
            </div>
            <div className="px-3 py-1">
              <UniqueBlock sentences={row.sentencesB} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Full-text column with sentence-level highlighting (orange = shared, blue = keyword)
function TextColumn({
  url,
  text,
  sharedFps,
  sharedKeywords,
}: {
  url: string;
  text: string;
  sharedFps: Set<string>;
  sharedKeywords?: Set<string>;
}) {
  const cleaned = cleanAboutText(text);
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);

  return (
    <div className="p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 mb-3 flex items-center gap-1.5">
        <Globe className="h-3 w-3" />
        {url}
        <a href={`https://${url}`} target="_blank" rel="noopener noreferrer" className="opacity-40 hover:opacity-100 transition-opacity"><ExternalLink className="h-3 w-3" /></a>
      </div>
      {paragraphs.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No text available</p>
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

function HighlightedParagraph({
  text,
  sharedFps,
  sharedKeywords,
}: {
  text: string;
  sharedFps: Set<string>;
  sharedKeywords?: Set<string>;
}) {
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
              className="bg-orange-100/80 dark:bg-orange-500/15 text-foreground rounded-sm px-0.5 border-l-2 border-orange-400"
            >
              {part}{" "}
            </mark>
          );
        }
        // Highlight shared keywords in non-shared sentences
        if (sharedKeywords && sharedKeywords.size > 0) {
          const tokens = part.split(/\b/);
          const hasKw = tokens.some((t) => {
            const lower = t.toLowerCase().replace(/[^a-z]/g, "");
            return lower.length >= 3 && sharedKeywords.has(lower);
          });
          if (hasKw) {
            return (
              <span key={i}>
                {tokens.map((token, j) => {
                  const lower = token.toLowerCase().replace(/[^a-z]/g, "");
                  if (lower.length >= 3 && sharedKeywords.has(lower)) {
                    return (
                      <mark key={j} className="bg-blue-100/70 dark:bg-blue-500/15 text-foreground rounded-sm">
                        {token}
                      </mark>
                    );
                  }
                  return <span key={j}>{token}</span>;
                })}{" "}
              </span>
            );
          }
        }
        return <span key={i}>{part} </span>;
      })}
    </p>
  );
}

function SideBySidePairCard({
  pair,
  domainMap,
  targetDomainId,
  defaultExpanded = false,
}: {
  pair: PairData;
  domainMap: Map<string, DomainText>;
  targetDomainId: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Default to the highest-scoring page type
  const bestPageType = pair.pageScores
    ?.sort((a, b) => b.score - a.score)[0]?.pageType || "about_page";
  const [activePageType, setActivePageType] = useState(bestPageType);

  const otherUrl = pair.domainAId === targetDomainId ? pair.domainBUrl : pair.domainAUrl;
  const otherDomainId = pair.domainAId === targetDomainId ? pair.domainBId : pair.domainAId;
  const domA = domainMap.get(pair.domainAUrl);
  const domB = domainMap.get(pair.domainBUrl);

  const getPageText = (dom: DomainText | undefined, pageKey: string) => {
    if (!dom) return "";
    if (pageKey === "about_page") return dom.aboutText || "";
    const pt = dom.pageTexts?.find((p) => p.key === pageKey);
    return pt?.text || "";
  };

  const textA = getPageText(domA, activePageType);
  const textB = getPageText(domB, activePageType);

  const getPageUrl = (dom: DomainText | undefined, pageKey: string): string | undefined => {
    if (!dom) return undefined;
    if (pageKey === "about_page") return dom.aboutPageUrl || undefined;
    return dom.pageTexts?.find((p) => p.key === pageKey)?.pageUrl;
  };
  const pageUrlA = getPageUrl(domA, activePageType);
  const pageUrlB = getPageUrl(domB, activePageType);

  const availablePageTypes = useMemo(() => {
    if (!domA?.pageTexts || !domB?.pageTexts) return [];
    const keysA = new Set(domA.pageTexts.map((p) => p.key));
    if (domA.aboutText) keysA.add("about_page");
    const keysB = new Set(domB.pageTexts.map((p) => p.key));
    if (domB.aboutText) keysB.add("about_page");
    const PAGE_LABELS: Record<string, string> = {
      homepage_text: "Homepage", about_page: "About Us", contact_page: "Contact Us",
      privacy_page: "Privacy Policy", refund_page: "Refund Policy", terms_page: "Terms of Service",
    };
    const common = Array.from(keysA).filter((k) => keysB.has(k));
    return common
      .map((k) => ({
        key: k,
        label: PAGE_LABELS[k] || k,
        score: pair.pageScores?.find((ps) => ps.pageType === k)?.score,
      }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [domA, domB, pair.pageScores]);

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

  // Shared keywords for blue highlight
  const sharedKeywords = useMemo(() => {
    if (!textA || !textB) return undefined;
    return getSharedKeywords(textA, textB);
  }, [textA, textB]);

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Pair header — both domain URLs with link icon */}
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
          <Globe className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
          <a
            href={`https://${otherUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium truncate text-teal-700 dark:text-teal-300 hover:text-teal-900 hover:underline transition-colors"
          >
            {otherUrl}
          </a>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          <ScoreBadge score={pair.compositeScore} />
        </div>
      </button>

      {/* Expanded: page type selector + side-by-side text columns */}
      {expanded && (
        <div>
          {availablePageTypes.length > 1 && (
            <div className="flex items-center px-4 py-2 border-t bg-muted/20 overflow-x-auto scrollbar-hide">
              {availablePageTypes.map((pt) => (
                <button
                  key={pt.key}
                  onClick={(e) => { e.stopPropagation(); setActivePageType(pt.key); }}
                  className={`flex-1 text-xs px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
                    activePageType === pt.key
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {pt.label}
                  {pt.score != null && (
                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                      activePageType === pt.key
                        ? "bg-primary/15 text-primary"
                        : "bg-foreground/10 text-muted-foreground"
                    }`}>{pt.score}%</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {/* Side-by-side — shared sentences aligned in rows */}
          <div className="border-t">
            {textA && textB ? (
              <AlignedSideBySide
                textA={textA}
                textB={textB}
                sharedFps={sharedFps}
                urlA={pair.domainAUrl}
                urlB={pair.domainBUrl}
                pageUrlA={pageUrlA}
                pageUrlB={pageUrlB}
              />
            ) : (
              <div className="grid grid-cols-2 divide-x">
                <TextColumn url={pair.domainAUrl} text={textA} sharedFps={sharedFps} sharedKeywords={sharedKeywords} />
                <TextColumn url={pair.domainBUrl} text={textB} sharedFps={sharedFps} sharedKeywords={sharedKeywords} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// -- Shared Sentences sub-view --
// Groups all shared sentences from pairs, similar to the website similarity page

interface SentenceGroup {
  domains: string[];
  sentences: string[];
}

function SharedSentencesView({
  pairs,
  targetDomainId,
  domainUrl,
}: {
  pairs: PairData[];
  targetDomainId: string;
  domainUrl: string;
}) {
  // Collect all shared sentences, track which domains share each
  const { groups, totalSentences, similarDomainCount, totalDomains } = useMemo(() => {
    const sentenceMap = new Map<string, { sentence: string; domains: Set<string> }>();

    for (const pair of pairs) {
      if (!pair.sharedSentences || pair.sharedSentences.length === 0) continue;
      const otherUrl = pair.domainAId === targetDomainId ? pair.domainBUrl : pair.domainAUrl;

      for (const s of pair.sharedSentences) {
        const fp = fingerprint(s);
        if (!sentenceMap.has(fp)) {
          sentenceMap.set(fp, { sentence: s, domains: new Set([domainUrl]) });
        }
        sentenceMap.get(fp)!.domains.add(otherUrl);
      }
    }

    // Group by domain set
    const groupMap = new Map<string, SentenceGroup>();
    for (const { sentence, domains } of sentenceMap.values()) {
      const sorted = [...domains].sort();
      const key = sorted.join("|");
      if (!groupMap.has(key)) {
        groupMap.set(key, { domains: sorted, sentences: [] });
      }
      groupMap.get(key)!.sentences.push(sentence);
    }

    const groups = Array.from(groupMap.values()).sort(
      (a, b) => b.domains.length - a.domains.length || b.sentences.length - a.sentences.length
    );

    const allOtherDomains = new Set<string>();
    for (const pair of pairs) {
      if (pair.sharedSentenceCount > 0) {
        const otherUrl = pair.domainAId === targetDomainId ? pair.domainBUrl : pair.domainAUrl;
        allOtherDomains.add(otherUrl);
      }
    }

    return {
      groups,
      totalSentences: sentenceMap.size,
      similarDomainCount: allOtherDomains.size,
      totalDomains: new Set(pairs.flatMap((p) => [p.domainAUrl, p.domainBUrl])).size,
    };
  }, [pairs, targetDomainId, domainUrl]);

  const [expandOverride, setExpandOverride] = useState<{ expanded: boolean; gen: number } | null>(null);

  if (totalSentences === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <Copy className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="font-medium text-foreground">No shared sentences found</p>
        <p className="text-sm mt-1">No sentences appear word-for-word on other domains&apos; pages.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="stat-card flex-1 min-w-[140px] border-l-4 border-l-transparent">
          <StatLabel label="Shared Sentences" tooltip="Sentences that appear word-for-word on other domains' pages" />
          <p className="stat-card-value">{totalSentences}</p>
        </div>
        <div className={`stat-card flex-1 min-w-[140px] border-l-4 ${similarDomainCount >= 3 ? "border-l-orange-500" : "border-l-transparent"}`}>
          <StatLabel label="Similar Domains" tooltip="Domains that share sentences with this one" />
          <p className="stat-card-value">
            <span className={similarDomainCount >= 3 ? "text-orange-600 dark:text-orange-400" : ""}>
              {similarDomainCount}
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {" "}/ {totalDomains}
            </span>
          </p>
        </div>
      </div>

      {/* Group toolbar */}
      {groups.length > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{groups.length} groups</span>
          <button
            onClick={() => setExpandOverride((prev) => ({
              expanded: prev ? !prev.expanded : false,
              gen: (prev?.gen ?? 0) + 1,
            }))}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1 rounded hover:bg-muted/50"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            {expandOverride?.expanded === false ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}

      {/* Sentence groups */}
      <div className="space-y-3 overflow-y-auto overscroll-contain pr-1" style={{ maxHeight: "800px" }}>
        {(() => {
          let runningIndex = 0;
          return groups.map((group, groupIdx) => {
            const globalIndex = runningIndex;
            runningIndex += group.sentences.length;
            const defaultExpanded = expandOverride != null ? expandOverride.expanded : groupIdx === 0;
            return (
              <SharedSentenceGroupCard
                key={`${group.domains.join("|")}-${expandOverride?.gen ?? "init"}`}
                group={group}
                globalIndex={globalIndex}
                totalDomains={totalDomains}
                defaultExpanded={defaultExpanded}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}

function SharedSentenceGroupCard({
  group,
  globalIndex,
  totalDomains,
  defaultExpanded,
}: {
  group: SentenceGroup;
  globalIndex: number;
  totalDomains: number;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [visibleCount, setVisibleCount] = useState(5);
  const visibleSentences = group.sentences.slice(0, expanded ? visibleCount : 0);
  const remainingCount = group.sentences.length - visibleCount;

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/30 bg-muted/30"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
          <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">
            {group.domains.length} of {totalDomains} domains
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {group.sentences.length} sentence{group.sentences.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="h-2 w-16 rounded-full bg-muted overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-orange-400"
              style={{ width: `${Math.min(100, (group.sentences.length / 10) * 100)}%` }}
            />
          </div>
        </div>
      </button>

      {expanded && (
        <div>
          {/* Domain chips */}
          <div className="px-4 py-2.5 border-t bg-muted/10 flex flex-wrap gap-2">
            {group.domains.map((url) => (
              <span
                key={url}
                className="inline-flex items-center gap-1 text-xs font-medium pl-3 pr-1.5 py-1 rounded-full bg-teal-50/60 dark:bg-teal-500/10 text-teal-700/80 dark:text-teal-300/80"
              >
                <Globe className="h-3 w-3 opacity-50" />
                <span className="pr-0.5">{url}</span>
                <span className="inline-flex items-center gap-0.5">
                  <a
                    href={`https://${url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-500/25 text-teal-600/50 hover:text-teal-700 transition-colors"
                    title="Open website"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              </span>
            ))}
          </div>

          {/* Sentence list */}
          <div className="border-t divide-y divide-border/50">
            {visibleSentences.map((sentence, i) => (
              <div key={i} className="px-4 py-3 flex gap-3 hover:bg-muted/20 transition-colors">
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground/60 pt-0.5 w-5 text-right flex-shrink-0 select-none">
                  {globalIndex + i + 1}
                </span>
                <p className="text-sm text-foreground/90 leading-relaxed flex-1">
                  <span className="text-muted-foreground/40 select-none">&ldquo;</span>
                  {sentence}
                  <span className="text-muted-foreground/40 select-none">&rdquo;</span>
                </p>
              </div>
            ))}
          </div>

          {/* Show more / show all */}
          {expanded && remainingCount > 0 && (
            <div className="px-4 py-2 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Showing {visibleCount} of {group.sentences.length} sentences
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setVisibleCount((prev) => Math.min(prev + 5, group.sentences.length))}
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded hover:bg-primary/5"
                >
                  Show {Math.min(5, remainingCount)} more
                </button>
                {remainingCount > 5 && (
                  <button
                    onClick={() => setVisibleCount(group.sentences.length)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/50"
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

// -- Side-by-Side sub-view --

function SideBySideSubView({
  pairs,
  domainTexts,
  targetDomainId,
}: {
  pairs: PairData[];
  domainTexts: DomainText[];
  targetDomainId: string;
}) {
  const domainMap = useMemo(
    () => new Map(domainTexts.map((d) => [d.url, d])),
    [domainTexts]
  );

  const relevantPairs = useMemo(
    () => [...pairs]
      .filter((p) => p.compositeScore >= 50)
      .sort((a, b) => b.compositeScore - a.compositeScore),
    [pairs]
  );

  const [visibleCount, setVisibleCount] = useState(5);
  const visiblePairs = relevantPairs.slice(0, visibleCount);
  const remainingCount = relevantPairs.length - visibleCount;

  const [expandOverride, setExpandOverride] = useState<{ expanded: boolean; gen: number } | null>(null);

  if (relevantPairs.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <Link2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="font-medium text-foreground">No comparable pairs</p>
        <p className="text-sm mt-1">No domains share enough sentences or similarity with this one.</p>
      </div>
    );
  }

  const totalShared = relevantPairs.reduce((s, p) => s + p.sharedSentenceCount, 0);
  const avgSimilarity = Math.round(relevantPairs.reduce((s, p) => s + p.compositeScore, 0) / relevantPairs.length);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="stat-card flex-1 min-w-[140px] border-l-4 border-l-transparent">
          <StatLabel label="Comparable Pairs" tooltip="Domain pairs with shared sentences or similarity above 40%" />
          <p className="stat-card-value">{relevantPairs.length}</p>
        </div>
        <div className={`stat-card flex-1 min-w-[140px] border-l-4 ${getScoreBorderLeftColor(avgSimilarity)}`}>
          <StatLabel label="Avg Similarity" tooltip="Average similarity score across comparable pairs" />
          <p className="stat-card-value">
            <span className={getScoreTextColor(avgSimilarity)}>{avgSimilarity}%</span>
          </p>
        </div>
        {totalShared > 0 && (
          <div className="stat-card flex-1 min-w-[140px] border-l-4 border-l-transparent">
            <StatLabel label="Shared Sentences" tooltip="Total shared sentences found across all comparable pairs" />
            <p className="stat-card-value">{totalShared}</p>
          </div>
        )}
      </div>

      {/* Toolbar */}
      {relevantPairs.length > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {visiblePairs.length} of {relevantPairs.length} pairs
          </span>
          <button
            onClick={() => setExpandOverride((prev) => ({
              expanded: prev ? !prev.expanded : false,
              gen: (prev?.gen ?? 0) + 1,
            }))}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 px-2 py-1 rounded hover:bg-muted/50"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            {expandOverride?.expanded === false ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}

      {/* Pair cards */}
      <div className="space-y-3 overflow-y-auto overscroll-contain pr-1" style={{ maxHeight: "800px" }}>
        {visiblePairs.map((pair, idx) => {
          const defaultExpanded = expandOverride != null ? expandOverride.expanded : idx === 0;
          return (
            <SideBySidePairCard
              key={`${pair.id}-${expandOverride?.gen ?? "init"}`}
              pair={pair}
              domainMap={domainMap}
              targetDomainId={targetDomainId}
              defaultExpanded={defaultExpanded}
            />
          );
        })}

        {remainingCount > 0 && (
          <div className="px-4 py-2.5 flex items-center justify-between bg-muted/20 rounded-lg border">
            <span className="text-xs text-muted-foreground">
              Showing {visiblePairs.length} of {relevantPairs.length} pairs
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVisibleCount((prev) => Math.min(prev + 5, relevantPairs.length))}
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded hover:bg-primary/5"
              >
                Show {Math.min(5, remainingCount)} more
              </button>
              {remainingCount > 5 && (
                <button
                  onClick={() => setVisibleCount(relevantPairs.length)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/50"
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

// -- Content Similarity Tab wrapper with sub-tabs --

function ContentSimilarityTab({
  pairs,
  domainTexts,
  targetDomainId,
  domainUrl,
}: {
  pairs: PairData[];
  domainTexts: DomainText[];
  targetDomainId: string;
  domainUrl: string;
}) {
  const [subTab, setSubTab] = useState("sidebyside");

  const totalShared = pairs.reduce((s, p) => s + p.sharedSentenceCount, 0);
  const relevantPairCount = pairs.filter(
    (p) => p.compositeScore >= 50
  ).length;

  const SUBTABS = useMemo(() => [
    {
      key: "sidebyside",
      label: "Side-by-Side",
      badge: relevantPairCount > 0 ? relevantPairCount : undefined,
    },
    {
      key: "shared",
      label: "Shared Sentences",
      badge: totalShared > 0 ? totalShared : undefined,
    },
  ], [totalShared, relevantPairCount]);

  return (
    <Tabs
      tabs={SUBTABS}
      activeTab={subTab}
      onTabChange={setSubTab}
      variant="compact"
    >
      <TabPanel tabKey="shared" activeTab={subTab}>
        <SharedSentencesView
          pairs={pairs}
          targetDomainId={targetDomainId}
          domainUrl={domainUrl}
        />
      </TabPanel>
      <TabPanel tabKey="sidebyside" activeTab={subTab}>
        <SideBySideSubView
          pairs={pairs}
          domainTexts={domainTexts}
          targetDomainId={targetDomainId}
        />
      </TabPanel>
    </Tabs>
  );
}

// =============================================================================
// Uniqueness Check Tab
// =============================================================================

function UniquenessCheckTab({
  domainId,
  domainUrl,
  domainTexts,
}: {
  domainId: string;
  domainUrl: string;
  domainTexts: DomainText[];
}) {
  const targetDomain = domainTexts.find((d) => d.domainId === domainId);

  // Scan all page texts (about, homepage, policies, etc.) for scam keywords
  const excerpts: { sentence: string; keyword: string }[] = [];
  const allTexts: string[] = [];
  if (targetDomain?.aboutText) allTexts.push(targetDomain.aboutText);
  for (const pt of targetDomain?.pageTexts || []) {
    if (pt.text) allTexts.push(pt.text);
  }

  for (const rawText of allTexts) {
    const cleaned = cleanAboutText(rawText);
    const sentences = cleaned
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      for (const keyword of SCAM_KEYWORDS) {
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(lower)) {
          if (!excerpts.some((e) => e.sentence === sentence)) {
            excerpts.push({ sentence, keyword });
          }
        }
      }
    }
  }

  const isFlagged = excerpts.length > 0;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className={`stat-card flex-1 min-w-[140px] border-l-4 ${isFlagged ? "border-l-orange-500" : "border-l-success"}`}>
          <StatLabel label="Status" tooltip="Whether this domain's About page contains uniqueness-related keywords" />
          <p className={`stat-card-value ${isFlagged ? "text-orange-600" : "text-success"}`}>
            {isFlagged ? "Flagged" : "Clean"}
          </p>
        </div>
        <div className="stat-card flex-1 min-w-[140px] border-l-4 border-l-transparent">
          <StatLabel label="Keyword Hits" tooltip={`Sentences containing: ${SCAM_KEYWORDS.map((k) => `"${k}"`).join(", ")}`} />
          <p className="stat-card-value">{excerpts.length}</p>
        </div>
      </div>

      {/* Flagged excerpts */}
      {isFlagged && (
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-3 bg-muted/30 border-b flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <a href={`https://${domainUrl}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-teal-700 dark:text-teal-300 hover:underline">{domainUrl}</a>
            <Badge variant="secondary" className="text-[10px]">
              {excerpts.length} {excerpts.length === 1 ? "hit" : "hits"}
            </Badge>
          </div>
          <div className="divide-y divide-border/50">
            {excerpts.map((excerpt, i) => (
              <div key={i} className="px-4 py-3 flex gap-3 hover:bg-muted/20 transition-colors">
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground/60 pt-0.5 w-5 text-right flex-shrink-0 select-none">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground/90 leading-relaxed flex-1">
                  <span className="text-muted-foreground/40 select-none">&ldquo;</span>
                  <HighlightedKeywordText text={excerpt.sentence} keywords={SCAM_KEYWORDS} />
                  <span className="text-muted-foreground/40 select-none">&rdquo;</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clean state */}
      {!isFlagged && (
        <div className="text-center text-muted-foreground py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Shield className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="font-medium text-foreground">No scam markers detected</p>
          <p className="text-sm mt-1">
            The About page does not contain known uniqueness-related keywords.
          </p>
        </div>
      )}
    </div>
  );
}

function HighlightedKeywordText({ text, keywords }: { text: string; keywords: string[] }) {
  const pattern = new RegExp(`(\\b(?:${keywords.join("|")})\\b)`, "gi");
  const parts = text.split(pattern);

  return (
    <span>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark key={i} className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-semibold px-0.5 rounded-sm">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

// =============================================================================
// Main Tabbed Component
// =============================================================================

const TAB_DEFS = [
  { key: "summary", label: "Summary" },
  { key: "clusters", label: "Clusters" },
  { key: "shared", label: "Content Similarity" },
  { key: "scam", label: "Uniqueness Check" },
];

export function SimilarityTabs({
  domainId,
  domainUrl,
  summary,
  pairs,
  crossLinks = [],
  domainTexts,
}: SimilarityTabsProps) {
  const [activeTab, setActiveTab] = useState("summary");

  const sharedSentenceCount = pairs.reduce((s, p) => s + p.sharedSentenceCount, 0);
  const clusterCount = summary.clusterSize > 0 ? 1 : 0;

  const tabs = TAB_DEFS.map((t) => {
    if (t.key === "clusters" && clusterCount > 0) {
      return { ...t, badge: clusterCount };
    }
    if (t.key === "shared" && sharedSentenceCount > 0) {
      return { ...t, badge: sharedSentenceCount };
    }
    return t;
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        Website Scam Analysis
      </h2>
      <Tabs
        className="bg-[hsl(220,14%,97.5%)] dark:bg-card rounded-xl p-4 sm:p-6"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
      <TabPanel tabKey="summary" activeTab={activeTab}>
        <SummaryTab
          domainId={domainId}
          domainUrl={domainUrl}
          summary={summary}
          pairs={pairs}
          domainTexts={domainTexts}
        />
      </TabPanel>
      <TabPanel tabKey="clusters" activeTab={activeTab}>
        <ClustersTab
          domainId={domainId}
          domainUrl={domainUrl}
          summary={summary}
          pairs={pairs}
          crossLinks={crossLinks}
        />
      </TabPanel>
      <TabPanel tabKey="shared" activeTab={activeTab}>
        <ContentSimilarityTab
          pairs={pairs}
          domainTexts={domainTexts}
          targetDomainId={domainId}
          domainUrl={domainUrl}
        />
      </TabPanel>
      <TabPanel tabKey="scam" activeTab={activeTab}>
        <UniquenessCheckTab
          domainId={domainId}
          domainUrl={domainUrl}
          domainTexts={domainTexts}
        />
      </TabPanel>
    </Tabs>
    </div>
  );
}
