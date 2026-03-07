"use client";

import { HomepageSkusCard } from "../homepage-skus-card";

export function HomepageSkusTab({
  domainId,
  latestScanStatus,
}: {
  domainId: string;
  latestScanStatus: string | null;
}) {
  return <HomepageSkusCard domainId={domainId} initialScanStatus={latestScanStatus} />;
}
