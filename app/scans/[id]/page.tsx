import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardDivider } from "@/components/ui/card";
import { getScoreTextColor, getScoreBgColor, getScoreBgColorSubtle, getRiskLabel, getAiLikelihoodLabel, getConfidenceColor } from "@/lib/utils";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ExternalLink, Mail, Phone, MapPin, Link2, Globe, Activity, CheckCircle, XCircle, Clock, AlertCircle, ChevronLeft, History, Bot, AlertTriangle, Info, ChevronDown, ChevronUp, ShoppingCart, Calendar } from "lucide-react";
import Link from "next/link";
import { RescanButton } from "./rescan-button";
import { AiScanButton } from "./ai-scan-button";
import { RiskScanButton } from "./risk-scan-button";
import { HomepageSkusCard } from "./homepage-skus-card";
import { HomepageSkuCountClient } from "./homepage-sku-count-client";
import { ScanStatusBadge } from "./scan-status-badge";
import { PolicyLinksCard } from "./policy-links-card";
import { InvestigationNotes } from "./investigation-notes";
import type { ContactDetails, AiGeneratedLikelihood } from "@/lib/extractors";
import type { RiskAssessment, DomainIntelSignals } from "@/lib/domainIntel/schemas";

export const dynamic = "force-dynamic";

// This page can receive either a domain ID (hash) or a scan ID
async function getDomainData(id: string) {
  // First try to find as domain ID
  let domain = await prisma.domain.findUnique({
    where: { id },
    include: {
      dataPoints: true,
      scans: {
        orderBy: { createdAt: "desc" },
        take: 10, // Limit to recent scans
        include: {
          dataPoints: true,
          // Only load logs for display - limited to prevent timeout
          crawlFetchLogs: {
            orderBy: { createdAt: "asc" },
            take: 100, // Limit logs to prevent slow queries
          },
          signalLogs: {
            orderBy: { createdAt: "asc" },
            take: 100, // Limit logs to prevent slow queries
          },
        },
      },
      urlInputs: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      investigationNotes: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  // If not found as domain, try to find the scan and get its domain
  if (!domain) {
    const scan = await prisma.websiteScan.findUnique({
      where: { id },
      include: { domain: true },
    });

    if (scan) {
      domain = await prisma.domain.findUnique({
        where: { id: scan.domainId },
        include: {
          dataPoints: true,
          scans: {
            orderBy: { createdAt: "desc" },
            take: 10, // Limit to recent scans
            include: {
              dataPoints: true,
              crawlFetchLogs: {
                orderBy: { createdAt: "asc" },
                take: 100,
              },
              signalLogs: {
                orderBy: { createdAt: "asc" },
                take: 100,
              },
            },
          },
          urlInputs: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
          investigationNotes: {
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }
  }

  return domain;
}

export default async function ScanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = await getDomainData(id);

  if (!domain) {
    notFound();
  }

  // Get the most recent scan for display
  const latestScan = domain.scans[0];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Sticky Report Header */}
      <div className="sticky top-16 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/scans"
              className="text-muted-foreground hover:text-foreground transition-colors duration-150 p-1 rounded-md hover:bg-muted"
              aria-label="Back to scan history"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <a
                href={`https://${domain.normalizedUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-semibold text-link hover:underline flex items-center gap-2"
              >
                {domain.normalizedUrl}
                <ExternalLink className="h-4 w-4" />
              </a>
              <div className="flex items-center gap-2 mt-0.5">
                <ScanStatusBadge
                  domainId={domain.id}
                  initialIsActive={domain.isActive}
                  initialStatusCode={domain.statusCode}
                  initialScanStatus={latestScan?.status ?? null}
                  initialScanCreatedAt={latestScan?.createdAt?.toISOString() ?? null}
                />
                <span className="text-xs text-muted-foreground">
                  Last scanned {domain.lastCheckedAt ? format(new Date(domain.lastCheckedAt), "MMM d, h:mm a") : "Never"}
                </span>
              </div>
            </div>
          </div>
          <RescanButton
            scanId={domain.id}
            domainId={domain.id}
            isManuallyRisky={domain.isManuallyRisky}
            initialScanStatus={latestScan?.status ?? null}
            initialScanCreatedAt={latestScan?.createdAt?.toISOString() ?? null}
          />
        </div>
      </div>

      {/* Summary Card */}
      <SummaryCard domain={domain} latestScan={latestScan} />

      {/* Assessments Section */}
      <div>
        <h2 className="text-section-title mb-4">Assessments</h2>
        <div className="space-y-4">
          {/* AI Generated Likelihood */}
          {(() => {
            const aiDataPoint = domain.dataPoints.find((dp: any) => dp.key === "ai_generated_likelihood");
            if (aiDataPoint) {
              const value = JSON.parse(aiDataPoint.value);
              const rawResponse = JSON.parse(aiDataPoint.rawOpenAIResponse || "{}");
              return (
                <AiGeneratedLikelihoodCard
                  key={aiDataPoint.id}
                  data={value as AiGeneratedLikelihood}
                  rawOpenAIResponse={rawResponse}
                  domainId={domain.id}
                />
              );
            }
            return (
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1.5">
                      <CardTitle className="flex items-center gap-2">
                        <Bot className="h-5 w-5" />
                        AI-generated likelihood
                      </CardTitle>
                      <CardDescription>
                        Heuristic estimate based on content, markup, and infrastructure signals
                      </CardDescription>
                    </div>
                    <AiScanButton
                      domainId={domain.id}
                      hasExistingAiScore={false}
                    />
                  </div>
                </CardHeader>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>AI likelihood assessment not yet generated</p>
                  <p className="text-sm mt-1">Click &quot;Re-analyze AI&quot; to analyze</p>
                </CardContent>
              </Card>
            );
          })()}

          {/* Risk Assessment */}
          {(() => {
            const riskDataPoint = domain.dataPoints.find((dp: any) => dp.key === "domain_risk_assessment");
            if (riskDataPoint) {
              const value = JSON.parse(riskDataPoint.value);
              return (
                <RiskAssessmentCard
                  key={riskDataPoint.id}
                  data={value as RiskAssessment}
                  domainId={domain.id}
                />
              );
            }
            return (
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1.5">
                      <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Risk Assessment
                      </CardTitle>
                      <CardDescription>
                        Multi-factor risk analysis based on domain intelligence signals
                      </CardDescription>
                    </div>
                    <RiskScanButton
                      domainId={domain.id}
                      hasExistingRiskScore={false}
                    />
                  </div>
                </CardHeader>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Risk assessment not yet generated</p>
                  <p className="text-sm mt-1">Click &quot;Re-scan Risk&quot; to analyze</p>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      </div>

      {/* Data Points Extracted Section */}
      <div>
        <h2 className="text-section-title mb-4">Data Points Extracted</h2>
        <div className="space-y-4">
          {/* Contact Details */}
          {(() => {
            const contactDataPoint = domain.dataPoints.find((dp: any) => dp.key === "contact_details");
            if (contactDataPoint) {
              const value = JSON.parse(contactDataPoint.value);
              const sources = JSON.parse(contactDataPoint.sources);
              return (
                <ContactDetailsCard
                  key={contactDataPoint.id}
                  data={value as ContactDetails}
                  sources={sources}
                />
              );
            }
            return (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No contact details extracted yet</p>
                </CardContent>
              </Card>
            );
          })()}

          {/* Homepage SKUs */}
          <HomepageSkusCard domainId={domain.id} initialScanStatus={latestScan?.status} />

          {/* Policy Links */}
          <PolicyLinksCard domainId={domain.id} initialScanStatus={latestScan?.status} />

          {/* Domain Intelligence Signals */}
          {(() => {
            const signalsDataPoint = domain.dataPoints.find((dp: any) => dp.key === "domain_intel_signals");
            if (signalsDataPoint) {
              const value = JSON.parse(signalsDataPoint.value);
              return (
                <DomainIntelSignalsCard
                  key={signalsDataPoint.id}
                  data={value as DomainIntelSignals}
                />
              );
            }
            return null;
          })()}
        </div>
      </div>

      {/* Sources */}
      {domain.dataPoints.length > 0 && (
        <Accordion>
          <AccordionItem title="Sources - Web pages used to extract intelligence">
            <div className="space-y-2">
              {domain.dataPoints.map((dataPoint: any) => {
                const sources = JSON.parse(dataPoint.sources) as string[];
                return sources.map((source, idx) => (
                  <a
                    key={`${dataPoint.id}-${idx}`}
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-link hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                    {source}
                  </a>
                ));
              })}
            </div>
          </AccordionItem>
        </Accordion>
      )}

      {/* Raw Output */}
      {domain.dataPoints.length > 0 && (
        <Accordion>
          {domain.dataPoints.map((dataPoint: any) => {
            const rawResponse = JSON.parse(dataPoint.rawOpenAIResponse);
            return (
              <AccordionItem
                key={dataPoint.id}
                title={`Raw AI Response - ${dataPoint.label}`}
              >
                <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
                  {JSON.stringify(rawResponse, null, 2)}
                </pre>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Crawl Activity Log (from latest scan) */}
      {latestScan && latestScan.crawlFetchLogs && latestScan.crawlFetchLogs.length > 0 && (
        <Accordion>
          <AccordionItem title={`Crawl Activity Log - ${latestScan.crawlFetchLogs.length} requests`}>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Status</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-[100px]">Source</TableHead>
                    <TableHead className="w-[80px]">Duration</TableHead>
                    <TableHead className="w-[80px]">Robots</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestScan.crawlFetchLogs.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        {log.statusCode ? (
                          <Badge
                            variant={log.statusCode >= 200 && log.statusCode < 400 ? "success" : "destructive"}
                            className="text-xs"
                          >
                            {log.statusCode}
                          </Badge>
                        ) : log.errorMessage ? (
                          <Badge variant="destructive" className="text-xs">
                            Error
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            -
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <a
                            href={log.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-link hover:underline truncate max-w-md"
                            title={log.url}
                          >
                            {log.url}
                          </a>
                          {log.errorMessage && (
                            <span className="text-xs text-destructive flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {log.errorMessage}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {log.source.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {log.fetchDurationMs}ms
                        </span>
                      </TableCell>
                      <TableCell>
                        {log.robotsAllowed ? (
                          <CheckCircle className="h-4 w-4 text-success" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex justify-between text-sm text-muted-foreground">
              <span>
                Total requests: {latestScan.crawlFetchLogs.length}
              </span>
              <span>
                Successful: {latestScan.crawlFetchLogs.filter((l: any) => l.statusCode && l.statusCode >= 200 && l.statusCode < 400).length}
                {" | "}
                Failed: {latestScan.crawlFetchLogs.filter((l: any) => !l.statusCode || l.statusCode >= 400).length}
              </span>
            </div>
          </AccordionItem>
        </Accordion>
      )}

      {/* Signal Logs (from latest scan) - Collapsed */}
      {latestScan && latestScan.signalLogs && latestScan.signalLogs.length > 0 && (
        <Accordion>
          <AccordionItem title={
            <span className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Signal Logs - {latestScan.signalLogs.length} signals
            </span>
          }>
            <p className="text-sm text-muted-foreground mb-4">
              Computed signals from risk intelligence analysis
            </p>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Category</TableHead>
                    <TableHead className="w-[180px]">Signal</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-[80px]">Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestScan.signalLogs.slice(0, 50).map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {log.category.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.name}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate">
                        {log.valueType === "boolean" ? (
                          log.valueBoolean ? (
                            <CheckCircle className="h-4 w-4 text-success" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )
                        ) : log.valueType === "number" ? (
                          <span className="font-mono">{log.valueNumber}</span>
                        ) : log.valueType === "json" ? (
                          <span className="text-muted-foreground">[JSON]</span>
                        ) : (
                          <span className="truncate">{log.valueString || "-"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.severity === "risk_hint" ? "destructive" :
                            log.severity === "warning" ? "secondary" : "outline"
                          }
                          className="text-xs"
                        >
                          {log.severity}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {latestScan.signalLogs.length > 50 && (
              <p className="text-xs text-muted-foreground mt-2">
                Showing 50 of {latestScan.signalLogs.length} signals
              </p>
            )}
          </AccordionItem>
        </Accordion>
      )}

      {/* Scan History */}
      {domain.scans.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Scan History</CardTitle>
            <CardDescription>
              Previous scans for this domain
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {domain.scans.map((scan, idx) => (
                <div
                  key={scan.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={scan.isActive ? "success" : "destructive"} className="text-xs">
                      {scan.isActive ? scan.statusCode : "Inactive"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(scan.checkedAt), "PPp")}
                    </span>
                    {idx === 0 && (
                      <Badge variant="outline" className="text-xs">Latest</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {scan.dataPoints.length} data points
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* URL Input History */}
      {domain.urlInputs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              URL Input History
            </CardTitle>
            <CardDescription>
              Different URL formats that resolved to this domain
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {domain.urlInputs.map((input) => (
                <div key={input.id} className="flex items-center justify-between text-sm">
                  <code className="bg-muted px-2 py-1 rounded text-xs">
                    {input.rawInput}
                  </code>
                  <span className="text-muted-foreground text-xs">
                    {format(new Date(input.createdAt), "MMM d, yyyy 'at' h:mm a")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Investigation Notes - at the end */}
      <InvestigationNotes
        domainId={domain.id}
        initialNotes={domain.investigationNotes}
      />
    </div>
  );
}

function ContactDetailsCard({
  data,
  sources,
}: {
  data: ContactDetails;
  sources: string[];
}) {
  const hasEmails = data.emails.length > 0;
  const hasPhones = data.phone_numbers.length > 0;
  const hasAddresses = data.addresses.length > 0;
  const hasContactForms = data.contact_form_urls.length > 0;
  const hasSocial =
    data.social_links.linkedin ||
    data.social_links.twitter ||
    data.social_links.facebook ||
    data.social_links.instagram ||
    data.social_links.other.length > 0;

  return (
    <Card>
      <CardHeader tint="data" className="pb-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Contact Details
          </CardTitle>
          <CardDescription>
            Contact information extracted from the website
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {data.primary_contact_page_url && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Primary Contact Page
            </p>
            <a
              href={data.primary_contact_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link hover:underline flex items-center gap-2"
            >
              {data.primary_contact_page_url}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {hasEmails && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Addresses
            </p>
            <ul className="space-y-1">
              {data.emails.map((email, idx) => (
                <li key={idx}>
                  <a href={`mailto:${email}`} className="text-link hover:underline">
                    {email}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasPhones && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Phone Numbers
            </p>
            <ul className="space-y-1">
              {data.phone_numbers.map((phone, idx) => (
                <li key={idx}>
                  <a href={`tel:${phone}`} className="text-link hover:underline">
                    {phone}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasAddresses && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Physical Addresses
            </p>
            <ul className="space-y-1">
              {data.addresses.map((address, idx) => (
                <li key={idx} className="text-sm">
                  {address}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasContactForms && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Contact Forms
            </p>
            <ul className="space-y-1">
              {data.contact_form_urls.map((url, idx) => (
                <li key={idx}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline flex items-center gap-2"
                  >
                    {url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasSocial && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Social Media Links
            </p>
            <ul className="space-y-1">
              {data.social_links.linkedin && (
                <li>
                  <a
                    href={data.social_links.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline flex items-center gap-2"
                  >
                    LinkedIn: {data.social_links.linkedin}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.twitter && (
                <li>
                  <a
                    href={data.social_links.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline flex items-center gap-2"
                  >
                    Twitter: {data.social_links.twitter}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.facebook && (
                <li>
                  <a
                    href={data.social_links.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline flex items-center gap-2"
                  >
                    Facebook: {data.social_links.facebook}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.instagram && (
                <li>
                  <a
                    href={data.social_links.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline flex items-center gap-2"
                  >
                    Instagram: {data.social_links.instagram}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              )}
              {data.social_links.other.map((url, idx) => (
                <li key={idx}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline flex items-center gap-2"
                  >
                    Other: {url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Only show notes if they're short and actionable, not verbose explanations */}
        {data.notes && data.notes.length < 150 && !data.notes.toLowerCase().includes('no contact') && !data.notes.toLowerCase().includes('not found') && !data.notes.toLowerCase().includes('appears to be') && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Notes</p>
            <p className="text-sm">{data.notes}</p>
          </div>
        )}

        {!hasEmails &&
          !hasPhones &&
          !hasAddresses &&
          !hasContactForms &&
          !hasSocial && (
            <p className="text-muted-foreground text-center py-4">
              No contact details found
            </p>
          )}
      </CardContent>
    </Card>
  );
}

interface OpenAIResponseStatus {
  error?: string;
  fallback?: boolean;
  model?: string;
  analysis?: string;
}

function AiGeneratedLikelihoodCard({
  data,
  rawOpenAIResponse,
  domainId,
}: {
  data: AiGeneratedLikelihood;
  rawOpenAIResponse?: OpenAIResponseStatus;
  domainId: string;
}) {
  const score = data.ai_generated_score;
  const confidence = data.confidence;

  // Determine if OpenAI analysis failed
  const openAiFailed = rawOpenAIResponse?.fallback === true || !!rawOpenAIResponse?.error;
  const openAiError = rawOpenAIResponse?.error;

  return (
    <Card>
      <CardHeader tint="ai" className="pb-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-purple-600" />
              AI-generated likelihood
            </CardTitle>
            <CardDescription>
              Heuristic estimate based on content, markup, and infrastructure signals
            </CardDescription>
          </div>
          <AiScanButton
            domainId={domainId}
            hasExistingAiScore={true}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">

        {/* Main Score Display */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-5xl font-bold ${getScoreTextColor(score)}`}>
              {score}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {getAiLikelihoodLabel(score)}
            </div>
          </div>
          <div className="flex-1">
            <div className="h-4 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${getScoreBgColor(score)} transition-all duration-300`}
                style={{ width: `${score}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0 - Not AI</span>
              <span>100 - Very AI-like</span>
            </div>
          </div>
        </div>

        {/* Confidence Display */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Confidence:</span>
            <span className={`text-sm font-bold ${getConfidenceColor(confidence)}`}>
              {confidence}%
            </span>
          </div>
          {confidence < 30 && (
            <Badge variant="outline" className="text-caution border-caution/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Low confidence
            </Badge>
          )}
        </div>

        {/* AI Analysis Status */}
        {openAiFailed ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  AI Content Analysis Failed
                </p>
                <p className="text-xs text-destructive/80 mt-1">
                  Score based on markup signals only (less accurate).
                  {openAiError && (
                    <span className="block mt-1 font-mono text-xs opacity-75">
                      Error: {openAiError}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            <span>AI content analysis completed</span>
          </div>
        )}

        {/* Subscores */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Content Score</div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${getScoreTextColor(data.subscores.content)}`}>
                {data.subscores.content}
              </div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getScoreBgColor(data.subscores.content)}`}
                  style={{ width: `${data.subscores.content}%` }}
                />
              </div>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Markup Score</div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${getScoreTextColor(data.subscores.markup)}`}>
                {data.subscores.markup}
              </div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getScoreBgColor(data.subscores.markup)}`}
                  style={{ width: `${data.subscores.markup}%` }}
                />
              </div>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Infrastructure Score</div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${getScoreTextColor(data.subscores.infrastructure ?? 0)}`}>
                {data.subscores.infrastructure ?? "-"}
              </div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getScoreBgColor(data.subscores.infrastructure ?? 0)}`}
                  style={{ width: `${data.subscores.infrastructure ?? 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Detected Signals */}
        {(data.signals.generator_meta || (data.signals.tech_hints?.length ?? 0) > 0) && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Detected Technology
            </p>
            <div className="flex flex-wrap gap-2">
              {data.signals.generator_meta && (
                <Badge variant="secondary" className="text-xs">
                  {data.signals.generator_meta}
                </Badge>
              )}
              {data.signals.tech_hints?.map((hint, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {hint}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* AI Markers */}
        {(data.signals.ai_markers?.length ?? 0) > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              AI Markers Found
            </p>
            <ul className="space-y-1">
              {data.signals.ai_markers?.map((marker, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-caution flex-shrink-0 mt-0.5" />
                  {marker}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Suspicious Content Patterns */}
        {data.signals.suspicious_content_patterns && data.signals.suspicious_content_patterns.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Suspicious Content Detected
            </p>
            <ul className="space-y-1">
              {data.signals.suspicious_content_patterns.map((pattern, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  {pattern}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Infrastructure Signals */}
        {data.signals.infrastructure && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Infrastructure Signals
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.has_robots_txt ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {data.signals.infrastructure.has_robots_txt ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                robots.txt
              </div>
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.has_sitemap ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {data.signals.infrastructure.has_sitemap ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                sitemap.xml
              </div>
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.has_favicon ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {data.signals.infrastructure.has_favicon ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Favicon
              </div>
              {data.signals.infrastructure.free_hosting && (
                <div className="flex items-center gap-2 text-sm p-2 rounded-md bg-caution/10 text-caution">
                  <AlertTriangle className="h-4 w-4" />
                  {data.signals.infrastructure.free_hosting}
                </div>
              )}
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.seo_score >= 50 ? "bg-success/10 text-success" : "bg-caution/10 text-caution"}`}>
                <Globe className="h-4 w-4" />
                SEO: {data.signals.infrastructure.seo_score}/100
              </div>
              {data.signals.infrastructure.is_boilerplate && (
                <div className="flex items-center gap-2 text-sm p-2 rounded-md bg-destructive/10 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Boilerplate
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reasons */}
        {data.reasons.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Analysis Reasons
            </p>
            <ul className="space-y-1">
              {data.reasons.map((reason, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes - only show if short and actionable */}
        {data.notes && data.notes.length < 200 && !data.notes.toLowerCase().includes('appears to be') && !data.notes.toLowerCase().includes('no contact') && (
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-sm text-muted-foreground flex items-start gap-2">
              <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {data.notes}
            </p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-xs text-muted-foreground border-t pt-4 flex items-start gap-2">
          <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>
            This is a heuristic estimate, not a definitive judgment. Use as one signal among many in your risk assessment. Many legitimate websites use templates, AI assistance, or no-code builders.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Risk Assessment Card
// =============================================================================

function RiskAssessmentCard({ data, domainId }: { data: RiskAssessment; domainId: string }) {
  const riskTypeLabels: Record<string, string> = {
    phishing: "Phishing",
    shell_company: "Shell Company",
    compliance: "Compliance",
  };

  const riskTypeIcons: Record<string, React.ReactNode> = {
    phishing: <AlertTriangle className="h-4 w-4" />,
    shell_company: <AlertCircle className="h-4 w-4" />,
    compliance: <Info className="h-4 w-4" />,
  };

  return (
    <Card>
      <CardHeader tint="risk" className="pb-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Risk Assessment
            </CardTitle>
            <CardDescription>
              Multi-factor risk analysis based on domain intelligence signals
            </CardDescription>
          </div>
          <RiskScanButton
            domainId={domainId}
            hasExistingRiskScore={true}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">

        {/* Main Score Display */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-5xl font-bold ${getScoreTextColor(data.overall_risk_score)}`}>
              {data.overall_risk_score}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {getRiskLabel(data.overall_risk_score)} Risk
            </div>
          </div>
          <div className="flex-1">
            <div className="h-4 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${getScoreBgColor(data.overall_risk_score)} transition-all duration-300`}
                style={{ width: `${data.overall_risk_score}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0 - Low Risk</span>
              <span>100 - High Risk</span>
            </div>
          </div>
        </div>

        {/* Primary Risk Type & Confidence */}
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant="secondary" className="text-sm">
            Primary: {riskTypeLabels[data.primary_risk_type]}
          </Badge>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Confidence:</span>
            <span className={`text-sm font-bold ${getConfidenceColor(data.confidence)}`}>
              {data.confidence}%
            </span>
          </div>
          {data.confidence < 50 && (
            <Badge variant="outline" className="text-caution border-caution/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Low confidence
            </Badge>
          )}
        </div>

        {/* Risk Type Scores */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Risk Type Breakdown</p>
          {Object.entries(data.risk_type_scores).map(([type, score]) => (
            <div key={type} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-28">
                {riskTypeIcons[type]}
                <span className="text-sm font-medium capitalize">{riskTypeLabels[type]}</span>
              </div>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getScoreBgColor(score)} transition-all duration-300`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <span className={`text-sm font-bold w-8 text-right ${getScoreTextColor(score)}`}>
                {score}
              </span>
            </div>
          ))}
        </div>

        {/* Top Reasons */}
        {data.reasons.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Top Risk Factors</p>
            <ul className="space-y-1">
              {data.reasons.map((reason, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-caution flex-shrink-0 mt-0.5" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Evidence */}
        {data.evidence.urls_checked.length > 0 && (
          <Accordion>
            <AccordionItem title={`Evidence (${data.evidence.urls_checked.length} URLs checked)`}>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">URLs Checked</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {data.evidence.urls_checked.map((url, idx) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-link hover:underline truncate"
                      >
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
                {data.evidence.signal_paths.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Signal Paths</p>
                    <div className="flex flex-wrap gap-1">
                      {data.evidence.signal_paths.map((path, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs font-mono">
                          {path}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </AccordionItem>
          </Accordion>
        )}

        {/* Notes - only show if short and actionable */}
        {data.notes && data.notes.length < 200 && !data.notes.toLowerCase().includes('appears to be') && !data.notes.toLowerCase().includes('no contact') && (
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-sm text-muted-foreground flex items-start gap-2">
              <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {data.notes}
            </p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-xs text-muted-foreground border-t pt-4 flex items-start gap-2">
          <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>
            This assessment is heuristic-based, using only internal domain signals (no external APIs). Use as one factor in your overall risk evaluation.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Domain Intel Signals Card
// =============================================================================

function DomainIntelSignalsCard({ data }: { data: DomainIntelSignals }) {
  return (
    <Card>
      <CardHeader tint="info" className="pb-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Domain Intelligence Signals
          </CardTitle>
          <CardDescription>
            Raw signals collected from {data.target_domain}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <Accordion>
          <AccordionItem title="Reachability & Response">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Status:</span>{" "}
                <span className={data.reachability.is_active ? "text-success" : "text-destructive"}>
                  {data.reachability.status_code || "N/A"} ({data.reachability.is_active ? "Active" : "Inactive"})
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Latency:</span>{" "}
                {data.reachability.latency_ms}ms
              </div>
              <div>
                <span className="text-muted-foreground">Title:</span>{" "}
                {data.reachability.html_title || "N/A"}
              </div>
              <div>
                <span className="text-muted-foreground">Word count:</span>{" "}
                {data.reachability.homepage_text_word_count || 0}
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="Redirects">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Chain length:</span>
                <span>{data.redirects.redirect_chain_length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Cross-domain:</span>
                {data.redirects.cross_domain_redirect ? (
                  <Badge variant="destructive" className="text-xs">Yes</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">No</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">JS redirect:</span>
                {data.redirects.js_redirect_hint ? (
                  <Badge variant="secondary" className="text-xs">Detected</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">None</Badge>
                )}
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="DNS">
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">A records:</span>{" "}
                {data.dns.a_records.length > 0 ? data.dns.a_records.join(", ") : "None"}
              </div>
              <div>
                <span className="text-muted-foreground">NS records:</span>{" "}
                {data.dns.ns_records.length > 0 ? data.dns.ns_records.join(", ") : "None"}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">MX present:</span>
                {data.dns.mx_present ? (
                  <CheckCircle className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="TLS / HTTPS">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">HTTPS OK:</span>
                {data.tls.https_ok ? (
                  <CheckCircle className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Issuer:</span>{" "}
                {data.tls.cert_issuer || "N/A"}
              </div>
              <div>
                <span className="text-muted-foreground">Days to expiry:</span>{" "}
                <span className={data.tls.expiring_soon ? "text-orange-500" : ""}>
                  {data.tls.days_to_expiry ?? "N/A"}
                </span>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem title="Security Headers">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["HSTS", data.headers.hsts_present],
                ["CSP", data.headers.csp_present],
                ["X-Frame-Options", data.headers.xfo_present],
                ["X-Content-Type-Options", data.headers.xcto_present],
                ["Referrer-Policy", data.headers.referrer_policy_present],
              ].map(([name, present]) => (
                <div key={String(name)} className="flex items-center gap-2">
                  {present ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span>{String(name)}</span>
                </div>
              ))}
            </div>
          </AccordionItem>

          <AccordionItem title="Forms & Inputs">
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Password inputs:</span>{" "}
                {data.forms.password_input_count}
              </div>
              <div>
                <span className="text-muted-foreground">Email inputs:</span>{" "}
                {data.forms.email_input_count}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Login form:</span>
                {data.forms.login_form_present ? (
                  <Badge variant="secondary" className="text-xs">Detected</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">None</Badge>
                )}
              </div>
              {data.forms.external_form_actions.length > 0 && (
                <div>
                  <span className="text-muted-foreground">External actions:</span>{" "}
                  <span className="text-orange-500">{data.forms.external_form_actions.join(", ")}</span>
                </div>
              )}
            </div>
          </AccordionItem>

          <AccordionItem title="Policy Pages">
            <div className="space-y-1 text-sm">
              {Object.entries(data.policy_pages.page_exists).map(([path, info]) => (
                <div key={path} className="flex items-center gap-2">
                  {info.exists ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-mono">{path}</span>
                  {info.status && <span className="text-muted-foreground">({info.status})</span>}
                </div>
              ))}
            </div>
          </AccordionItem>

          {data.rdap && (
            <AccordionItem title="Domain Registration (RDAP)">
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">RDAP Available:</span>
                  {data.rdap.rdap_available ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </div>
                {data.rdap.registration_date && (
                  <div>
                    <span className="text-muted-foreground">Registered:</span>{" "}
                    {new Date(data.rdap.registration_date).toLocaleDateString()}
                  </div>
                )}
                {data.rdap.expiration_date && (
                  <div>
                    <span className="text-muted-foreground">Expires:</span>{" "}
                    {new Date(data.rdap.expiration_date).toLocaleDateString()}
                  </div>
                )}
                {data.rdap.domain_age_years !== null && (
                  <div>
                    <span className="text-muted-foreground">Domain Age:</span>{" "}
                    <span className={data.rdap.domain_age_years < 1 ? "text-orange-500 font-medium" : ""}>
                      {data.rdap.domain_age_years.toFixed(1)} years ({data.rdap.domain_age_days} days)
                    </span>
                  </div>
                )}
                {data.rdap.registrar && (
                  <div>
                    <span className="text-muted-foreground">Registrar:</span>{" "}
                    {data.rdap.registrar}
                  </div>
                )}
                {data.rdap.status && data.rdap.status.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Status:</span>{" "}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {data.rdap.status.map((s: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {data.rdap.error && (
                  <div className="text-destructive">
                    <span className="text-muted-foreground">Error:</span>{" "}
                    {data.rdap.error}
                  </div>
                )}
              </div>
            </AccordionItem>
          )}

          <AccordionItem title="Raw JSON">
            <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
              {JSON.stringify(data, null, 2)}
            </pre>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Summary Card Component
// =============================================================================

function SummaryCard({
  domain,
  latestScan,
}: {
  domain: any;
  latestScan: any;
}) {
  // Extract scores from data points
  const riskDataPoint = domain.dataPoints.find((dp: any) => dp.key === "domain_risk_assessment");
  const aiDataPoint = domain.dataPoints.find((dp: any) => dp.key === "ai_generated_likelihood");
  const signalsDataPoint = domain.dataPoints.find((dp: any) => dp.key === "domain_intel_signals");

  const riskScore = riskDataPoint ? JSON.parse(riskDataPoint.value).overall_risk_score : null;
  const aiScore = aiDataPoint ? JSON.parse(aiDataPoint.value).ai_generated_score : null;

  // Extract domain age from signals
  let domainAgeYears: number | null = null;
  let domainAgeDays: number | null = null;
  let registrationDate: string | null = null;
  let rdapAvailable = false;

  if (signalsDataPoint) {
    const signals = JSON.parse(signalsDataPoint.value);
    if (signals.rdap) {
      domainAgeYears = signals.rdap.domain_age_years;
      domainAgeDays = signals.rdap.domain_age_days;
      registrationDate = signals.rdap.registration_date;
      rdapAvailable = signals.rdap.rdap_available;
    }
  }

  // Format domain age for display with smart precision
  const formatDomainAge = () => {
    if (domainAgeDays === null) return null;

    const totalDays = domainAgeDays;
    const years = Math.floor(totalDays / 365);
    const remainingDaysAfterYears = totalDays % 365;
    const months = Math.floor(remainingDaysAfterYears / 30);
    const days = remainingDaysAfterYears % 30;

    // Very new: < 90 days - show just days
    if (totalDays < 90) {
      return `${totalDays}d`;
    }

    // Under 1 year: show months + days
    if (years === 0) {
      return days > 0 ? `${months}m ${days}d` : `${months}m`;
    }

    // 1-5 years: show years + months
    if (years < 5) {
      return months > 0 ? `${years}y ${months}m` : `${years}y`;
    }

    // 5+ years: just show years
    return `${years}y`;
  };

  const getDomainAgeLabel = () => {
    if (domainAgeDays !== null && domainAgeDays < 90) return "Very New";
    if (domainAgeYears !== null && domainAgeYears < 1) return "New";
    if (domainAgeYears !== null && domainAgeYears < 2) return "Recent";
    if (domainAgeYears !== null && domainAgeYears >= 5) return "Established";
    return "Active";
  };

  // Format registration date elegantly
  const formatRegistrationDate = () => {
    if (!registrationDate) return null;
    const date = new Date(registrationDate);
    return format(date, "MMM d, yyyy");
  };

  const getDomainAgeBgColor = () => {
    if (domainAgeDays !== null && domainAgeDays < 90) return "bg-destructive/10 border-destructive/20";
    if (domainAgeYears !== null && domainAgeYears < 1) return "bg-orange-500/10 border-orange-500/20";
    if (domainAgeYears !== null && domainAgeYears >= 5) return "bg-success/10 border-success/20";
    return "bg-muted/30";
  };

  const getDomainAgeTextColor = () => {
    if (domainAgeDays !== null && domainAgeDays < 90) return "text-destructive";
    if (domainAgeYears !== null && domainAgeYears < 1) return "text-orange-500";
    if (domainAgeYears !== null && domainAgeYears >= 5) return "text-success";
    return "text-foreground";
  };

  return (
    <Card>
      <CardContent className="pt-6">
        {/* Key Scores Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className={`rounded-xl p-4 border ${riskScore !== null ? getScoreBgColorSubtle(riskScore) : "bg-muted/30"}`}>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1 uppercase tracking-wide">
              <AlertTriangle className="h-3 w-3" />
              Risk Score
            </p>
            {riskScore !== null ? (
              <div className="flex items-baseline gap-2">
                <p className={`text-3xl font-bold tabular-nums ${getScoreTextColor(riskScore)}`}>{riskScore}</p>
                <p className={`text-sm ${getScoreTextColor(riskScore)}`}>{getRiskLabel(riskScore)}</p>
              </div>
            ) : (
              <p className="text-2xl font-bold text-muted-foreground">—</p>
            )}
          </div>
          <div className={`rounded-xl p-4 border ${aiScore !== null ? getScoreBgColorSubtle(aiScore) : "bg-muted/30"}`}>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1 uppercase tracking-wide">
              <Bot className="h-3 w-3" />
              AI Score
            </p>
            {aiScore !== null ? (
              <div className="flex items-baseline gap-2">
                <p className={`text-3xl font-bold tabular-nums ${getScoreTextColor(aiScore)}`}>{aiScore}</p>
                <p className={`text-sm ${getScoreTextColor(aiScore)}`}>{getAiLikelihoodLabel(aiScore)}</p>
              </div>
            ) : (
              <p className="text-2xl font-bold text-muted-foreground">—</p>
            )}
          </div>
          <div className={`rounded-xl p-4 border ${rdapAvailable ? getDomainAgeBgColor() : "bg-muted/30"}`}>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1 uppercase tracking-wide">
              <Calendar className="h-3 w-3" />
              Domain Age
            </p>
            {rdapAvailable && domainAgeYears !== null ? (
              <div className="space-y-1">
                <p className={`text-3xl font-bold tabular-nums ${getDomainAgeTextColor()}`}>
                  {domainAgeYears.toFixed(1)} <span className="text-lg font-medium">years</span>
                </p>
                {registrationDate && (
                  <p className="text-xs text-muted-foreground">
                    <span className="opacity-70">Since</span>{" "}
                    <span className="font-medium text-foreground/80">{formatRegistrationDate()}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-2xl font-bold text-muted-foreground" title={!rdapAvailable ? "RDAP lookup not available for this TLD" : "No data"}>—</p>
            )}
          </div>
          <div className="rounded-xl p-4 border bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1 uppercase tracking-wide">
              <ShoppingCart className="h-3 w-3" />
              Detected SKUs
            </p>
            <HomepageSkuCountClient domainId={domain.id} initialScanStatus={latestScan?.status} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
