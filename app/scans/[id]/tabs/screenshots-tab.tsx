"use client";

import { ScreenshotsCard } from "../screenshots-card";

export function ScreenshotsTab({
  domainId,
  latestScanStatus,
}: {
  domainId: string;
  latestScanStatus: string | null;
}) {
  return <ScreenshotsCard domainId={domainId} initialScanStatus={latestScanStatus} />;
}
