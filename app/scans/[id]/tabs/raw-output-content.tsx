"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { FileText, Globe, ExternalLink, Shield, ReceiptText, Scale, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { DataPointKey, PAGE_TEXT_KEYS, PAGE_TEXT_LABELS } from "@/lib/constants";

export function RawOutputContent({
  dataPoints,
  scans,
}: {
  dataPoints: {
    id: string;
    key: string;
    label: string;
    value: any;
    rawOpenAIResponse: any;
  }[];
  scans: {
    id: string;
    isActive: boolean;
    statusCode: number | null;
    checkedAt: string;
    dataPoints: { id: string }[];
  }[];
}) {
  const pageTextItems = PAGE_TEXT_KEYS.map((key) => ({
    key,
    label: PAGE_TEXT_LABELS[key] || key,
  }));

  const pageTextEntries = pageTextItems
    .map((pt) => {
      const dp = dataPoints.find((d) => d.key === pt.key);
      if (!dp?.value?.text_content) return null;
      return { ...pt, value: dp.value };
    })
    .filter(Boolean) as { key: string; label: string; value: any }[];

  return (
    <div className="space-y-4">
      {/* Extracted Page Texts */}
      {pageTextEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" aria-hidden="true" />
              Extracted Page Text
            </CardTitle>
            <CardDescription>
              Readable text extracted from crawled pages, used for cross-domain similarity comparison.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Accordion>
              {pageTextEntries.map((entry) => (
                <AccordionItem
                  key={entry.key}
                  title={
                    <div className="flex items-center gap-2">
                      <span>{entry.label}</span>
                      <Badge variant="secondary" className="text-[10px] ml-1">
                        {entry.value.word_count ?? 0} words
                      </Badge>
                      {(entry.value.page_url || entry.value.about_page_url) && (
                        <a
                          href={entry.value.page_url || entry.value.about_page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  }
                >
                  <div className="space-y-3">
                    {entry.value.headings?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {entry.value.headings.slice(0, 10).map((h: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] font-normal">
                            {h}
                          </Badge>
                        ))}
                        {entry.value.headings.length > 10 && (
                          <Badge variant="secondary" className="text-[10px]">
                            +{entry.value.headings.length - 10} more
                          </Badge>
                        )}
                      </div>
                    )}
                    <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96 whitespace-pre-wrap">
                      {entry.value.text_content}
                    </pre>
                  </div>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Raw AI Responses */}
      {dataPoints.length > 0 && (
        <Accordion>
          {dataPoints.map((dataPoint) => (
            <AccordionItem
              key={dataPoint.id}
              title={`Raw AI Response - ${dataPoint.label}`}
            >
              <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
                {JSON.stringify(dataPoint.rawOpenAIResponse, null, 2)}
              </pre>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* Scan History */}
      {scans.length > 1 && <ScanHistoryCard scans={scans} />}

      {dataPoints.length === 0 && scans.length <= 1 && (
        <div className="border rounded-xl bg-card p-6 text-center text-muted-foreground">
          <p>No raw data available</p>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 5;

function ScanHistoryCard({ scans }: { scans: { id: string; isActive: boolean; statusCode: number | null; checkedAt: string; dataPoints: { id: string }[] }[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(scans.length / PAGE_SIZE);
  const pageScans = scans.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, scans.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan History</CardTitle>
        <CardDescription>
          Previous scans for this domain
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {pageScans.map((scan, idx) => {
            const globalIdx = page * PAGE_SIZE + idx;
            return (
              <div
                key={scan.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={scan.isActive ? "success" : "destructive"} className="text-xs">
                    {scan.isActive ? scan.statusCode : "Inactive"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(scan.checkedAt), "PPp")}
                  </span>
                  {globalIdx === 0 && (
                    <Badge variant="outline" className="text-xs">Latest</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {scan.dataPoints.length} data points
                </span>
              </div>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 mt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {start}–{end} of {scans.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`h-7 min-w-[1.75rem] rounded-md text-xs font-medium tabular-nums transition-colors ${
                    i === page
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
