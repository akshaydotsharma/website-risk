"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Globe, CheckCircle, XCircle, Clock, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface SearchResult {
  id: string;
  normalizedUrl: string;
  isActive: boolean;
  statusCode: number | null;
  lastCheckedAt: string | null;
  dataPointCount: number;
  scanCount: number;
}

export function DomainSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/domains/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        setResults(data.domains || []);
      } catch (error) {
        console.error("Search error:", error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, -1));
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0 && results[selectedIndex]) {
            navigateToResult(results[selectedIndex]);
          } else if (query.trim()) {
            // Navigate to new scan
            handleNewScan();
          }
          break;
        case "Escape":
          setIsOpen(false);
          inputRef.current?.blur();
          break;
      }
    },
    [isOpen, results, selectedIndex, query]
  );

  const navigateToResult = (result: SearchResult) => {
    router.push(`/scans/${result.id}`);
    setIsOpen(false);
    setQuery("");
  };

  const handleNewScan = () => {
    router.push(`/?url=${encodeURIComponent(query)}`);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      {/* Search Input */}
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search scanned websites..."
          className={cn(
            "w-full h-10 pl-10 pr-4 rounded-xl border bg-muted/50",
            "text-sm placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-background",
            "transition-all duration-200"
          )}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (query.length >= 2 || results.length > 0) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-popover border rounded-xl shadow-lg overflow-hidden z-50">
          {results.length > 0 ? (
            <div className="py-2">
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Previously Scanned
              </div>
              {results.map((result, index) => (
                <button
                  key={result.id}
                  onClick={() => navigateToResult(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors",
                    selectedIndex === index ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex-shrink-0">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center",
                      result.isActive
                        ? "bg-green-500/10 text-green-600"
                        : "bg-red-500/10 text-red-500"
                    )}>
                      <Globe className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{result.normalizedUrl}</span>
                      {result.isActive ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{result.scanCount} scan{result.scanCount !== 1 ? "s" : ""}</span>
                      <span>•</span>
                      <span>{result.dataPointCount} data point{result.dataPointCount !== 1 ? "s" : ""}</span>
                      {result.lastCheckedAt && (
                        <>
                          <span>•</span>
                          <Clock className="h-3 w-3" />
                          <span>{formatDistanceToNow(new Date(result.lastCheckedAt), { addSuffix: true })}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          ) : query.length >= 2 && !isLoading ? (
            <div className="py-6 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                <Search className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">No results found</p>
              <p className="text-xs text-muted-foreground">
                Press Enter to scan this website
              </p>
            </div>
          ) : null}

          {/* New Scan Option */}
          {query.length >= 2 && (
            <div className="border-t">
              <button
                onClick={handleNewScan}
                onMouseEnter={() => setSelectedIndex(results.length)}
                className={cn(
                  "w-full px-3 py-3 flex items-center gap-3 text-left transition-colors",
                  selectedIndex === results.length ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Search className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <span className="text-sm font-medium">Scan &quot;{query}&quot;</span>
                  <p className="text-xs text-muted-foreground">Start a new website scan</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
