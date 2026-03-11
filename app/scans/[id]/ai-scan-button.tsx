"use client";

import { AsyncActionButton } from "@/components/async-action-button";

interface AiScanButtonProps {
  domainId: string;
  hasExistingAiScore: boolean;
}

export function AiScanButton({ domainId, hasExistingAiScore }: AiScanButtonProps) {
  return (
    <AsyncActionButton
      endpoint={`/api/scans/${domainId}/extract-ai`}
      body={{ force: hasExistingAiScore }}
      label="Rescan"
      loadingLabel="Rescanning…"
    />
  );
}
