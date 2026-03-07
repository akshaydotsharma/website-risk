"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, Info, FileText, ExternalLink, Type, Hash, AlertTriangle, RotateCw, Loader2 } from "lucide-react";
import { ContactDetailsContent } from "./contact-details-content";
import { PolicyLinksCard } from "../policy-links-card";
import type { ContactDetails, AboutPageData } from "@/lib/extractors";

const SUBTABS = [
  { key: "about-us", label: "About Us" },
  { key: "contact-details", label: "Contact Details" },
  { key: "policy-links", label: "Policy Links" },
];

export function WebsiteExtractionTab({
  contact,
  aboutPage,
  domainId,
  latestScanStatus,
}: {
  contact: {
    data: ContactDetails;
    sources: string[];
  } | null;
  aboutPage: AboutPageData | null;
  domainId: string;
  latestScanStatus: string | null;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeSubtab = searchParams.get("subtab") || "about-us";

  const handleSubtabChange = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("subtab", key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  // Use aboutPage data if available, fall back to contact data for URL only
  const aboutUrl = aboutPage?.about_page_url || contact?.data?.about_page_url;

  const [isRescanningAbout, setIsRescanningAbout] = useState(false);

  const handleRescanAbout = async () => {
    setIsRescanningAbout(true);
    try {
      const response = await fetch(`/api/domains/${domainId}/rescan-about`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Rescan failed");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      setIsRescanningAbout(false);
    }
  };

  return (
    <Tabs
      tabs={SUBTABS}
      activeTab={activeSubtab}
      onTabChange={handleSubtabChange}
      variant="compact"
    >
      <TabPanel tabKey="contact-details" activeTab={activeSubtab}>
        <ContactDetailsContent
          data={contact?.data ?? null}
          sources={contact?.sources ?? null}
        />
      </TabPanel>
      <TabPanel tabKey="about-us" activeTab={activeSubtab}>
        <Card>
          <CardHeader className="pb-4 border-b">
            <div className="flex items-start justify-between">
              <CardTitle>About Us</CardTitle>
              {aboutUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRescanAbout}
                  disabled={isRescanningAbout}
                >
                  {isRescanningAbout ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4 mr-2" />
                  )}
                  {isRescanningAbout ? "Rescanning…" : "Rescan"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {aboutPage?.text_content ? (
              <div className="space-y-5">
                {/* About Page URL */}
                {aboutUrl && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      About Page URL
                    </p>
                    <a
                      href={aboutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link hover:underline flex items-center gap-2"
                    >
                      {aboutUrl}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {aboutPage.blocked && (
                  <Badge variant="destructive" className="text-xs gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {aboutPage.blocked_reason || "Bot challenge detected"}
                  </Badge>
                )}

              </div>
            ) : aboutUrl ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    About Page URL
                  </p>
                  <a
                    href={aboutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline flex items-center gap-2"
                  >
                    {aboutUrl}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                  <p>About page URL was discovered but text content has not been extracted yet. Rescan to extract the about page content.</p>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-4">
                <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No about page detected for this website</p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabPanel>
      <TabPanel tabKey="policy-links" activeTab={activeSubtab}>
        <PolicyLinksCard domainId={domainId} initialScanStatus={latestScanStatus} />
      </TabPanel>
    </Tabs>
  );
}
