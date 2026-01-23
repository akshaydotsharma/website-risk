"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";

interface RiskScanButtonProps {
  domainId: string;
  hasExistingRiskScore: boolean;
}

export function RiskScanButton({ domainId, hasExistingRiskScore }: RiskScanButtonProps) {
  const [isScanning, setIsScanning] = useState(false);
  const router = useRouter();

  const handleRiskScan = async () => {
    setIsScanning(true);

    try {
      const response = await fetch(`/api/scans/${domainId}/risk-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: hasExistingRiskScore }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || "Failed to run risk scan");
      }

      // Refresh the page to show updated data
      router.refresh();
    } catch (error) {
      console.error("Risk scan error:", error);
      const message = error instanceof Error ? error.message : "Failed to run risk scan";
      alert(`Risk Scan failed: ${message}`);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <Button
      onClick={handleRiskScan}
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
          <AlertTriangle className="mr-2 h-4 w-4" />
          {hasExistingRiskScore ? "Re-scan Risk" : "Risk Scan"}
        </>
      )}
    </Button>
  );
}
