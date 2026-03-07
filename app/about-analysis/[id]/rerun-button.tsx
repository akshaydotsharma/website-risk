"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

export function RerunButton({ domainIds }: { domainIds: string[] }) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleRerun = async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/about-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainIds }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Rerun failed");
      }

      router.push(`/about-analysis/${data.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rerun failed");
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRerun}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4 mr-2" />
      )}
      {isLoading ? "Rerunning…" : "Rerun"}
    </Button>
  );
}
