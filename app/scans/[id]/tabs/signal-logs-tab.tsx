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
import { Activity, CheckCircle, XCircle } from "lucide-react";

export function SignalLogsTab({
  signalLogs,
}: {
  signalLogs: {
    id: string;
    category: string;
    name: string;
    valueType: string;
    valueBoolean: boolean | null;
    valueNumber: number | null;
    valueString: string | null;
    severity: string;
  }[];
}) {
  if (signalLogs.length === 0) {
    return (
      <div className="border rounded-xl bg-card p-6 text-center text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No signal logs available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Computed signals from risk intelligence analysis
      </p>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Category</TableHead>
              <TableHead className="w-[180px]">Signal</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-[80px]">Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {signalLogs.slice(0, 50).map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {log.category.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {log.name}
                </TableCell>
                <TableCell className="text-xs max-w-xs truncate">
                  {log.valueType === "boolean" ? (
                    log.valueBoolean ? (
                      <CheckCircle className="h-4 w-4 text-success" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )
                  ) : log.valueType === "number" ? (
                    <span className="font-mono">{log.valueNumber}</span>
                  ) : log.valueType === "json" ? (
                    <span className="text-muted-foreground">[JSON]</span>
                  ) : (
                    <span className="truncate">{log.valueString || "-"}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      log.severity === "risk_hint" ? "destructive" :
                      log.severity === "warning" ? "secondary" : "outline"
                    }
                    className="text-xs"
                  >
                    {log.severity}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {signalLogs.length > 50 && (
        <p className="text-xs text-muted-foreground">
          Showing 50 of {signalLogs.length} signals
        </p>
      )}
    </div>
  );
}
