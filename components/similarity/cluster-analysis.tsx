"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Users, Network, Globe, ExternalLink, ScanSearch, Copy, Check } from "lucide-react";
import { getScoreTextColor, getScoreBgColorSubtle } from "@/lib/utils";
import type { PairData } from "./similarity-tabs";

// =============================================================================
// Types
// =============================================================================

interface ClusterData {
  memberUrls: string[];
  memberIds: string[];
  pairs: PairData[];
  avgScore: number;
  maxScore: number;
  avgSharedPerPair: number;
  exampleSentence?: string;
}

interface DomainNode {
  id: string;
  url: string;
  degree: 1 | 2 | 3 | null;
  avgScore: number;
  connectionCount: number;
  strongestLink: { url: string; score: number } | null;
}

// =============================================================================
// Main Export
// =============================================================================

export function ClusterAnalysis({ allPairs }: { allPairs: PairData[] }) {
  // Compute clusters via union-find
  const clusters = useMemo(() => {
    if (allPairs.length === 0) return [];

    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b));
    };

    const idToUrl = new Map<string, string>();
    for (const p of allPairs) {
      idToUrl.set(p.domainAId, p.domainAUrl);
      idToUrl.set(p.domainBId, p.domainBUrl);
      union(p.domainAId, p.domainBId);
    }

    const groups = new Map<string, Set<string>>();
    for (const p of allPairs) {
      for (const id of [p.domainAId, p.domainBId]) {
        const root = find(id);
        if (!groups.has(root)) groups.set(root, new Set());
        groups.get(root)!.add(id);
      }
    }

    return [...groups.values()]
      .filter((g) => g.size >= 2)
      .sort((a, b) => b.size - a.size)
      .map((memberIds): ClusterData => {
        const ids = [...memberIds];
        const urls = ids.map((id) => idToUrl.get(id) || "");
        const pairs = allPairs.filter(
          (p) => memberIds.has(p.domainAId) && memberIds.has(p.domainBId)
        );
        const scores = pairs.map((p) => p.compositeScore);
        const avg = scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
        const max = scores.length > 0 ? Math.max(...scores) : 0;
        const totalShared = pairs.reduce((s, p) => s + p.sharedSentenceCount, 0);
        const avgShared = pairs.length > 0 ? Math.round(totalShared / pairs.length) : 0;
        const example = pairs.find((p) => p.sharedSentences.length > 0)?.sharedSentences[0];
        return { memberUrls: urls, memberIds: ids, pairs, avgScore: avg, maxScore: max, avgSharedPerPair: avgShared, exampleSentence: example };
      });
  }, [allPairs]);

  if (clusters.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <Network className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="font-medium text-foreground">No clusters found</p>
        <p className="text-sm mt-1">Domains don&apos;t share enough similarity to form clusters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {clusters.map((cluster, idx) => (
        <ClusterSection key={idx} cluster={cluster} index={idx + 1} />
      ))}
    </div>
  );
}

// =============================================================================
// Per-Cluster Section
// =============================================================================

function ClusterSection({ cluster, index }: { cluster: ClusterData; index: number }) {
  const confidence = cluster.avgScore >= 70 ? "High" : "Moderate";
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Find hub (most connections)
  const { hub, nodes } = useMemo(() => {
    const connCount = new Map<string, number>();
    const scoreSum = new Map<string, number>();
    const strongest = new Map<string, { url: string; score: number }>();
    const idToUrl = new Map<string, string>();

    for (let i = 0; i < cluster.memberIds.length; i++) {
      idToUrl.set(cluster.memberIds[i], cluster.memberUrls[i]);
    }

    for (const p of cluster.pairs) {
      connCount.set(p.domainAId, (connCount.get(p.domainAId) || 0) + 1);
      connCount.set(p.domainBId, (connCount.get(p.domainBId) || 0) + 1);
      scoreSum.set(p.domainAId, (scoreSum.get(p.domainAId) || 0) + p.compositeScore);
      scoreSum.set(p.domainBId, (scoreSum.get(p.domainBId) || 0) + p.compositeScore);

      const prevA = strongest.get(p.domainAId);
      if (!prevA || p.compositeScore > prevA.score) {
        strongest.set(p.domainAId, { url: p.domainBUrl, score: p.compositeScore });
      }
      const prevB = strongest.get(p.domainBId);
      if (!prevB || p.compositeScore > prevB.score) {
        strongest.set(p.domainBId, { url: p.domainAUrl, score: p.compositeScore });
      }
    }

    // Hub = most connections, tiebreak by avg score
    let hubId = cluster.memberIds[0];
    let maxConn = 0;
    for (const id of cluster.memberIds) {
      const c = connCount.get(id) || 0;
      if (c > maxConn || (c === maxConn && (scoreSum.get(id) || 0) > (scoreSum.get(hubId) || 0))) {
        maxConn = c;
        hubId = id;
      }
    }

    // Compute degrees from hub at threshold >= 80
    const THRESHOLD = 80;
    const pairLookup = new Map<string, number>();
    for (const p of cluster.pairs) {
      const key = [p.domainAId, p.domainBId].sort().join("|");
      pairLookup.set(key, p.compositeScore);
    }
    const getScore = (a: string, b: string) => {
      const key = [a, b].sort().join("|");
      return pairLookup.get(key) || 0;
    };

    const degree = new Map<string, 1 | 2 | 3>();
    degree.set(hubId, 1);

    // 1st degree: connected to hub >= threshold
    const first = new Set<string>();
    for (const id of cluster.memberIds) {
      if (id === hubId) continue;
      if (getScore(id, hubId) >= THRESHOLD) {
        degree.set(id, 1);
        first.add(id);
      }
    }

    // 2nd degree: connected to any 1st degree >= threshold
    const second = new Set<string>();
    for (const id of cluster.memberIds) {
      if (degree.has(id)) continue;
      for (const firstId of first) {
        if (getScore(id, firstId) >= THRESHOLD) {
          degree.set(id, 2);
          second.add(id);
          break;
        }
      }
    }

    // 3rd degree: connected to any 2nd degree >= threshold
    for (const id of cluster.memberIds) {
      if (degree.has(id)) continue;
      for (const secondId of second) {
        if (getScore(id, secondId) >= THRESHOLD) {
          degree.set(id, 3);
          break;
        }
      }
    }

    const nodeList: DomainNode[] = cluster.memberIds.map((id) => ({
      id,
      url: idToUrl.get(id) || "",
      degree: degree.get(id) || null,
      avgScore: (connCount.get(id) || 0) > 0
        ? Math.round((scoreSum.get(id) || 0) / (connCount.get(id) || 1))
        : 0,
      connectionCount: connCount.get(id) || 0,
      strongestLink: strongest.get(id) || null,
    }));

    // Sort: hub first, then by degree, then by avg score desc
    nodeList.sort((a, b) => {
      if (a.id === hubId) return -1;
      if (b.id === hubId) return 1;
      const da = a.degree ?? 99;
      const db = b.degree ?? 99;
      if (da !== db) return da - db;
      return b.avgScore - a.avgScore;
    });

    return { hub: hubId, nodes: nodeList };
  }, [cluster]);

  return (
    <div className="space-y-5">
      {/* Summary card */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Cluster {index}</span>
            <Badge variant="secondary" className="text-[10px]">
              {cluster.memberUrls.length} sites
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Avg</span>
            <span className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-md ${getScoreBgColorSubtle(cluster.avgScore)} ${getScoreTextColor(cluster.avgScore)}`}>
              {cluster.avgScore}
            </span>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">Max</span>
            <span className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-md ${getScoreBgColorSubtle(cluster.maxScore)} ${getScoreTextColor(cluster.maxScore)}`}>
              {cluster.maxScore}
            </span>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-l-4 border-l-primary bg-card">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold">Summary</span>
            <Badge variant={confidence === "High" ? "danger-subtle" : "warning-subtle"} className="text-[10px]">
              {confidence}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            These {cluster.memberUrls.length} websites share common sentences on their pages,
            with an average of {cluster.avgSharedPerPair} identical {cluster.avgSharedPerPair === 1 ? "sentence" : "sentences"} per pair.
            The content is {cluster.avgScore >= 70 ? "very similar" : "moderately similar"} with
            an avg. similarity score of {cluster.avgScore}.
          </p>
          {cluster.exampleSentence && (
            <p className="text-sm text-muted-foreground/60 italic mt-2">
              e.g. &ldquo;{cluster.exampleSentence.length > 80 ? cluster.exampleSentence.slice(0, 80) + "..." : cluster.exampleSentence}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* URL chips — outside summary card */}
      <ClusterUrlChips urls={cluster.memberUrls} nodes={nodes} selectedId={selectedId} setSelectedId={setSelectedId} />

      {/* Concentric Ring Graph */}
      <ConcentricRingGraph nodes={nodes} pairs={cluster.pairs} hubId={hub} selectedId={selectedId} setSelectedId={setSelectedId} />

      {/* Similarity Heatmap */}
      <SimilarityHeatmap nodes={nodes} pairs={cluster.pairs} hubId={hub} />
    </div>
  );
}

// =============================================================================
// Cluster URL Chips with Copy
// =============================================================================

function ClusterUrlChips({ urls, nodes, selectedId, setSelectedId }: {
  urls: string[];
  nodes: DomainNode[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urls.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [urls]);

  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-wrap gap-1.5 flex-1">
        {urls.map((url) => {
          const node = nodes.find((n) => n.url === url);
          const isSelected = node?.id === selectedId;
          return (
            <button
              key={url}
              onClick={() => setSelectedId(isSelected ? null : node?.id || null)}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                isSelected
                  ? "bg-emerald-600 text-white"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300"
              }`}
            >
              {url}
            </button>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {copied ? <span className="animate-in zoom-in-50 duration-150"><Check className="h-3.5 w-3.5 text-green-600" /></span> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {copied ? "Copied!" : "Copy URL list"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// =============================================================================
// Similarity Heatmap
// =============================================================================

function scoreColor(score: number): string {
  if (score >= 90) return "bg-red-500/80 text-white";
  if (score >= 80) return "bg-red-400/60 text-white";
  if (score >= 70) return "bg-orange-400/50 text-white";
  if (score >= 60) return "bg-amber-400/40 text-foreground";
  if (score >= 50) return "bg-yellow-300/40 text-foreground";
  return "bg-muted/30 text-muted-foreground/50";
}

function scoreColorHsl(score: number): string {
  if (score >= 90) return "hsl(0, 72%, 51%, 0.75)";
  if (score >= 80) return "hsl(0, 72%, 51%, 0.55)";
  if (score >= 70) return "hsl(25, 95%, 53%, 0.5)";
  if (score >= 60) return "hsl(38, 92%, 50%, 0.4)";
  if (score >= 50) return "hsl(48, 96%, 53%, 0.35)";
  return "hsl(220, 9%, 46%, 0.1)";
}

function SimilarityHeatmap({ nodes, pairs, hubId }: { nodes: DomainNode[]; pairs: PairData[]; hubId: string }) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  const pairLookup = useMemo(() => {
    const map = new Map<string, PairData>();
    for (const p of pairs) {
      const key = [p.domainAId, p.domainBId].sort().join("|");
      map.set(key, p);
    }
    return map;
  }, [pairs]);

  const getScore = (a: string, b: string): number => {
    const key = [a, b].sort().join("|");
    return pairLookup.get(key)?.compositeScore || 0;
  };

  const getSharedCount = (a: string, b: string): number => {
    const key = [a, b].sort().join("|");
    return pairLookup.get(key)?.sharedSentenceCount || 0;
  };

  const truncUrl = (url: string) => {
    if (url.length <= 12) return url;
    return url.slice(0, 10) + "..";
  };

  const n = nodes.length;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/30 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Similarity Matrix</span>
      </div>
      <div className="p-4 overflow-x-auto">
        <div className="inline-block">
          {/* Column headers — rotated for readability */}
          <div className="flex" style={{ height: 120 }}>
            <div className="w-28 shrink-0" />
            {nodes.map((col, ci) => (
              <div
                key={col.id}
                className={`w-14 shrink-0 relative ${hoveredCell?.col === ci ? "bg-primary/5" : ""}`}
              >
                <span
                  className={`absolute bottom-1 left-[50%] text-[9px] font-medium whitespace-nowrap ${col.id === hubId ? "text-primary font-bold" : "text-muted-foreground"}`}
                  style={{ transform: "rotate(-60deg)", transformOrigin: "bottom left" }}
                  title={col.url}
                >
                  {col.url}
                </span>
              </div>
            ))}
          </div>

          {/* Rows */}
          {nodes.map((row, ri) => (
            <div key={row.id} className={`flex items-center ${hoveredCell?.row === ri ? "bg-primary/5" : ""}`}>
              {/* Row label */}
              <div className="w-28 shrink-0 pr-2 text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`text-[10px] font-medium cursor-default truncate block ${row.id === hubId ? "text-primary font-bold" : "text-muted-foreground"}`}>
                      {truncUrl(row.url)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">{row.url}</TooltipContent>
                </Tooltip>
              </div>

              {/* Cells */}
              {nodes.map((col, ci) => {
                if (row.id === col.id) {
                  return (
                    <div key={col.id} className="w-14 h-8 shrink-0 flex items-center justify-center rounded-sm m-px">
                      <span className="text-[9px] text-muted-foreground/30">—</span>
                    </div>
                  );
                }
                const score = getScore(row.id, col.id);
                const shared = getSharedCount(row.id, col.id);
                const isHovered = hoveredCell?.row === ri && hoveredCell?.col === ci;

                return (
                  <Tooltip key={col.id}>
                    <TooltipTrigger asChild>
                      <div
                        className={`w-14 h-8 shrink-0 flex items-center justify-center cursor-default transition-all duration-100 rounded-sm m-px ${
                          isHovered ? "ring-2 ring-primary ring-inset" : ""
                        }`}
                        style={{ backgroundColor: score > 0 ? scoreColorHsl(score) : undefined }}
                        onMouseEnter={() => setHoveredCell({ row: ri, col: ci })}
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        {score > 0 && (
                          <span className={`text-[10px] font-bold tabular-nums ${score >= 70 ? "text-white" : "text-foreground/70"}`}>
                            {score}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      <div className="font-semibold">{row.url} ↔ {col.url}</div>
                      <div>Score: {score} · {shared} shared sentences</div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
          <span>Score:</span>
          {[
            { label: "90+", color: "bg-red-500/80" },
            { label: "80+", color: "bg-red-400/60" },
            { label: "70+", color: "bg-orange-400/50" },
            { label: "60+", color: "bg-amber-400/40" },
            { label: "50+", color: "bg-yellow-300/40" },
            { label: "<50", color: "bg-muted/30" },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1">
              <span className={`w-3 h-3 rounded-sm ${l.color}`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Full Link Graph — all edges shown, color-coded by score
// =============================================================================

// Solid light colors for default view (no transparency needed)
function edgeColorDefault(score: number): string {
  if (score >= 90) return "hsl(0, 60%, 75%)";
  if (score >= 80) return "hsl(0, 50%, 80%)";
  if (score >= 70) return "hsl(25, 60%, 78%)";
  if (score >= 60) return "hsl(38, 55%, 80%)";
  return "hsl(45, 50%, 82%)";
}
// Vivid colors for selected/highlighted state
function edgeColorHighlighted(score: number): string {
  if (score >= 90) return "hsl(0, 72%, 51%)";
  if (score >= 80) return "hsl(0, 72%, 60%)";
  if (score >= 70) return "hsl(25, 95%, 53%)";
  if (score >= 60) return "hsl(38, 92%, 50%)";
  return "hsl(45, 93%, 47%)";
}

function ConcentricRingGraph({ nodes, pairs, hubId, selectedId, setSelectedId }: { nodes: DomainNode[]; pairs: PairData[]; hubId: string; selectedId: string | null; setSelectedId: (id: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Pair lookup
  const pairLookup = useMemo(() => {
    const map = new Map<string, PairData>();
    for (const p of pairs) {
      map.set([p.domainAId, p.domainBId].sort().join("|"), p);
    }
    return map;
  }, [pairs]);
  const getPair = useCallback((a: string, b: string) => pairLookup.get([a, b].sort().join("|")), [pairLookup]);

  // All edges with score >= 50
  const allEdges = useMemo(() => {
    const edges: { fromId: string; toId: string; score: number; topPage: string | null }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pair = getPair(nodes[i].id, nodes[j].id);
        if (!pair || pair.compositeScore < 50) continue;
        const topPage = pair.pageScores?.length
          ? [...pair.pageScores].sort((a, b) => b.score - a.score)[0]?.label || null
          : null;
        edges.push({ fromId: nodes[i].id, toId: nodes[j].id, score: pair.compositeScore, topPage });
      }
    }
    return edges;
  }, [nodes, getPair]);

  // Selected node edges
  const selectedEdges = useMemo(() => {
    if (!selectedId) return null;
    return allEdges.filter((e) => e.fromId === selectedId || e.toId === selectedId);
  }, [selectedId, allEdges]);

  const selectedConnectedIds = useMemo(() => {
    if (!selectedId || !selectedEdges) return null;
    const set = new Set<string>([selectedId]);
    for (const e of selectedEdges) { set.add(e.fromId); set.add(e.toId); }
    return set;
  }, [selectedId, selectedEdges]);

  // Card pixel sizes: ~7px per char at 11px font, plus icons/padding ≈ 70px
  // Container renders at ~800px but viewBox is ~1500+, so multiply by ~2x
  // We solve this by computing everything in a normalized [0,1] coordinate space
  // and converting to viewBox at the end.

  // Estimate card pixel widths
  const cardPixelWidths = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) {
      map.set(n.id, Math.max(150, n.url.length * 7.5 + 70));
    }
    return map;
  }, [nodes]);
  const CARD_PIXEL_H = 36;
  const ASSUMED_CONTAINER_PX = 800; // approximate rendered container width

  // Compute ring radii in normalized [0, 0.5] space (center at 0.5, 0.5)
  const ringData = useMemo(() => {
    const rings = [
      { degree: 1 as const, ids: nodes.filter((n) => n.id !== hubId && n.degree === 1).map((n) => n.id) },
      { degree: 2 as const, ids: nodes.filter((n) => n.degree === 2).map((n) => n.id) },
      { degree: 3 as const, ids: nodes.filter((n) => n.degree === 3).map((n) => n.id) },
      { degree: null as number | null, ids: nodes.filter((n) => n.id !== hubId && n.degree === null).map((n) => n.id) },
    ].filter((r) => r.ids.length > 0);

    // Radii as fraction of container width
    const BASE_RADIUS_FRAC = 0.28;
    const RING_GAP_FRAC = 0.22;
    const GAP_PX = 30; // pixel gap between cards

    return rings.map((ring, ri) => {
      // Min circumference in pixels = sum of card widths + gaps
      const totalCircumPx = ring.ids.reduce(
        (sum, id) => sum + (cardPixelWidths.get(id) || 180) + GAP_PX, 0
      );
      const minRadiusFrac = (totalCircumPx / (2 * Math.PI)) / ASSUMED_CONTAINER_PX;
      const radiusFrac = Math.max(BASE_RADIUS_FRAC + ri * RING_GAP_FRAC, minRadiusFrac);
      return { ...ring, radiusFrac };
    });
  }, [nodes, hubId, cardPixelWidths]);

  // ViewBox: scale so the largest ring fits with padding
  const maxRadiusFrac = ringData.length > 0 ? Math.max(...ringData.map((r) => r.radiusFrac)) : 0.35;
  const vbSize = 1000; // fixed viewBox, positions computed from fractions
  const vbCx = vbSize / 2;
  const vbCy = vbSize / 2;
  // Scale factor: maps fraction-of-container to viewBox units
  const vbScale = (vbSize * 0.42) / Math.max(maxRadiusFrac, 0.3);

  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();

    // Hub at center
    const hubNode = nodes.find((n) => n.id === hubId);
    if (hubNode) pos.set(hubNode.id, { x: vbCx, y: vbCy });

    // Place nodes on rings
    ringData.forEach((ring) => {
      const r = ring.radiusFrac * vbScale;
      ring.ids.forEach((id, i) => {
        const angle = (2 * Math.PI * i) / ring.ids.length - Math.PI / 2;
        pos.set(id, { x: vbCx + r * Math.cos(angle), y: vbCy + r * Math.sin(angle) });
      });
    });

    // Collision resolution in viewBox space using pixel-accurate card sizes
    // Convert pixel widths to viewBox units: px * (vbSize / containerPx)
    const pxToVb = vbSize / ASSUMED_CONTAINER_PX;
    const allIds = nodes.map((n) => n.id);
    for (let iter = 0; iter < 30; iter++) {
      let anyOverlap = false;
      for (let i = 0; i < allIds.length; i++) {
        for (let j = i + 1; j < allIds.length; j++) {
          const a = pos.get(allIds[i]);
          const b = pos.get(allIds[j]);
          if (!a || !b) continue;
          const wA = ((cardPixelWidths.get(allIds[i]) || 180) * pxToVb) / 2;
          const wB = ((cardPixelWidths.get(allIds[j]) || 180) * pxToVb) / 2;
          const hHalf = (CARD_PIXEL_H * pxToVb) / 2;
          const padX = 15 * pxToVb; // 15px gap
          const padY = 8 * pxToVb;
          const overlapX = (wA + wB + padX) - Math.abs(a.x - b.x);
          const overlapY = (hHalf * 2 + padY) - Math.abs(a.y - b.y);
          if (overlapX > 0 && overlapY > 0) {
            anyOverlap = true;
            const dx = a.x - b.x || 0.1;
            const dy = a.y - b.y || 0.1;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const pushX = (dx / dist) * (overlapX / 2 + 5);
            const pushY = (dy / dist) * (overlapY / 2 + 5);
            a.x += pushX;
            a.y += pushY;
            b.x -= pushX;
            b.y -= pushY;
          }
        }
      }
      if (!anyOverlap) break;
    }

    // Snap pass: align nodes that are nearly on the same vertical or horizontal line.
    // This ensures lines between vertically/horizontally aligned nodes stack perfectly.
    const SNAP_THRESHOLD = 25 * pxToVb; // ~25px tolerance
    const posEntries = [...pos.entries()];

    // Vertical snap: group nodes with similar x, snap to average x
    const xGroups: Map<number, string[]> = new Map();
    for (const [id, p] of posEntries) {
      let foundGroup = false;
      for (const [gx, members] of xGroups) {
        if (Math.abs(p.x - gx) < SNAP_THRESHOLD) {
          members.push(id);
          foundGroup = true;
          break;
        }
      }
      if (!foundGroup) xGroups.set(p.x, [id]);
    }
    for (const [, members] of xGroups) {
      if (members.length < 2) continue;
      const avgX = members.reduce((s, id) => s + pos.get(id)!.x, 0) / members.length;
      for (const id of members) pos.get(id)!.x = avgX;
    }

    // Horizontal snap: group nodes with similar y, snap to average y
    const yGroups: Map<number, string[]> = new Map();
    for (const [id, p] of posEntries) {
      let foundGroup = false;
      for (const [gy, members] of yGroups) {
        if (Math.abs(p.y - gy) < SNAP_THRESHOLD) {
          members.push(id);
          foundGroup = true;
          break;
        }
      }
      if (!foundGroup) yGroups.set(p.y, [id]);
    }
    for (const [, members] of yGroups) {
      if (members.length < 2) continue;
      const avgY = members.reduce((s, id) => s + pos.get(id)!.y, 0) / members.length;
      for (const id of members) pos.get(id)!.y = avgY;
    }

    // Post-snap collision resolution — only push along axes that preserve snap alignment.
    // If two nodes share the same x (snapped column), push only on y-axis.
    // If same y (snapped row), push only on x-axis. Otherwise push on both.
    for (let iter = 0; iter < 15; iter++) {
      let anyOverlap = false;
      for (let i = 0; i < allIds.length; i++) {
        for (let j = i + 1; j < allIds.length; j++) {
          const a = pos.get(allIds[i]);
          const b = pos.get(allIds[j]);
          if (!a || !b) continue;
          const wA = ((cardPixelWidths.get(allIds[i]) || 180) * pxToVb) / 2;
          const wB = ((cardPixelWidths.get(allIds[j]) || 180) * pxToVb) / 2;
          const hHalf = (CARD_PIXEL_H * pxToVb) / 2;
          const padX = 15 * pxToVb;
          const padY = 8 * pxToVb;
          const overlapX = (wA + wB + padX) - Math.abs(a.x - b.x);
          const overlapY = (hHalf * 2 + padY) - Math.abs(a.y - b.y);
          if (overlapX > 0 && overlapY > 0) {
            anyOverlap = true;
            const sameX = Math.abs(a.x - b.x) < SNAP_THRESHOLD;
            const sameY = Math.abs(a.y - b.y) < SNAP_THRESHOLD;
            if (sameX) {
              // Preserve x-alignment: push only on y
              const dy = a.y - b.y || 1;
              const sign = dy > 0 ? 1 : -1;
              const push = overlapY / 2 + 5;
              a.y += sign * push;
              b.y -= sign * push;
            } else if (sameY) {
              // Preserve y-alignment: push only on x
              const dx = a.x - b.x || 1;
              const sign = dx > 0 ? 1 : -1;
              const push = overlapX / 2 + 5;
              a.x += sign * push;
              b.x -= sign * push;
            } else {
              const dx = a.x - b.x || 0.1;
              const dy = a.y - b.y || 0.1;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              a.x += (dx / dist) * (overlapX / 2 + 5);
              a.y += (dy / dist) * (overlapY / 2 + 5);
              b.x -= (dx / dist) * (overlapX / 2 + 5);
              b.y -= (dy / dist) * (overlapY / 2 + 5);
            }
          }
        }
      }
      if (!anyOverlap) break;
    }

    // Final snap pass — guarantees alignment after all collision resolution is done
    const finalEntries = [...pos.entries()];
    const finalXGroups: Map<number, string[]> = new Map();
    for (const [id, p] of finalEntries) {
      let foundGroup = false;
      for (const [gx, members] of finalXGroups) {
        if (Math.abs(p.x - gx) < SNAP_THRESHOLD) {
          members.push(id);
          foundGroup = true;
          break;
        }
      }
      if (!foundGroup) finalXGroups.set(p.x, [id]);
    }
    for (const [, members] of finalXGroups) {
      if (members.length < 2) continue;
      const avgX = members.reduce((s, id) => s + pos.get(id)!.x, 0) / members.length;
      for (const id of members) pos.get(id)!.x = avgX;
    }
    const finalYGroups: Map<number, string[]> = new Map();
    for (const [id, p] of finalEntries) {
      let foundGroup = false;
      for (const [gy, members] of finalYGroups) {
        if (Math.abs(p.y - gy) < SNAP_THRESHOLD) {
          members.push(id);
          foundGroup = true;
          break;
        }
      }
      if (!foundGroup) finalYGroups.set(p.y, [id]);
    }
    for (const [, members] of finalYGroups) {
      if (members.length < 2) continue;
      const avgY = members.reduce((s, id) => s + pos.get(id)!.y, 0) / members.length;
      for (const id of members) pos.get(id)!.y = avgY;
    }

    return pos;
  }, [nodes, hubId, ringData, vbCx, vbCy, vbScale, cardPixelWidths]);

  // Zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setZoom((z) => Math.min(3, Math.max(0.4, z - e.deltaY * 0.001))); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pan]);
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    setPan({ x: panStart.current.panX + (e.clientX - panStart.current.x), y: panStart.current.panY + (e.clientY - panStart.current.y) });
  }, []);
  const handlePointerUp = useCallback(() => { isPanning.current = false; }, []);
  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); setSelectedId(null); }, []);

  const toPct = (v: number, total: number) => `${(v / total) * 100}%`;
  const NODE_INSET = 0; // Lines go center-to-center; node cards (z-20) cover endpoints

  // Show all edges by default, filter to selected node's edges when one is selected
  const visibleEdges = selectedEdges || allEdges;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cluster Graph</span>
        <span className="text-[10px] text-muted-foreground">
          {selectedId
            ? `${nodes.find((n) => n.id === selectedId)?.url} — ${selectedEdges?.length || 0} connections · Click background to reset`
            : `${allEdges.length} links · Click a domain to show connections`}
        </span>
      </div>

      <div className="relative w-full bg-muted/20 overflow-hidden" style={{ minHeight: 550 }}>
        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-30 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-lg border shadow-sm px-1 py-0.5">
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="7" y1="3" x2="7" y2="11"/><line x1="3" y1="7" x2="11" y2="7"/></svg>
          </button>
          <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-center select-none">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="7" x2="11" y2="7"/></svg>
          </button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <button onClick={resetView} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors text-[10px] font-medium">Reset</button>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="relative w-full cursor-grab active:cursor-grabbing"
          style={{ aspectRatio: "1 / 1", minHeight: 600 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={() => setSelectedId(null)}
        >
          <div
            className="absolute origin-center"
            style={{
              width: "100%",
              height: "100%",
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: isPanning.current ? "none" : "transform 0.15s ease-out",
            }}
          >
            {/* Layer 1 (back): Concentric rings + All edges */}
            <svg viewBox={`0 0 ${vbSize} ${vbSize}`} className="absolute inset-0 w-full h-full pointer-events-none z-0">
              {/* Concentric degree rings */}
              {ringData.map((ring, ri) => {
                const labels = ["1st°", "2nd°", "3rd°", "Other"];
                return (
                  <g key={ri}>
                    <circle cx={vbCx} cy={vbCy} r={ring.radiusFrac * vbScale} fill="none" stroke="currentColor" strokeWidth={0.5} strokeDasharray="6,6" opacity={0.12} />
                    <text x={vbCx + ring.radiusFrac * vbScale + 8} y={vbCy - 6} fontSize={11} fill="currentColor" opacity={0.2} fontWeight={600}>
                      {labels[ri] || ""}
                    </text>
                  </g>
                );
              })}

              {visibleEdges.map((edge, i) => {
                const fromPos = positions.get(edge.fromId);
                const toPos = positions.get(edge.toId);
                if (!fromPos || !toPos) return null;

                const dx = toPos.x - fromPos.x;
                const dy = toPos.y - fromPos.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const ux = dx / len;
                const uy = dy / len;
                const x1 = fromPos.x + ux * NODE_INSET;
                const y1 = fromPos.y + uy * NODE_INSET;
                const x2 = toPos.x - ux * NODE_INSET;
                const y2 = toPos.y - uy * NODE_INSET;

                const isHighlighted = !!selectedId;
                const color = isHighlighted ? edgeColorHighlighted(edge.score) : edgeColorDefault(edge.score);
                const strokeW = edge.score >= 85 ? 1.5 : edge.score >= 70 ? 1 : 0.6;

                return (
                  <g key={i} style={{ transition: "opacity 0.2s" }}>
                    <line
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={color}
                      strokeWidth={strokeW}
                      strokeOpacity={isHighlighted ? 0.7 : 1}
                      strokeDasharray="6,4"
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
            </svg>

            {/* Layer 2: Floating connections panel attached to selected node */}
            {selectedId && (() => {
              const selPos = positions.get(selectedId);
              if (!selPos) return null;
              // Position panel to the right of the selected node, or left if too far right
              const panelOnRight = selPos.x < vbSize * 0.6;
              const sorted = [...(selectedEdges || [])].sort((a, b) => b.score - a.score);
              return (
                <div
                  className="absolute z-30 pointer-events-auto"
                  style={{
                    left: toPct(selPos.x, vbSize),
                    top: toPct(selPos.y, vbSize),
                    transform: panelOnRight
                      ? "translate(10px, -50%)"
                      : "translate(calc(-100% - 10px), -50%)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="bg-white rounded-lg border shadow-lg py-1.5 px-2 min-w-[180px] max-w-[240px]">
                    <div className="text-[10px] font-semibold text-muted-foreground mb-1 px-0.5">
                      {sorted.length} connections
                    </div>
                    <div className="space-y-0.5">
                      {sorted.map((edge, i) => {
                        const otherUrl = edge.fromId === selectedId
                          ? nodes.find((n) => n.id === edge.toId)?.url
                          : nodes.find((n) => n.id === edge.fromId)?.url;
                        const sc = edgeColorHighlighted(edge.score);
                        return (
                          <div key={i} className="flex items-center gap-1.5 text-[10px] px-0.5 py-0.5 rounded hover:bg-gray-50">
                            <span className="font-bold tabular-nums shrink-0" style={{ color: sc }}>
                              {edge.score}
                            </span>
                            <span className="font-medium text-foreground truncate">{otherUrl}</span>
                            {edge.topPage && (
                              <span className="ml-auto shrink-0 text-[8px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                                {edge.topPage}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Layer 3 (front): Node cards */}
            {nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const isSelected = node.id === selectedId;
              const dimmed = selectedConnectedIds && !selectedConnectedIds.has(node.id);
              const maxScore = node.strongestLink?.score ?? 0;

              return (
                <div
                  key={node.id}
                  data-node
                  className="absolute z-20"
                  style={{
                    left: toPct(pos.x, vbSize),
                    top: toPct(pos.y, vbSize),
                    transform: `translate(-50%, -50%) ${isSelected ? "scale(1.05)" : "scale(1)"}`,
                    opacity: dimmed ? 0.15 : 1,
                    transition: "opacity 0.2s, transform 0.2s",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(isSelected ? null : node.id);
                  }}
                >
                  <div
                    className={`rounded-lg shadow-sm cursor-pointer transition-all hover:shadow-md border whitespace-nowrap ${
                      isSelected
                        ? "bg-violet-50 border-violet-300 ring-2 ring-violet-200 dark:bg-violet-900/30 dark:border-violet-600"
                        : "bg-background border-border/60 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                      <span className="text-[11px] font-semibold text-foreground">{node.url}</span>
                      <a
                        href={`https://${node.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        onClick={(e) => e.stopPropagation()}
                        title="Open website"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={`/scans/${node.id}`}
                        className="text-muted-foreground/40 hover:text-primary transition-colors"
                        onClick={(e) => e.stopPropagation()}
                        title="View scan details"
                      >
                        <ScanSearch className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

    </div>
  );
}
