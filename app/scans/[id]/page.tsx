import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, formatDistanceToNow } from "date-fns";
import { ExternalLink, Mail, Phone, MapPin, Link2, Globe, Activity, CheckCircle, XCircle, Clock, AlertCircle, ChevronLeft, History, Bot, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { RescanButton } from "./rescan-button";
import { AiScanButton } from "./ai-scan-button";
import type { ContactDetails, AiGeneratedLikelihood } from "@/lib/extractors";

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
        include: {
          dataPoints: true,
          crawlFetchLogs: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
      urlInputs: {
        orderBy: { createdAt: "desc" },
        take: 10,
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
            include: {
              dataPoints: true,
              crawlFetchLogs: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
          urlInputs: {
            orderBy: { createdAt: "desc" },
            take: 10,
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
      {/* Header */}
      <div className="space-y-4">
        <Link
          href="/scans"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to History
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Domain Intelligence</h1>
            <a
              href={`https://${domain.normalizedUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg text-blue-600 hover:underline flex items-center gap-2"
            >
              {domain.normalizedUrl}
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <AiScanButton
              domainId={domain.id}
              hasExistingAiScore={domain.dataPoints.some(dp => dp.key === "ai_generated_likelihood")}
            />
            <RescanButton scanId={domain.id} />
          </div>
        </div>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Domain</p>
              <p className="font-medium">{domain.normalizedUrl}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <Badge variant={domain.isActive ? "success" : "destructive"}>
                {domain.isActive ? `Active (${domain.statusCode})` : "Inactive"}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Last Scanned</p>
              <p className="font-medium text-sm">
                {domain.lastCheckedAt
                  ? format(new Date(domain.lastCheckedAt), "PPp")
                  : "Never"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Total Scans</p>
              <p className="font-medium text-sm">{domain.scans.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    {formatDistanceToNow(new Date(input.createdAt), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Points Section (Domain-level - latest merged data) */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Data Points Extracted</h2>
        {domain.dataPoints.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No data points extracted yet
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {domain.dataPoints.map((dataPoint: any) => {
              const value = JSON.parse(dataPoint.value);
              const sources = JSON.parse(dataPoint.sources);

              // Render based on data point type
              if (dataPoint.key === "contact_details") {
                return (
                  <ContactDetailsCard
                    key={dataPoint.id}
                    data={value as ContactDetails}
                    sources={sources}
                  />
                );
              }

              if (dataPoint.key === "ai_generated_likelihood") {
                const rawResponse = JSON.parse(dataPoint.rawOpenAIResponse || "{}");
                return (
                  <AiGeneratedLikelihoodCard
                    key={dataPoint.id}
                    data={value as AiGeneratedLikelihood}
                    rawOpenAIResponse={rawResponse}
                  />
                );
              }

              // Generic fallback for unknown data point types
              return (
                <Card key={dataPoint.id}>
                  <CardHeader>
                    <CardTitle>{dataPoint.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted p-4 rounded overflow-auto">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Sources */}
      {domain.dataPoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              Web pages used to extract intelligence
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {domain.dataPoints.map((dataPoint: any) => {
                const sources = JSON.parse(dataPoint.sources) as string[];
                return sources.map((source, idx) => (
                  <a
                    key={`${dataPoint.id}-${idx}`}
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                    {source}
                  </a>
                ));
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Raw Output */}
      {domain.dataPoints.length > 0 && (
        <Accordion>
          {domain.dataPoints.map((dataPoint: any) => {
            const rawResponse = JSON.parse(dataPoint.rawOpenAIResponse);
            return (
              <AccordionItem
                key={dataPoint.id}
                title={`Raw OpenAI Response - ${dataPoint.label}`}
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Crawl Activity Log
            </CardTitle>
            <CardDescription>
              HTTP requests from the most recent scan ({format(new Date(latestScan.checkedAt), "PPp")})
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                            className="text-xs text-blue-600 hover:underline truncate max-w-md"
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
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
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
          </CardContent>
        </Card>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Contact Details
        </CardTitle>
        <CardDescription>
          Contact information extracted from the website
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.primary_contact_page_url && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Primary Contact Page
            </p>
            <a
              href={data.primary_contact_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-2"
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
                  <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
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
                  <a href={`tel:${phone}`} className="text-blue-600 hover:underline">
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
                    className="text-blue-600 hover:underline flex items-center gap-2"
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
                    className="text-blue-600 hover:underline flex items-center gap-2"
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
                    className="text-blue-600 hover:underline flex items-center gap-2"
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
                    className="text-blue-600 hover:underline flex items-center gap-2"
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
                    className="text-blue-600 hover:underline flex items-center gap-2"
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
                    className="text-blue-600 hover:underline flex items-center gap-2"
                  >
                    Other: {url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.notes && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Notes</p>
            <p className="text-sm">{data.notes}</p>
          </div>
        )}

        {!hasEmails &&
          !hasPhones &&
          !hasAddresses &&
          !hasContactForms &&
          !hasSocial &&
          !data.notes && (
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
}: {
  data: AiGeneratedLikelihood;
  rawOpenAIResponse?: OpenAIResponseStatus;
}) {
  const score = data.ai_generated_score;
  const confidence = data.confidence;

  // Determine if OpenAI analysis failed
  const openAiFailed = rawOpenAIResponse?.fallback === true || !!rawOpenAIResponse?.error;
  const openAiError = rawOpenAIResponse?.error;

  // Determine color based on score
  const getScoreColor = (score: number) => {
    if (score <= 30) return "text-green-600";
    if (score <= 50) return "text-yellow-600";
    if (score <= 70) return "text-orange-500";
    return "text-red-600";
  };

  const getProgressColor = (score: number) => {
    if (score <= 30) return "bg-green-500";
    if (score <= 50) return "bg-yellow-500";
    if (score <= 70) return "bg-orange-500";
    return "bg-red-500";
  };

  const getScoreLabel = (score: number) => {
    if (score <= 20) return "Very Unlikely";
    if (score <= 40) return "Unlikely";
    if (score <= 60) return "Uncertain";
    if (score <= 80) return "Likely";
    return "Very Likely";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI-generated likelihood
        </CardTitle>
        <CardDescription>
          Heuristic estimate based on content, markup, and infrastructure signals
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main Score Display */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-5xl font-bold ${getScoreColor(score)}`}>
              {score}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {getScoreLabel(score)}
            </div>
          </div>
          <div className="flex-1">
            <div className="h-4 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${getProgressColor(score)} transition-all duration-300`}
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
            <span className={`text-sm font-bold ${confidence < 30 ? "text-orange-500" : confidence < 60 ? "text-yellow-600" : "text-green-600"}`}>
              {confidence}%
            </span>
          </div>
          {confidence < 30 && (
            <Badge variant="outline" className="text-orange-500 border-orange-300">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Low confidence
            </Badge>
          )}
        </div>

        {/* OpenAI Analysis Status */}
        {openAiFailed ? (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  OpenAI Content Analysis Failed
                </p>
                <p className="text-xs text-red-600 dark:text-red-500 mt-1">
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
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
            <CheckCircle className="h-4 w-4" />
            <span>OpenAI content analysis completed</span>
          </div>
        )}

        {/* Subscores */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Content Score</div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${getScoreColor(data.subscores.content)}`}>
                {data.subscores.content}
              </div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(data.subscores.content)}`}
                  style={{ width: `${data.subscores.content}%` }}
                />
              </div>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Markup Score</div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${getScoreColor(data.subscores.markup)}`}>
                {data.subscores.markup}
              </div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(data.subscores.markup)}`}
                  style={{ width: `${data.subscores.markup}%` }}
                />
              </div>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Infrastructure Score</div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${getScoreColor(data.subscores.infrastructure ?? 0)}`}>
                {data.subscores.infrastructure ?? "-"}
              </div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(data.subscores.infrastructure ?? 0)}`}
                  style={{ width: `${data.subscores.infrastructure ?? 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Detected Signals */}
        {(data.signals.generator_meta || data.signals.tech_hints.length > 0) && (
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
              {data.signals.tech_hints.map((hint, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {hint}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* AI Markers */}
        {data.signals.ai_markers.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              AI Markers Found
            </p>
            <ul className="space-y-1">
              {data.signals.ai_markers.map((marker, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
                  {marker}
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
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.has_robots_txt ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"}`}>
                {data.signals.infrastructure.has_robots_txt ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                robots.txt
              </div>
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.has_sitemap ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"}`}>
                {data.signals.infrastructure.has_sitemap ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                sitemap.xml
              </div>
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.has_favicon ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"}`}>
                {data.signals.infrastructure.has_favicon ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Favicon
              </div>
              {data.signals.infrastructure.free_hosting && (
                <div className="flex items-center gap-2 text-sm p-2 rounded-md bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
                  <AlertTriangle className="h-4 w-4" />
                  {data.signals.infrastructure.free_hosting}
                </div>
              )}
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${data.signals.infrastructure.seo_score >= 50 ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" : "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400"}`}>
                <Globe className="h-4 w-4" />
                SEO: {data.signals.infrastructure.seo_score}/100
              </div>
              {data.signals.infrastructure.is_boilerplate && (
                <div className="flex items-center gap-2 text-sm p-2 rounded-md bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400">
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

        {/* Notes */}
        {data.notes && (
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
