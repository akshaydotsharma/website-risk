"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, Suspense } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import {
  Bot,
  AlertTriangle,
  Globe,
  ShoppingCart,
  Camera,
  Database,
} from "lucide-react";

import { AiLikelihoodTab } from "./tabs/ai-likelihood-tab";
import { RiskAssessmentTab } from "./tabs/risk-assessment-tab";
import { WebsiteExtractionTab } from "./tabs/website-extraction-tab";
import { HomepageSkusTab } from "./tabs/homepage-skus-tab";
import { ScreenshotsTab } from "./tabs/screenshots-tab";
import { RawDataTab } from "./tabs/raw-data-tab";

import type { AiGeneratedLikelihood, ContactDetails, AboutPageData } from "@/lib/extractors";
import type { RiskAssessment, DomainIntelSignals } from "@/lib/domainIntel/schemas";

export interface TabData {
  domainId: string;
  latestScanStatus: string | null;
  skuCount: number;
  screenshotCount: number;
  ai: {
    data: AiGeneratedLikelihood;
    rawOpenAIResponse: any;
  } | null;
  risk: {
    data: RiskAssessment;
  } | null;
  contact: {
    data: ContactDetails;
    sources: string[];
  } | null;
  aboutPage: AboutPageData | null;
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
}

function getTabDefinitions(skuCount: number, screenshotCount: number) {
  return [
    { key: "website-extraction", label: "Website Content" },
    { key: "homepage-skus", label: "Homepage SKUs", ...(skuCount > 0 && { badge: skuCount }) },
    { key: "risk-assessment", label: "Risk Assessment" },
    { key: "ai-likelihood", label: "AI Likelihood" },
    { key: "screenshots", label: "Screenshots", ...(screenshotCount > 0 && { badge: screenshotCount }) },
    { key: "raw-data", label: "Raw Data" },
  ];
}

function ScanDetailTabsInner({ data }: { data: TabData }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = searchParams.get("tab") || "website-extraction";

  const handleTabChange = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", key);
      params.delete("subtab");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  return (
    <Tabs tabs={getTabDefinitions(data.skuCount, data.screenshotCount)} activeTab={activeTab} onTabChange={handleTabChange} className="bg-[hsl(220,14%,97.5%)] dark:bg-card rounded-xl p-4 sm:p-6">
      <TabPanel tabKey="ai-likelihood" activeTab={activeTab}>
        <AiLikelihoodTab ai={data.ai} domainId={data.domainId} />
      </TabPanel>

      <TabPanel tabKey="risk-assessment" activeTab={activeTab}>
        <RiskAssessmentTab risk={data.risk} domainId={data.domainId} />
      </TabPanel>

      <TabPanel tabKey="website-extraction" activeTab={activeTab}>
        <WebsiteExtractionTab
          contact={data.contact}
          aboutPage={data.aboutPage}
          domainId={data.domainId}
          latestScanStatus={data.latestScanStatus}
        />
      </TabPanel>

      <TabPanel tabKey="homepage-skus" activeTab={activeTab}>
        <HomepageSkusTab
          domainId={data.domainId}
          latestScanStatus={data.latestScanStatus}
        />
      </TabPanel>

      <TabPanel tabKey="screenshots" activeTab={activeTab}>
        <ScreenshotsTab
          domainId={data.domainId}
          latestScanStatus={data.latestScanStatus}
        />
      </TabPanel>

      <TabPanel tabKey="raw-data" activeTab={activeTab}>
        <RawDataTab
          signals={data.signals}
          dataPoints={data.dataPoints}
          crawlFetchLogs={data.crawlFetchLogs}
          signalLogs={data.signalLogs}
          scans={data.scans}
        />
      </TabPanel>
    </Tabs>
  );
}

export function ScanDetailTabs({ data }: { data: TabData }) {
  return (
    <Suspense fallback={<div className="h-12 bg-muted/30 rounded animate-pulse" />}>
      <ScanDetailTabsInner data={data} />
    </Suspense>
  );
}
