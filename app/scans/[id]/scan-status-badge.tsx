"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface ScanStatusBadgeProps {
  domainId: string;
  initialIsActive: boolean;
  initialStatusCode: number | null;
  initialScanStatus: string | null;
  initialScanCreatedAt: string | null;
}

// Check if a scan is actively in progress
// Note: This should only be called on the client to avoid hydration mismatch
function isActivelyScanning(status: string | null, createdAt: string | null): boolean {
  if (!status || status === "completed" || status === "failed") return false;

  // For pending/processing, check if scan is recent (within 5 minutes)
  if (!createdAt) return false;
  const scanAge = Date.now() - new Date(createdAt).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  return (status === "pending" || status === "processing") && scanAge < fiveMinutes;
}

export function ScanStatusBadge({
  domainId,
  initialIsActive,
  initialStatusCode,
  initialScanStatus,
  initialScanCreatedAt,
}: ScanStatusBadgeProps) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(initialIsActive);
  const [statusCode, setStatusCode] = useState(initialStatusCode);
  const [scanStatus, setScanStatus] = useState(initialScanStatus);
  const [scanCreatedAt, setScanCreatedAt] = useState(initialScanCreatedAt);
  // Start with false to match server render, then compute on client
  const [scanning, setScanning] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // Track if we were scanning to detect completion
  const wasScanning = useRef(false);

  // Compute scanning state only on client after mount
  useEffect(() => {
    setHasMounted(true);
    const isScanning = isActivelyScanning(scanStatus, scanCreatedAt);
    setScanning(isScanning);
    wasScanning.current = isScanning;
  }, []);

  // Update scanning state when status changes (after mount)
  useEffect(() => {
    if (!hasMounted) return;
    setScanning(isActivelyScanning(scanStatus, scanCreatedAt));
  }, [scanStatus, scanCreatedAt, hasMounted]);

  // Poll for status updates when scanning
  useEffect(() => {
    if (!scanning) return;

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/scans/${domainId}/status`);
        if (response.ok) {
          const data = await response.json();
          setScanStatus(data.status);
          setScanCreatedAt(data.createdAt);
          if (data.status === "completed" || data.status === "failed") {
            setIsActive(data.isActive);
            setStatusCode(data.statusCode);
          }
        }
      } catch (error) {
        console.error("Failed to poll scan status:", error);
      }
    };

    // Poll immediately on mount, then every 2 seconds
    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [domainId, scanning]);

  // Refresh the page when scan completes to show new data
  useEffect(() => {
    if (wasScanning.current && !scanning) {
      // Scan just completed - add a small delay then refresh server components
      // The delay ensures database writes are fully committed before re-fetching
      const timer = setTimeout(() => {
        router.refresh();
      }, 300);
      return () => clearTimeout(timer);
    }
    wasScanning.current = scanning;
  }, [scanning, router]);

  if (scanning) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Scanning
      </Badge>
    );
  }

  return (
    <Badge variant={isActive ? "success" : "destructive"}>
      {isActive ? `Active (${statusCode})` : "Inactive"}
    </Badge>
  );
}
