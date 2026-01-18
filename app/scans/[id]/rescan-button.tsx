"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RotateCw, Loader2 } from "lucide-react";

export function RescanButton({ scanId }: { scanId: string }) {
  const [isRescanning, setIsRescanning] = useState(false);
  const router = useRouter();

  const handleRescan = async () => {
    setIsRescanning(true);

    try {
      const response = await fetch(`/api/scans/${scanId}/rescan`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to rescan");
      }

      // Refresh the page to show updated data
      router.refresh();
    } catch (error) {
      console.error("Rescan error:", error);
      alert("Failed to rescan. Please try again.");
    } finally {
      setIsRescanning(false);
    }
  };

  return (
    <Button
      onClick={handleRescan}
      disabled={isRescanning}
      variant="outline"
      size="sm"
    >
      {isRescanning ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Rescanning...
        </>
      ) : (
        <>
          <RotateCw className="mr-2 h-4 w-4" />
          Rescan
        </>
      )}
    </Button>
  );
}
