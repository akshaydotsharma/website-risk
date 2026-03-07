"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function AnalysisPolling({ runId }: { runId: string }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/about-analysis/${runId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "completed" || data.status === "failed") {
          router.refresh();
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [runId, router]);

  return (
    <div className="rounded-xl bg-primary/5 border border-primary/20 p-6 text-center">
      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
      <p className="font-medium">Analysis in progress...</p>
      <p className="text-sm text-muted-foreground mt-1">
        Extracting page content, computing similarity, and detecting patterns.
        This page will update automatically.
      </p>
    </div>
  );
}
