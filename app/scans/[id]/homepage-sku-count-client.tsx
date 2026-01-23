"use client";

import { useState, useEffect, useCallback } from "react";

interface HomepageSkuCountClientProps {
  domainId: string;
  initialScanStatus?: string | null;
}

export function HomepageSkuCountClient({ domainId, initialScanStatus }: HomepageSkuCountClientProps) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanStatus, setScanStatus] = useState(initialScanStatus);

  const fetchCount = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/scans/${domainId}/homepage-skus?pageSize=1`
      );
      if (response.ok) {
        const data = await response.json();
        setCount(data.total);
      }
    } catch {
      // Silently fail - will show dash
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  // Only fetch count when scan is completed (not pending/processing)
  useEffect(() => {
    const isScanning = scanStatus === "pending" || scanStatus === "processing";

    if (!isScanning) {
      // Scan is completed or failed - fetch the count
      fetchCount();
    }
    // If scanning, don't fetch - keep showing loading state
  }, [scanStatus, fetchCount]);

  // Poll for scan status while scan is processing
  useEffect(() => {
    const isScanning = scanStatus === "pending" || scanStatus === "processing";
    if (!isScanning) return;

    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await fetch(`/api/scans/${domainId}/status`);
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          // Only update status - the other useEffect will trigger fetchCount when status changes to completed
          setScanStatus(statusData.status);
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [domainId, scanStatus]);

  // Show dash while scan is running or count not yet loaded
  const isScanning = scanStatus === "pending" || scanStatus === "processing";
  if (isScanning || loading || count === null) {
    return <p className="text-2xl font-bold text-muted-foreground">—</p>;
  }

  return <p className="text-3xl font-bold">{count}</p>;
}
