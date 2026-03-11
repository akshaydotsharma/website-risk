"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Hook that polls scan status and calls onComplete when scan finishes.
 * Replaces 4+ identical polling useEffect blocks across card components.
 */
export function useScanPolling(
  domainId: string,
  initialStatus: string | null | undefined,
  onComplete: () => void,
  /** Polling interval in ms (default 2000) */
  intervalMs = 2000,
) {
  const [scanStatus, setScanStatus] = useState(initialStatus);

  useEffect(() => {
    const isScanning = scanStatus === "pending" || scanStatus === "processing";
    if (!isScanning) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/scans/${domainId}/status`);
        if (response.ok) {
          const data = await response.json();
          setScanStatus(data.status);
          if (data.status === "completed" || data.status === "failed") {
            onComplete();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, intervalMs);

    return () => clearInterval(pollInterval);
  }, [domainId, scanStatus, onComplete, intervalMs]);

  return { scanStatus, setScanStatus };
}
