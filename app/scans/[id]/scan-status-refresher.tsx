"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useScanPolling } from "@/hooks/use-scan-polling";

/**
 * Invisible component that auto-refreshes the page when a scan completes.
 * Server-rendered sections (risk score, AI score, domain age, status badge)
 * only update via router.refresh() — client polling hooks only update their own data.
 */
export function ScanStatusRefresher({
  domainId,
  initialScanStatus,
}: {
  domainId: string;
  initialScanStatus: string | null | undefined;
}) {
  const router = useRouter();

  const onComplete = useCallback(() => {
    router.refresh();
  }, [router]);

  useScanPolling(domainId, initialScanStatus, onComplete);

  return null;
}
