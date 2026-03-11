"use client";

import { useState, useEffect, useCallback } from "react";

interface HomepageSkuCountClientProps {
  domainId: string;
  initialScanStatus?: string | null;
}

export function HomepageSkuCountClient({ domainId, initialScanStatus }: HomepageSkuCountClientProps) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Fetch when scan is not in progress
  // When ScanStatusRefresher calls router.refresh(), this component gets
  // updated initialScanStatus prop and re-fetches
  useEffect(() => {
    const isScanning = initialScanStatus === "pending" || initialScanStatus === "processing";
    if (!isScanning) {
      fetchCount();
    }
  }, [initialScanStatus, fetchCount]);

  const isScanning = initialScanStatus === "pending" || initialScanStatus === "processing";
  if (isScanning || loading || count === null) {
    return <p className="text-2xl font-bold text-muted-foreground">—</p>;
  }

  return <p className="text-3xl font-bold">{count}</p>;
}
