"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, AlertTriangle, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { format } from "date-fns";

interface Investigation {
  id: string;
  name: string | null;
  status: string;
  domainCount: number;
  highRiskCount: number;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, string> = {
  pending: "secondary",
  scanning: "info-subtle",
  analyzing: "info-subtle",
  completed: "success-subtle",
  failed: "danger-subtle",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  scanning: "Scanning",
  analyzing: "Analyzing",
  completed: "Completed",
  failed: "Failed",
};

type SortField = "name" | "status" | "domainCount" | "createdAt";

export function InvestigationsList({ investigations: initialInvestigations }: { investigations: Investigation[] }) {
  const router = useRouter();
  const [investigations, setInvestigations] = useState(initialInvestigations);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleRename = useCallback(async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) { setEditingId(null); return; }
    try {
      const res = await fetch(`/api/investigations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setInvestigations((prev) =>
          prev.map((inv) => inv.id === id ? { ...inv, name: trimmed } : inv)
        );
      }
    } catch {
      // ignore
    }
    setEditingId(null);
  }, [editName]);

  const startEditing = useCallback((e: React.MouseEvent, inv: Investigation) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(inv.id);
    setEditName(inv.name || "");
  }, []);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this investigation and all its data?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/investigations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setInvestigations((prev) => prev.filter((inv) => inv.id !== id));
      }
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    return [...investigations].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "domainCount":
          cmp = a.domainCount - b.domainCount;
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [investigations, sortField, sortDirection]);

  const arrow = (field: SortField) =>
    sortField === field ? (sortDirection === "desc" ? "↓" : "↑") : "↕";

  if (investigations.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <p className="font-medium">No investigations yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Start a batch analysis from the home page by pasting multiple URLs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Column Headers */}
      <div className="flex items-center gap-4 px-5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <button
          className={`flex-1 min-w-0 text-left cursor-pointer hover:text-foreground transition-colors ${sortField === "name" ? "text-primary" : ""}`}
          onClick={() => handleSort("name")}
        >
          Name <span className="text-[10px]">{arrow("name")}</span>
        </button>
        <button
          className={`w-24 shrink-0 text-left cursor-pointer hover:text-foreground transition-colors ${sortField === "status" ? "text-primary" : ""}`}
          onClick={() => handleSort("status")}
        >
          Status <span className="text-[10px]">{arrow("status")}</span>
        </button>
        <button
          className={`w-20 shrink-0 text-center cursor-pointer hover:text-foreground transition-colors ${sortField === "domainCount" ? "text-primary" : ""}`}
          onClick={() => handleSort("domainCount")}
        >
          Domains <span className="text-[10px]">{arrow("domainCount")}</span>
        </button>
        <button
          className={`w-32 shrink-0 text-right cursor-pointer hover:text-foreground transition-colors ${sortField === "createdAt" ? "text-primary" : ""}`}
          onClick={() => handleSort("createdAt")}
        >
          Date <span className="text-[10px]">{arrow("createdAt")}</span>
        </button>
        <div className="w-10 shrink-0" />
      </div>

      {/* Investigation Cards */}
      <div className="grid gap-3">
        {sorted.map((inv) => (
          <Link key={inv.id} href={`/investigations/${inv.id}`}>
            <div className="domain-card group/card">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  {editingId === inv.id ? (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => { e.preventDefault(); handleRename(inv.id); }}
                      onClick={(e) => e.preventDefault()}
                    >
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") setEditingId(null); }}
                        className="text-sm font-semibold bg-muted/50 border rounded px-2 py-0.5 w-full focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button type="submit" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-1.5 group/name">
                      <span className="text-sm font-semibold text-foreground truncate block">
                        {inv.name || "Untitled Investigation"}
                      </span>
                      <button
                        onClick={(e) => startEditing(e, inv)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground/0 group-hover/name:text-muted-foreground hover:!text-foreground transition-colors shrink-0"
                        aria-label="Edit name"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {inv.highRiskCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-destructive mt-0.5">
                      <AlertTriangle className="h-3 w-3" />
                      {inv.highRiskCount} high risk
                    </span>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <Badge
                    variant={(STATUS_VARIANT[inv.status] || "secondary") as any}
                    className="text-[10px] border-0"
                  >
                    {STATUS_LABEL[inv.status] || inv.status}
                  </Badge>
                </div>
                <div className="w-20 shrink-0 text-center text-sm text-muted-foreground tabular-nums">
                  {inv.domainCount}
                </div>
                <div className="w-32 shrink-0 text-right text-xs text-muted-foreground">
                  {format(new Date(inv.createdAt), "MMM d, h:mm a")}
                </div>
                <div className="w-10 shrink-0 flex justify-end opacity-0 group-hover/card:opacity-100 transition-opacity">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => handleDelete(e, inv.id)}
                        disabled={deleting === inv.id}
                        aria-label={`Delete ${inv.name || "investigation"}`}
                        className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {deleting === inv.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Delete investigation</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
