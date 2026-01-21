"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Bot, Loader2 } from "lucide-react";

interface AiScanButtonProps {
  domainId: string;
  hasExistingAiScore: boolean;
}

export function AiScanButton({ domainId, hasExistingAiScore }: AiScanButtonProps) {
  const [isScanning, setIsScanning] = useState(false);
  const router = useRouter();

  const handleAiScan = async () => {
    setIsScanning(true);

    try {
      const response = await fetch(`/api/scans/${domainId}/extract-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: hasExistingAiScore }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || "Failed to run AI scan");
      }

      // Refresh the page to show updated data
      router.refresh();
    } catch (error) {
      console.error("AI scan error:", error);
      const message = error instanceof Error ? error.message : "Failed to run AI scan";
      alert(`AI Scan failed: ${message}`);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <Button
      onClick={handleAiScan}
      disabled={isScanning}
      variant="outline"
      size="sm"
    >
      {isScanning ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Analyzing...
        </>
      ) : (
        <>
          <Bot className="mr-2 h-4 w-4" />
          {hasExistingAiScore ? "Re-analyze AI" : "AI Scan"}
        </>
      )}
    </Button>
  );
}
