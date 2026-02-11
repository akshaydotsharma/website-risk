"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, ExternalLink, Search, ChevronLeft, ChevronRight, Loader2, Eye, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getScoreTextColor, getScoreBgColor } from "@/lib/utils";

type ComparisonItem = {
  id: string;
  createdAt: string;
  urlA: string;
  urlB: string;
  overallScore: number;
  textScore: number;
  domScore: number;
  confidence: number;
};

type HistoryResponse = {
  items: ComparisonItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function truncateUrl(url: string, maxLength: number = 40): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + "...";
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
}

function ComparisonHistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // URL params
  const currentPage = parseInt(searchParams.get("page") || "1", 10);
  const currentQuery = searchParams.get("q") || "";
  const currentMinScore = searchParams.get("minScore") || "all";
  const currentSort = searchParams.get("sort") || "createdAt";

  // Local state for inputs
  const [searchQuery, setSearchQuery] = useState(currentQuery);
  const [minScore, setMinScore] = useState(currentMinScore);
  const [sort, setSort] = useState(currentSort);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("page", currentPage.toString());
      params.set("pageSize", "20");
      if (currentQuery) params.set("q", currentQuery);
      if (currentMinScore && currentMinScore !== "all") params.set("minScore", currentMinScore);
      if (currentSort) params.set("sort", currentSort);

      const response = await fetch(`/api/compare/history?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch comparison history");
      }

      const result: HistoryResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [currentPage, currentQuery, currentMinScore, currentSort]);

  const updateQueryParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    // Reset to page 1 when filters change
    if ("q" in updates || "minScore" in updates || "sort" in updates) {
      params.set("page", "1");
    }

    router.push(`/compare/history?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateQueryParams({ q: searchQuery });
  };

  const handleMinScoreChange = (value: string) => {
    setMinScore(value);
    updateQueryParams({ minScore: value });
  };

  const handleSortChange = (value: string) => {
    setSort(value);
    updateQueryParams({ sort: value });
  };

  const goToPage = (page: number) => {
    updateQueryParams({ page: page.toString() });
  };

  const handleDelete = async (e: React.MouseEvent, comparisonId: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this comparison?")) {
      return;
    }

    setDeleting(comparisonId);
    try {
      const response = await fetch(`/api/compare/${comparisonId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Refresh the data after deletion
        await fetchHistory();
      } else {
        alert("Failed to delete comparison");
      }
    } catch (error) {
      console.error("Error deleting comparison:", error);
      alert("Failed to delete comparison");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <TooltipProvider>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-6">
          <h1 className="text-page-title">Comparison History</h1>
          <p className="text-page-subtitle mt-1">
            View and manage your previous homepage comparisons
          </p>
        </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div>
              <CardTitle>All Comparisons</CardTitle>
              <CardDescription>
                {data ? `${data.total} total comparison${data.total !== 1 ? "s" : ""}` : "Loading..."}
              </CardDescription>
            </div>
            <Button asChild>
              <Link href="/compare">New Comparison</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <form onSubmit={handleSearch} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search URLs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button type="submit" variant="secondary">Search</Button>
            </form>

            <Select value={minScore} onValueChange={handleMinScoreChange}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Min score" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scores</SelectItem>
                <SelectItem value="70">70+ (High)</SelectItem>
                <SelectItem value="50">50+ (Medium)</SelectItem>
                <SelectItem value="30">30+ (Low)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">Newest first</SelectItem>
                <SelectItem value="score">Highest score</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="text-center py-12">
              <p className="text-destructive mb-4">{error}</p>
              <Button onClick={fetchHistory} variant="outline">Try Again</Button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && data && data.items.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">
                {currentQuery || (currentMinScore && currentMinScore !== "all")
                  ? "No comparisons match your filters"
                  : "No comparisons yet"}
              </p>
              <Button asChild variant="outline">
                <Link href="/compare">Create your first comparison</Link>
              </Button>
            </div>
          )}

          {/* Table */}
          {!loading && !error && data && data.items.length > 0 && (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Created</TableHead>
                      <TableHead>URL A</TableHead>
                      <TableHead>URL B</TableHead>
                      <TableHead className="text-center w-[100px]">Overall</TableHead>
                      <TableHead className="text-center w-[80px]">Text</TableHead>
                      <TableHead className="text-center w-[80px]">DOM</TableHead>
                      <TableHead className="text-center w-[100px]">Confidence</TableHead>
                      <TableHead className="text-right w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs">
                          <div
                            title={new Date(item.createdAt).toLocaleString()}
                            className="cursor-help"
                          >
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm truncate max-w-[200px]"
                              title={item.urlA}
                            >
                              {truncateUrl(item.urlA)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => copyToClipboard(item.urlA)}
                              title="Copy URL"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              asChild
                              title="Open URL"
                            >
                              <a href={item.urlA} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm truncate max-w-[200px]"
                              title={item.urlB}
                            >
                              {truncateUrl(item.urlB)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => copyToClipboard(item.urlB)}
                              title="Copy URL"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              asChild
                              title="Open URL"
                            >
                              <a href={item.urlB} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-sm font-medium ${getScoreTextColor(item.overallScore)}`}>
                            {item.overallScore}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-sm ${getScoreTextColor(item.textScore)}`}>
                            {item.textScore}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-sm ${getScoreTextColor(item.domScore)}`}>
                            {item.domScore}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={`text-sm ${
                              item.confidence >= 70
                                ? "text-green-600 dark:text-green-400"
                                : item.confidence >= 50
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-orange-600 dark:text-orange-400"
                            }`}
                          >
                            {item.confidence}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => router.push(`/compare/${item.id}`)}
                                  className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                  title="View comparison"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>View comparison</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => handleDelete(e, item.id)}
                                  disabled={deleting === item.id}
                                  className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                                  title="Delete comparison"
                                >
                                  {deleting === item.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {data.page} of {data.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(data.page - 1)}
                      disabled={data.page === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(data.page + 1)}
                      disabled={data.page === data.totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}

export default function ComparisonHistoryPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    }>
      <ComparisonHistoryContent />
    </Suspense>
  );
}
