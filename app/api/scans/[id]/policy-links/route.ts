import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isDomainAuthorized } from '@/lib/discovery';
import { runPolicyLinksExtraction, DomainPolicy } from '@/lib/domainIntel';

/**
 * POST /api/scans/[id]/policy-links
 *
 * Extracts and verifies policy links (privacy, refund, terms) for a scan.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Find the scan (could be scanId or domainId)
    let scan = await prisma.websiteScan.findUnique({
      where: { id },
      include: {
        domain: true,
        policyLinks: true,
      },
    });

    // If not found as scan, try to find as domain and get latest scan
    if (!scan) {
      const domain = await prisma.domain.findUnique({
        where: { id },
        include: {
          scans: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              policyLinks: true,
            },
          },
        },
      });

      if (domain && domain.scans.length > 0) {
        scan = {
          ...domain.scans[0],
          domain,
          policyLinks: domain.scans[0].policyLinks,
        } as any;
      }
    }

    if (!scan) {
      return NextResponse.json(
        { error: 'Scan not found' },
        { status: 404 }
      );
    }

    // Get default crawl configuration
    const authResult = await isDomainAuthorized(scan.url);

    // Build domain policy
    const policy: DomainPolicy = {
      isAuthorized: true,
      allowSubdomains: authResult.config.allowSubdomains,
      respectRobots: authResult.config.respectRobots,
      allowRobotsDisallowed: false,
      maxPagesPerRun: authResult.config.maxPagesPerScan,
      maxDepth: 2,
      crawlDelayMs: authResult.config.crawlDelayMs,
      requestTimeoutMs: 8000,
    };

    // Run extraction
    const result = await runPolicyLinksExtraction(scan.id, scan.url, policy);

    return NextResponse.json({
      scanId: scan.id,
      domainId: scan.domainId,
      policyLinks: result.policyLinks,
      summary: result.summary,
      errors: result.errors,
    });
  } catch (error) {
    console.error('Error extracting policy links:', error);
    return NextResponse.json(
      {
        error: 'Failed to extract policy links',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/scans/[id]/policy-links
 *
 * Retrieves existing policy links for a scan.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Find the scan (could be scanId or domainId)
    // IMPORTANT: Use the most recent COMPLETED scan to avoid showing empty data
    // when a new scan is stuck in pending/processing state
    let policyLinks = await prisma.policyLink.findMany({
      where: { scanId: id },
    });

    // If not found, try to find by domain (using completed scans)
    if (policyLinks.length === 0) {
      const domain = await prisma.domain.findUnique({
        where: { id },
        include: {
          scans: {
            where: { status: 'completed' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true },
          },
        },
      });

      if (domain && domain.scans.length > 0) {
        policyLinks = await prisma.policyLink.findMany({
          where: { scanId: domain.scans[0].id },
        });
      }
    }

    // Also get the summary from data points
    let summary = null;
    const dataPoint = await prisma.scanDataPoint.findFirst({
      where: {
        scanId: id,
        key: 'policy_links',
      },
    });

    if (!dataPoint) {
      // Try domain data point
      const domainDataPoint = await prisma.domainDataPoint.findFirst({
        where: {
          domainId: id,
          key: 'policy_links',
        },
      });
      if (domainDataPoint) {
        summary = JSON.parse(domainDataPoint.value);
      }
    } else {
      summary = JSON.parse(dataPoint.value);
    }

    return NextResponse.json({
      policyLinks,
      summary,
    });
  } catch (error) {
    console.error('Error fetching policy links:', error);
    return NextResponse.json(
      { error: 'Failed to fetch policy links' },
      { status: 500 }
    );
  }
}
