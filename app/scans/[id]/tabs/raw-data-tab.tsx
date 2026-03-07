"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Layers, FileText, Database, Activity, Radio } from "lucide-react";
import { DomainIntelTab } from "./domain-intel-tab";
import { SourcesTab } from "./sources-tab";
import { CrawlActivityTab } from "./crawl-activity-tab";
import { SignalLogsTab } from "./signal-logs-tab";
import { RawOutputContent } from "./raw-output-content";
import type { DomainIntelSignals } from "@/lib/domainIntel/schemas";

const SUBTABS = [
  { key: "domain-intel", label: "Domain Intel" },
  { key: "sources", label: "Sources" },
  { key: "raw-output", label: "Raw Data" },
  { key: "crawl-activity", label: "Crawl Activity" },
  { key: "signal-logs", label: "Signal Logs" },
];

export function RawDataTab({
  signals,
  dataPoints,
  crawlFetchLogs,
  signalLogs,
  scans,
}: {
  signals: DomainIntelSignals | null;
  dataPoints: {
    id: string;
    key: string;
    label: string;
    value: any;
    sources: string[];
    rawOpenAIResponse: any;
  }[];
  crawlFetchLogs: any[];
  signalLogs: any[];
  scans: any[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeSubtab = searchParams.get("subtab") || "domain-intel";

  const handleSubtabChange = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("subtab", key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  return (
    <Tabs
      tabs={SUBTABS}
      activeTab={activeSubtab}
      onTabChange={handleSubtabChange}
      variant="compact"
    >
      <TabPanel tabKey="domain-intel" activeTab={activeSubtab}>
        <DomainIntelTab signals={signals} />
      </TabPanel>

      <TabPanel tabKey="sources" activeTab={activeSubtab}>
        <SourcesTab dataPoints={dataPoints} />
      </TabPanel>

      <TabPanel tabKey="raw-output" activeTab={activeSubtab}>
        <RawOutputContent
          dataPoints={dataPoints}
          scans={scans}
        />
      </TabPanel>

      <TabPanel tabKey="crawl-activity" activeTab={activeSubtab}>
        <CrawlActivityTab crawlFetchLogs={crawlFetchLogs} />
      </TabPanel>

      <TabPanel tabKey="signal-logs" activeTab={activeSubtab}>
        <SignalLogsTab signalLogs={signalLogs} />
      </TabPanel>
    </Tabs>
  );
}
