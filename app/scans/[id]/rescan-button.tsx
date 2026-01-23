"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RotateCw, Loader2, Shield, ChevronDown, ChevronUp, CheckCircle } from "lucide-react";

interface RescanButtonProps {
  scanId: string;
  normalizedUrl?: string;
}

export function RescanButton({ scanId, normalizedUrl }: RescanButtonProps) {
  const [isRescanning, setIsRescanning] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [addToAuthorizedList, setAddToAuthorizedList] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const router = useRouter();

  // Check if domain is already authorized
  useEffect(() => {
    if (!normalizedUrl) return;

    const checkAuthorized = async () => {
      try {
        const response = await fetch("/api/authorized-domains");
        if (response.ok) {
          const data = await response.json();
          const authorized = data.domains?.some(
            (d: { domain: string }) => d.domain === normalizedUrl || normalizedUrl.endsWith(`.${d.domain}`)
          );
          setIsAuthorized(authorized);
        }
      } catch (error) {
        console.error("Error checking authorized status:", error);
      }
    };

    checkAuthorized();
  }, [normalizedUrl]);

  const handleRescan = async () => {
    setIsRescanning(true);

    try {
      const response = await fetch(`/api/scans/${scanId}/rescan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ addToAuthorizedList }),
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
      setShowOptions(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
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
        {!isRescanning && normalizedUrl && (
          <Button
            onClick={() => setShowOptions(!showOptions)}
            variant="outline"
            size="sm"
            className="px-2"
          >
            {showOptions ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {/* Options Dropdown */}
      {showOptions && normalizedUrl && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-popover border rounded-lg shadow-lg p-3 z-50">
          {isAuthorized ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span>Domain is authorized</span>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Add to authorized list</span>
              </div>
              <Switch
                checked={addToAuthorizedList}
                onCheckedChange={setAddToAuthorizedList}
              />
            </div>
          )}
          {addToAuthorizedList && !isAuthorized && (
            <p className="text-xs text-muted-foreground mt-2">
              Domain will be added with default thresholds before rescanning
            </p>
          )}
        </div>
      )}
    </div>
  );
}
