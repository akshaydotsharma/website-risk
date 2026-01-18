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
import { ExternalLink, Mail, Phone, MapPin, Link2, Globe, Activity, CheckCircle, XCircle, Clock, AlertCircle, ChevronLeft, History } from "lucide-react";
import Link from "next/link";
import { RescanButton } from "./rescan-button";
import type { ContactDetails } from "@/lib/extractors";

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
          <RescanButton scanId={domain.id} />
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
