"use client";

import { AsyncActionButton } from "@/components/async-action-button";

interface RiskScanButtonProps {
  domainId: string;
  hasExistingRiskScore: boolean;
}

export function RiskScanButton({ domainId, hasExistingRiskScore }: RiskScanButtonProps) {
  return (
    <AsyncActionButton
      endpoint={`/api/scans/${domainId}/risk-score`}
      body={{ force: hasExistingRiskScore }}
      label="Rescan"
      loadingLabel="Rescanning…"
    />
  );
}
