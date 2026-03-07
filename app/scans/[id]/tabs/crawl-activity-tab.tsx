"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";

export function CrawlActivityTab({
  crawlFetchLogs,
}: {
  crawlFetchLogs: {
    id: string;
    url: string;
    statusCode: number | null;
    errorMessage: string | null;
    source: string;
    fetchDurationMs: number | null;
    robotsAllowed: boolean | null;
  }[];
}) {
  if (crawlFetchLogs.length === 0) {
    return (
      <div className="border rounded-xl bg-card p-6 text-center text-muted-foreground">
        <p>No crawl activity logs available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Status</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="w-[100px]">Source</TableHead>
              <TableHead className="w-[80px]">Duration</TableHead>
              <TableHead className="w-[80px]">Robots</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {crawlFetchLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  {log.statusCode ? (
                    <Badge
                      variant={log.statusCode >= 200 && log.statusCode < 400 ? "success" : "destructive"}
                      className="text-xs"
                    >
                      {log.statusCode}
                    </Badge>
                  ) : log.errorMessage ? (
                    <Badge variant="destructive" className="text-xs">
                      Error
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      -
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <a
                      href={log.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-link hover:underline truncate max-w-md"
                      title={log.url}
                    >
                      {log.url}
                    </a>
                    {log.errorMessage && (
                      <span className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {log.errorMessage}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {log.source.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {log.fetchDurationMs}ms
                  </span>
                </TableCell>
                <TableCell>
                  {log.robotsAllowed ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>
          Total requests: {crawlFetchLogs.length}
        </span>
        <span>
          Successful: {crawlFetchLogs.filter((l) => l.statusCode && l.statusCode >= 200 && l.statusCode < 400).length}
          {" | "}
          Failed: {crawlFetchLogs.filter((l) => !l.statusCode || l.statusCode >= 400).length}
        </span>
      </div>
    </div>
  );
}
