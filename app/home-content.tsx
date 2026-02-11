"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Search,
  Mail,
  FileText,
  ShoppingCart,
  Cpu,
  ArrowRight,
  Radar,
  AlertCircle,
} from "lucide-react";
import { cleanUrl } from "@/lib/utils";

export default function HomePageContent() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill URL from query parameter
  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam) {
      setUrl(urlParam);
    }
  }, [searchParams]);

  // Auto-normalize URL on blur
  const handleUrlBlur = () => {
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      // Don't auto-modify, just validate
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("Please enter a website URL");
      return;
    }

    // Clean and normalize the URL for consistent handling
    const cleanedUrl = cleanUrl(url);
    // Add https:// protocol for the API request
    const normalizedUrl = `https://${cleanedUrl}`;

    setIsLoading(true);

    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: normalizedUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create scan");
      }

      // Redirect to scan detail page
      router.push(`/scans/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
    }
  };

  const featureChips = [
    { icon: Mail, label: "Contact Details", color: "text-blue-600" },
    { icon: FileText, label: "Policy Links", color: "text-green-600" },
    { icon: ShoppingCart, label: "Homepage SKUs", color: "text-purple-600" },
    { icon: Cpu, label: "Tech Signals", color: "text-primary" },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Hero Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 py-4">
        <div className="space-y-3">
          <h1 className="text-page-title">Domain Risk Scanner</h1>
          <p className="text-page-subtitle max-w-lg">
            Scan a domain to extract risk signals: policies, contact footprint, product footprint, and technical indicators.
          </p>
        </div>
        <div className="hidden lg:flex items-center justify-center w-28 h-28 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10">
          <Radar className="w-14 h-14 text-primary/50 animate-pulse" aria-hidden="true" />
        </div>
      </div>

      <div>
        {/* Main Scan Card */}
        <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" aria-hidden="true" />
                Start a New Scan
              </CardTitle>
              <CardDescription>
                Enter any domain to begin intelligence extraction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="example.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onBlur={handleUrlBlur}
                      disabled={isLoading}
                      aria-label="Website domain to scan"
                      aria-describedby="url-helper"
                      aria-invalid={error ? "true" : undefined}
                      className="text-base pr-4 h-12"
                    />
                  </div>
                  <p id="url-helper" className="text-helper">
                    Try: shopify.com, stripe.com, or any domain you want to analyze
                  </p>
                </div>

                {/* Feature Chips */}
                <div className="space-y-2">
                  <p className="text-label">
                    Extracting
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {featureChips.map((chip) => (
                      <Badge
                        key={chip.label}
                        variant="outline"
                        className="gap-1.5 py-1 px-2.5"
                      >
                        <chip.icon className={`h-3.5 w-3.5 ${chip.color}`} aria-hidden="true" />
                        {chip.label}
                      </Badge>
                    ))}
                  </div>
                </div>

                {error && (
                  <div
                    className="p-3 bg-danger-tint border border-destructive/20 rounded-lg text-sm text-destructive flex items-start gap-2"
                    role="alert"
                  >
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    {error}
                  </div>
                )}

                <Button type="submit" disabled={isLoading} className="w-full h-11">
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      Scan Domain
                      <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
      </div>
    </div>
  );
}
