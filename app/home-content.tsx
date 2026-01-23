"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Shield } from "lucide-react";
import { cleanUrl } from "@/lib/utils";

export default function HomePageContent() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addToAuthorizedList, setAddToAuthorizedList] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill URL from query parameter
  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam) {
      setUrl(urlParam);
    }
  }, [searchParams]);

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
        body: JSON.stringify({ url: normalizedUrl, addToAuthorizedList }),
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

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Website Risk Intel</h1>
        <p className="text-muted-foreground">
          Scan websites to extract intelligence signals for risk assessment
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Start a New Scan</CardTitle>
          <CardDescription>
            Enter a website URL to scan and extract intelligence data points
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isLoading}
                className="text-base"
              />
              <p className="text-xs text-muted-foreground">
                Currently extracting: Contact details (emails, phones, addresses, social links)
              </p>
            </div>

            {/* Add to Authorized List Toggle */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Add to authorized list</p>
                  <p className="text-xs text-muted-foreground">
                    Enable full crawling with default thresholds
                  </p>
                </div>
              </div>
              <Switch
                checked={addToAuthorizedList}
                onCheckedChange={setAddToAuthorizedList}
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                addToAuthorizedList ? "Add to List & Scan Website" : "Scan Website"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What gets scanned?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <strong className="text-foreground">Active Status:</strong> We check if the
            website is online and responding
          </div>
          <div>
            <strong className="text-foreground">Data Points:</strong> We extract structured
            intelligence signals from the website
          </div>
          <div className="pl-4 space-y-1">
            <div>• Contact details (current)</div>
            <div>• More data points coming soon (trust signals, legal pages, etc.)</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
