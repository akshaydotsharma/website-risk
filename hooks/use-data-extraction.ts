"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Hook for card components that fetch data from a GET endpoint
 * and trigger extraction via POST to the same endpoint.
 *
 * Does NOT poll for scan status — relies on ScanStatusRefresher calling
 * router.refresh() which passes updated initialScanStatus props.
 * Re-fetches data when scan status transitions to completed/failed.
 */
export function useDataExtraction<T>(
  domainId: string,
  endpoint: string,
  initialScanStatus?: string | null,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevStatusRef = useRef(initialScanStatus);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/scans/${domainId}/${endpoint}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [domainId, endpoint]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Re-fetch when scan status transitions to completed/failed
  // (triggered by ScanStatusRefresher calling router.refresh())
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = initialScanStatus;

    const wasScanning = prev === "pending" || prev === "processing";
    const nowDone = initialScanStatus === "completed" || initialScanStatus === "failed";

    if (wasScanning && nowDone) {
      fetchData();
    }
  }, [initialScanStatus, fetchData]);

  const handleExtract = async () => {
    try {
      setExtracting(true);
      setError(null);
      const response = await fetch(`/api/scans/${domainId}/${endpoint}`, {
        method: "POST",
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || `Failed to extract: ${response.status}`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExtracting(false);
    }
  };

  return { data, setData, loading, extracting, error, initialScanStatus, fetchData, handleExtract };
}
