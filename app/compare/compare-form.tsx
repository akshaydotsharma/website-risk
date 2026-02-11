"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, ArrowRight, GitCompare } from "lucide-react";
import { cleanUrl } from "@/lib/utils";

export function CompareForm() {
  const [urlA, setUrlA] = useState("");
  const [urlB, setUrlB] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!urlA.trim() || !urlB.trim()) {
      setError("Please enter both URLs");
      return;
    }

    // Clean URLs
    const cleanedA = cleanUrl(urlA.trim());
    const cleanedB = cleanUrl(urlB.trim());

    if (cleanedA === cleanedB) {
      setError("Please enter two different URLs");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urlA: `https://${cleanedA}`,
          urlB: `https://${cleanedB}`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || "Comparison failed");
      }

      // If comparison already exists, add a query parameter
      if (data.existing) {
        router.push(`/compare/${data.id}?existing=true`);
      } else {
        router.push(`/compare/${data.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-primary" />
          Compare Two Homepages
        </CardTitle>
        <CardDescription>
          Enter the URLs of two websites to analyze their similarity
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Website A</label>
              <Input
                placeholder="example.com"
                value={urlA}
                onChange={(e) => setUrlA(e.target.value)}
                disabled={isLoading}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Website B</label>
              <Input
                placeholder="suspicious-site.com"
                value={urlB}
                onChange={(e) => setUrlB(e.target.value)}
                disabled={isLoading}
                className="h-11"
              />
            </div>
          </div>

          <p className="text-helper">
            Compare two websites to analyze their similarity. Try comparing
            sites with similar layouts or content.
          </p>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" disabled={isLoading} className="w-full h-11">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Comparing...
              </>
            ) : (
              <>
                Compare Homepages
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
