"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Camera,
  RotateCw,
  Loader2,
  X,
  Maximize2,
  Download,
  ChevronLeft,
  ChevronRight,
  Layers,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface ScreenshotMeta {
  id: string;
  url: string;
  captureType: string;
  format: string;
  width: number;
  height: number;
  fileSize: number;
  durationMs: number | null;
  scanId: string | null;
  segment: string;
  segmentGroup: string | null;
  segmentIndex: number;
  pageHeight: number | null;
  createdAt: string;
}

/** A capture session groups all segments taken at the same time */
interface CaptureGroup {
  groupId: string;
  createdAt: string;
  captureType: string;
  pageHeight: number | null;
  segments: ScreenshotMeta[];
}

interface ScreenshotsCardProps {
  domainId: string;
  initialScanStatus?: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function segmentDisplayLabel(segment: string): string {
  if (segment === "full") return "Full Page";
  if (segment === "top") return "Top";
  if (segment === "middle") return "Middle";
  if (segment === "bottom") return "Bottom";
  if (segment.startsWith("middle-")) return `Middle ${segment.split("-")[1]}`;
  return segment;
}

export function ScreenshotsCard({
  domainId,
  initialScanStatus,
}: ScreenshotsCardProps) {
  const [screenshots, setScreenshots] = useState<ScreenshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 2;

  const fetchScreenshots = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/domains/${domainId}/screenshots`);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
      const result = await response.json();
      setScreenshots(result.screenshots || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    fetchScreenshots();
  }, [fetchScreenshots]);

  // Re-fetch when scan completes (ScanStatusRefresher triggers router.refresh())
  const prevStatusRef = useRef(initialScanStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = initialScanStatus;
    const wasScanning = prev === "pending" || prev === "processing";
    const nowDone = initialScanStatus === "completed" || initialScanStatus === "failed";
    if (wasScanning && nowDone) fetchScreenshots();
  }, [initialScanStatus, fetchScreenshots]);

  const handleCapture = async () => {
    setCapturing(true);
    setError(null);
    try {
      const response = await fetch(`/api/domains/${domainId}/screenshots`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Capture failed");
      }
      await fetchScreenshots();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  };

  // Group screenshots by segmentGroup (or by individual id for legacy ones without a group)
  const captureGroups: CaptureGroup[] = useMemo(() => {
    const groupMap = new Map<string, ScreenshotMeta[]>();

    for (const s of screenshots) {
      const key = s.segmentGroup || s.id;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(s);
    }

    const groups: CaptureGroup[] = [];
    for (const [groupId, segments] of groupMap) {
      // Sort segments by index
      segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
      const first = segments[0];
      groups.push({
        groupId,
        createdAt: first.createdAt,
        captureType: first.captureType,
        pageHeight: first.pageHeight,
        segments,
      });
    }

    // Sort groups newest first
    groups.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return groups;
  }, [screenshots]);

  // For the full-size modal: navigate segments within a group
  const selectedScreenshot = screenshots.find((s) => s.id === selectedId);
  const selectedGroup = selectedScreenshot
    ? captureGroups.find(
        (g) =>
          g.groupId === (selectedScreenshot.segmentGroup || selectedScreenshot.id)
      )
    : null;

  const navigateSegment = (direction: "prev" | "next") => {
    if (!selectedScreenshot || !selectedGroup) return;
    const idx = selectedGroup.segments.findIndex(
      (s) => s.id === selectedScreenshot.id
    );
    const newIdx = direction === "prev" ? idx - 1 : idx + 1;
    if (newIdx >= 0 && newIdx < selectedGroup.segments.length) {
      setSelectedId(selectedGroup.segments[newIdx].id);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <CardTitle>Screenshots</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCapture}
              disabled={capturing}
              className="shrink-0"
            >
              {capturing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Rescanning…
                </>
              ) : (
                <>
                  <RotateCw className="h-4 w-4 mr-2" />
                  Rescan
                </>
              )}
            </Button>
          </div>
          {captureGroups.length > 0 && (
            <span className="text-xs text-muted-foreground text-right mt-1">
              Latest capture {formatDistanceToNow(new Date(captureGroups[0].createdAt), { addSuffix: true })}
            </span>
          )}
        </CardHeader>
        <CardContent className="pt-6">
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">Loading screenshots...</p>
            </div>
          ) : captureGroups.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No screenshots captured yet</p>
              <p className="text-xs mt-1">
                Screenshots are captured automatically during scans, or click
                the button above to capture one now.
              </p>
            </div>
          ) : (
            <>
              {/* Capture Groups — paginated */}
              {(() => {
                const totalPages = Math.ceil(captureGroups.length / PAGE_SIZE);
                const pagedGroups = captureGroups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
                return (
                  <>
                    <div className="divide-y">
                      {pagedGroups.map((group) => (
                        <div key={group.groupId} className="space-y-2 py-6 first:pt-0 last:pb-0">
                          <div className="text-sm">
                            <span className="font-medium">
                              {format(new Date(group.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            </span>
                          </div>
                          <div
                            className={`grid gap-3 ${
                              group.segments.length === 1
                                ? "grid-cols-1"
                                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                            }`}
                          >
                            {group.segments.map((screenshot) => (
                              <div
                                key={screenshot.id}
                                className="group relative border rounded-lg overflow-hidden cursor-pointer hover:border-foreground/30 transition-colors"
                                onClick={() => setSelectedId(screenshot.id)}
                              >
                                {group.segments.length > 1 && (
                                  <div className="absolute top-2 left-2 z-10">
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1.5 py-0 bg-background/80 backdrop-blur"
                                    >
                                      {segmentDisplayLabel(screenshot.segment)}
                                    </Badge>
                                  </div>
                                )}
                                <div className="relative aspect-video bg-muted overflow-hidden">
                                  <img
                                    src={`/api/screenshots/${screenshot.id}`}
                                    alt={`${segmentDisplayLabel(screenshot.segment)} screenshot of ${screenshot.url}`}
                                    loading="lazy"
                                    className="w-full h-full object-cover object-top"
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                    <Maximize2 className="h-5 w-5 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-lg" />
                                  </div>
                                </div>
                                <div className="p-2 flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span>{screenshot.width} x {screenshot.height}</span>
                                  <span>{formatFileSize(screenshot.fileSize)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage(p => p - 1)}
                          disabled={page === 0}
                        >
                          <ChevronLeft className="h-4 w-4 mr-1" />
                          Previous
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {page + 1} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage(p => p + 1)}
                          disabled={page >= totalPages - 1}
                        >
                          Next
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </CardContent>
      </Card>

      {/* Full-size Modal */}
      {selectedId && selectedScreenshot && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] overflow-auto bg-background rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="sticky top-0 z-10 flex items-center justify-between p-3 bg-background/95 backdrop-blur border-b">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {format(
                    new Date(selectedScreenshot.createdAt),
                    "MMM d, yyyy 'at' h:mm a"
                  )}
                </span>
                {selectedGroup && selectedGroup.segments.length > 1 && (
                  <Badge variant="secondary" className="text-xs">
                    {segmentDisplayLabel(selectedScreenshot.segment)} (
                    {selectedScreenshot.segmentIndex + 1}/
                    {selectedGroup.segments.length})
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* Segment navigation */}
                {selectedGroup && selectedGroup.segments.length > 1 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={selectedScreenshot.segmentIndex === 0}
                      onClick={() => navigateSegment("prev")}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        selectedScreenshot.segmentIndex ===
                        selectedGroup.segments.length - 1
                      }
                      onClick={() => navigateSegment("next")}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    window.open(`/api/screenshots/${selectedId}`, "_blank")
                  }
                >
                  <Download className="h-4 w-4 mr-1" />
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Modal image */}
            <img
              src={`/api/screenshots/${selectedId}`}
              alt="Full-size screenshot"
              className="w-full h-auto"
            />
          </div>
        </div>
      )}
    </>
  );
}
