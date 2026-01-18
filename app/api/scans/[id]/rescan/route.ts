import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkWebsiteActive } from "@/lib/utils";
import { extractDataPoint, extractDataPointFromContent } from "@/lib/extractors";
import { isDomainAuthorized, runDiscoveryPipeline } from "@/lib/discovery";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // The ID could be either a domain ID (hash) or a scan ID
    // First try to find as domain ID
    let domain = await prisma.domain.findUnique({
      where: { id },
      include: {
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    // If not found as domain, try to find the scan and get its domain
    if (!domain) {
      const existingScan = await prisma.websiteScan.findUnique({
        where: { id },
        include: { domain: true },
      });

      if (!existingScan) {
        return NextResponse.json({ error: "Domain or scan not found" }, { status: 404 });
      }

      domain = await prisma.domain.findUnique({
        where: { id: existingScan.domainId },
        include: {
          scans: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
    }

    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    // Use the most recent scan URL or construct from normalized domain
    const scanUrl = domain.scans[0]?.url || `https://${domain.normalizedUrl}`;

    // Check if website is still active
    const { isActive, statusCode } = await checkWebsiteActive(scanUrl);
    const checkedAt = new Date();

    // Create a new scan record for this rescan
    const newScan = await prisma.websiteScan.create({
      data: {
        domainId: domain.id,
        url: scanUrl,
        isActive,
        statusCode,
        checkedAt,
      },
    });

    // Update domain's last checked info
    await prisma.domain.update({
      where: { id: domain.id },
      data: {
        isActive,
        statusCode,
        lastCheckedAt: checkedAt,
      },
    });

    // Check if domain is authorized for discovery crawling
    const authResult = await isDomainAuthorized(domain.normalizedUrl);

    let extractedResult = null;

    if (authResult.authorized && authResult.config) {
      // Run full discovery pipeline for authorized domains
      try {
        const discoveryResult = await runDiscoveryPipeline(
          newScan.id,
          scanUrl,
          domain.normalizedUrl,
          authResult.config
        );

        // Update active status based on crawl results if initial check failed
        if (!isActive && discoveryResult.crawledPages.size > 0) {
          const homepageLogs = await prisma.crawlFetchLog.findFirst({
            where: {
              scanId: newScan.id,
              source: "homepage",
              statusCode: { gte: 200, lt: 400 },
            },
          });

          if (homepageLogs) {
            await prisma.$transaction([
              prisma.websiteScan.update({
                where: { id: newScan.id },
                data: {
                  isActive: true,
                  statusCode: homepageLogs.statusCode,
                },
              }),
              prisma.domain.update({
                where: { id: domain.id },
                data: {
                  isActive: true,
                  statusCode: homepageLogs.statusCode,
                },
              }),
            ]);
          }
        }

        // Extract data points from crawled content
        if (discoveryResult.crawledPages.size > 0) {
          const sources = Array.from(discoveryResult.crawledPages.keys());
          extractedResult = await extractDataPointFromContent(
            scanUrl,
            domain.normalizedUrl,
            "contact_details",
            discoveryResult.crawledPages,
            sources
          );
        }
      } catch (discoveryError) {
        console.error("Error during discovery pipeline:", discoveryError);
        // Fall back to basic extraction
        try {
          extractedResult = await extractDataPoint(
            scanUrl,
            domain.normalizedUrl,
            "contact_details"
          );
        } catch (fallbackError) {
          console.error("Fallback extraction also failed:", fallbackError);
        }
      }
    } else {
      // Domain not authorized - use basic extraction
      try {
        extractedResult = await extractDataPoint(
          scanUrl,
          domain.normalizedUrl,
          "contact_details"
        );
      } catch (extractionError) {
        console.error("Error during re-extraction:", extractionError);
      }
    }

    // Save extracted data points (both to scan and domain)
    if (extractedResult) {
      await prisma.$transaction([
        // Save to ScanDataPoint (historical record for this specific scan)
        prisma.scanDataPoint.create({
          data: {
            scanId: newScan.id,
            key: extractedResult.key,
            label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
        }),
        // Upsert to DomainDataPoint (latest data for the domain)
        prisma.domainDataPoint.upsert({
          where: {
            domainId_key: {
              domainId: domain.id,
              key: extractedResult.key,
            },
          },
          create: {
            domainId: domain.id,
            key: extractedResult.key,
            label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
          },
          update: {
            label: extractedResult.label,
            value: JSON.stringify(extractedResult.value),
            sources: JSON.stringify(extractedResult.sources),
            rawOpenAIResponse: JSON.stringify(extractedResult.rawOpenAIResponse),
            extractedAt: new Date(),
          },
        }),
      ]);
    }

    return NextResponse.json({ id: domain.id, scanId: newScan.id });
  } catch (error) {
    console.error("Error rescanning:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
