import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  normalizeUrl,
  extractDomainFromInput,
  generateDomainHash,
  checkWebsiteActive,
} from "@/lib/utils";
import { extractDataPoint, extractDataPointFromContent } from "@/lib/extractors";
import { isDomainAuthorized, runDiscoveryPipeline } from "@/lib/discovery";

const createScanSchema = z.object({
  url: z.string().url("Invalid URL format"),
  source: z.enum(["search", "settings", "api"]).optional().default("search"),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate input
    const validationResult = createScanSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { url: rawUrl, source } = validationResult.data;

    // Normalize URL and extract domain
    const url = normalizeUrl(rawUrl);
    const normalizedDomain = extractDomainFromInput(rawUrl);
    const domainId = generateDomainHash(normalizedDomain);

    // Check if website is active
    const { isActive, statusCode } = await checkWebsiteActive(url);
    const checkedAt = new Date();

    // Use a transaction to ensure all records are created atomically
    const result = await prisma.$transaction(async (tx) => {
      // Upsert Domain record (create if doesn't exist, update if it does)
      const domain = await tx.domain.upsert({
        where: { id: domainId },
        create: {
          id: domainId,
          normalizedUrl: normalizedDomain,
          isActive,
          statusCode,
          lastCheckedAt: checkedAt,
        },
        update: {
          isActive,
          statusCode,
          lastCheckedAt: checkedAt,
        },
      });

      // Log the user input
      await tx.urlInput.create({
        data: {
          rawInput: rawUrl,
          domainId: domainId,
          source,
        },
      });

      // Create WebsiteScan record
      const scan = await tx.websiteScan.create({
        data: {
          domainId: domainId,
          url,
          isActive,
          statusCode,
          checkedAt,
        },
      });

      return { domain, scan };
    });

    const { domain, scan } = result;

    // Check if domain is authorized for discovery crawling
    const authResult = await isDomainAuthorized(normalizedDomain);

    let extractedResult = null;

    if (authResult.authorized && authResult.config) {
      // Run full discovery pipeline for authorized domains
      try {
        const discoveryResult = await runDiscoveryPipeline(
          scan.id,
          url,
          normalizedDomain,
          authResult.config
        );

        // Update active status based on crawl results if initial check failed
        if (!isActive && discoveryResult.crawledPages.size > 0) {
          const homepageLogs = await prisma.crawlFetchLog.findFirst({
            where: {
              scanId: scan.id,
              source: "homepage",
              statusCode: { gte: 200, lt: 400 },
            },
          });

          if (homepageLogs) {
            await prisma.$transaction([
              prisma.websiteScan.update({
                where: { id: scan.id },
                data: {
                  isActive: true,
                  statusCode: homepageLogs.statusCode,
                },
              }),
              prisma.domain.update({
                where: { id: domainId },
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
            url,
            normalizedDomain,
            "contact_details",
            discoveryResult.crawledPages,
            sources
          );
        }
      } catch (discoveryError) {
        console.error("Error during discovery pipeline:", discoveryError);
        // Fall back to basic extraction if discovery fails
        try {
          extractedResult = await extractDataPoint(url, normalizedDomain, "contact_details");
        } catch (fallbackError) {
          console.error("Fallback extraction also failed:", fallbackError);
        }
      }
    } else {
      // Domain not authorized - use basic extraction (no discovery)
      try {
        extractedResult = await extractDataPoint(url, normalizedDomain, "contact_details");
      } catch (extractionError) {
        console.error("Error during data extraction:", extractionError);
      }
    }

    // Save extracted data points (both to scan and domain)
    if (extractedResult) {
      await prisma.$transaction([
        // Save to ScanDataPoint (historical record for this specific scan)
        prisma.scanDataPoint.create({
          data: {
            scanId: scan.id,
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
              domainId: domainId,
              key: extractedResult.key,
            },
          },
          create: {
            domainId: domainId,
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

    // Return the domain ID for redirect (domains are the primary entity now)
    return NextResponse.json({ id: domainId, scanId: scan.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating scan:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("Error details:", { message: errorMessage, stack: errorStack });
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Return domains with their latest data points and scan history
    const domains = await prisma.domain.findMany({
      include: {
        dataPoints: true,
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1, // Only get the most recent scan
        },
        urlInputs: {
          orderBy: { createdAt: "desc" },
          take: 5, // Get recent input history
        },
      },
      orderBy: {
        lastCheckedAt: "desc",
      },
    });

    return NextResponse.json({ domains });
  } catch (error) {
    console.error("Error fetching domains:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
