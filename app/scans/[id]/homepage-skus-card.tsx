"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExternalLink,
  ShoppingCart,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Package,
  DollarSign,
  ImageIcon,
  RefreshCw,
  Loader2,
  Tag,
  TrendingDown,
} from "lucide-react";

interface HomepageSku {
  id: string;
  scanId: string;
  sourceUrl: string;
  productUrl: string;
  productPath: string | null;
  title: string | null;
  priceText: string | null;
  currency: string | null;
  amount: number | null;
  originalPriceText: string | null;
  originalAmount: number | null;
  isOnSale: boolean;
  imageUrl: string | null;
  extractionMethod: string;
  confidence: number;
  createdAt: string;
}

interface HomepageSkusSummary {
  totalDetected: number;
  withPrice: number;
  pricePercentage: number;
  avgSellingPrice: number | null;
  avgDiscount: number | null;
  saleItemCount: number;
  topCurrency: string | null;
}

interface HomepageSkusResponse {
  items: HomepageSku[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: HomepageSkusSummary;
}

interface HomepageSkusCardProps {
  domainId: string;
  initialScanStatus?: string | null;
}

export function HomepageSkusCard({ domainId, initialScanStatus }: HomepageSkusCardProps) {
  const [data, setData] = useState<HomepageSkusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState(initialScanStatus);

  // Filter state
  const [search, setSearch] = useState("");
  const [hasPrice, setHasPrice] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"confidence" | "amount" | "title">("confidence");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const pageSize = 20;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        sortBy,
        sortDir,
      });

      if (search) {
        params.set("search", search);
      }
      if (hasPrice) {
        params.set("hasPrice", "true");
      }

      const response = await fetch(
        `/api/scans/${domainId}/homepage-skus?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const result: HomepageSkusResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [domainId, page, search, hasPrice, sortBy, sortDir]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll for data while scan is processing
  useEffect(() => {
    const isScanning = scanStatus === "pending" || scanStatus === "processing";
    if (!isScanning) return;

    const pollInterval = setInterval(async () => {
      // Check scan status
      try {
        const statusResponse = await fetch(`/api/scans/${domainId}/status`);
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setScanStatus(statusData.status);

          // If scan completed, fetch data one more time
          if (statusData.status === "completed" || statusData.status === "failed") {
            fetchData();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [domainId, scanStatus, fetchData]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleExtract = async () => {
    try {
      setExtracting(true);
      setError(null);

      const response = await fetch(`/api/scans/${domainId}/homepage-skus`, {
        method: "POST",
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || `Failed to extract: ${response.status}`);
      }

      // Refresh data after extraction
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExtracting(false);
    }
  };

  const toggleSort = (column: "confidence" | "amount" | "title") => {
    if (sortBy === column) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return "bg-green-500";
    if (confidence >= 50) return "bg-yellow-500";
    if (confidence >= 30) return "bg-orange-500";
    return "bg-red-500";
  };

  const getConfidenceVariant = (confidence: number): "default" | "secondary" | "destructive" | "outline" => {
    if (confidence >= 70) return "default";
    if (confidence >= 50) return "secondary";
    return "outline";
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Homepage SKUs
            </CardTitle>
            <CardDescription>
              Product/SKU elements detected on the homepage
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExtract}
            disabled={extracting}
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Re-extract
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <hr className="border-border -mt-1" />

        {/* Summary Stats */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Package className="h-3 w-3" />
                Detected SKUs
              </div>
              <div className="text-2xl font-bold">{data.summary.totalDetected}</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="h-3 w-3" />
                With Price
              </div>
              <div className="text-2xl font-bold">
                {data.summary.pricePercentage}%
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Tag className="h-3 w-3" />
                Avg. Selling Price
              </div>
              <div className="text-2xl font-bold">
                {data.summary.avgSellingPrice !== null
                  ? `${data.summary.topCurrency === "USD" ? "$" : data.summary.topCurrency || "$"}${data.summary.avgSellingPrice.toFixed(2)}`
                  : "N/A"}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingDown className="h-3 w-3" />
                Avg. Discount
              </div>
              <div className="text-2xl font-bold">
                {data.summary.totalDetected === 0
                  ? "N/A"
                  : data.summary.avgDiscount !== null
                    ? `${Math.round(data.summary.avgDiscount)}%`
                    : "0%"}
                {data.summary.saleItemCount > 0 && (
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    ({data.summary.saleItemCount} items)
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search title or URL..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="hasPrice"
              checked={hasPrice}
              onCheckedChange={setHasPrice}
            />
            <Label htmlFor="hasPrice" className="text-sm cursor-pointer">
              Only with price
            </Label>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!loading && data && data.items.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            {data.total === 0 ? (
              <>
                <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No SKUs detected on the homepage.</p>
                <p className="text-sm mt-1">
                  This site may not be an e-commerce store, or products are loaded dynamically.
                </p>
              </>
            ) : (
              <p>No results match your filters.</p>
            )}
          </div>
        )}

        {/* Table */}
        {data && data.items.length > 0 && (
          <>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("title")}
                      >
                        Title
                        {sortBy === "title" && (
                          <ArrowUpDown className="h-3 w-3" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="w-[15%]">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("amount")}
                      >
                        Price
                        {sortBy === "amount" && (
                          <ArrowUpDown className="h-3 w-3" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="w-[25%]">Product Link</TableHead>
                    <TableHead className="w-[10%]">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("confidence")}
                      >
                        Confidence
                        {sortBy === "confidence" && (
                          <ArrowUpDown className="h-3 w-3" />
                        )}
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((sku) => (
                    <TableRow key={sku.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {sku.imageUrl && (
                            <div className="w-10 h-10 bg-muted rounded flex-shrink-0 overflow-hidden">
                              <img
                                src={sku.imageUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            </div>
                          )}
                          <span
                            className="text-sm truncate max-w-[300px]"
                            title={sku.title || "Untitled"}
                          >
                            {sku.title || (
                              <span className="text-muted-foreground italic">
                                Untitled
                              </span>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {sku.priceText ? (
                          <div>
                            {sku.isOnSale && sku.originalPriceText ? (
                              <>
                                <span className="text-muted-foreground line-through text-xs mr-1">
                                  {sku.originalPriceText}
                                </span>
                                <span className="font-medium text-green-600 dark:text-green-400">
                                  {sku.priceText}
                                </span>
                                {sku.amount !== null && sku.originalAmount !== null && (
                                  <div className="text-xs text-green-600 dark:text-green-400">
                                    {Math.round((1 - sku.amount / sku.originalAmount) * 100)}% off
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="font-medium">{sku.priceText}</span>
                                {sku.amount !== null && sku.currency && (
                                  <div className="text-xs text-muted-foreground">
                                    {sku.currency} {sku.amount.toFixed(2)}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <a
                          href={sku.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1 truncate max-w-[200px]"
                          title={sku.productUrl}
                        >
                          {sku.productPath || sku.productUrl}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-2 w-2 rounded-full ${getConfidenceColor(
                              sku.confidence
                            )}`}
                          />
                          <Badge
                            variant={getConfidenceVariant(sku.confidence)}
                            className="text-xs"
                          >
                            {sku.confidence}%
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {(data.page - 1) * data.pageSize + 1} -{" "}
                  {Math.min(data.page * data.pageSize, data.total)} of {data.total}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    Page {data.page} of {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    disabled={page === data.totalPages || loading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Extraction method note */}
        <div className="text-xs text-muted-foreground border-t pt-3">
          Extraction method: heuristic_v1 (homepage-only, no external APIs).
          Results may be incomplete for sites with dynamically-loaded product grids.
        </div>
      </CardContent>
    </Card>
  );
}
