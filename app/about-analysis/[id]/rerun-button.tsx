"use client";

import { RefreshCw } from "lucide-react";
import { AsyncActionButton } from "@/components/async-action-button";

export function RerunButton({ domainIds }: { domainIds: string[] }) {
  return (
    <AsyncActionButton
      endpoint="/api/about-analysis"
      body={{ domainIds }}
      label="Rerun"
      loadingLabel="Rerunning…"
      icon={RefreshCw}
      onSuccess={(data) => {
        window.location.href = `/about-analysis/${data.id}`;
      }}
    />
  );
}
