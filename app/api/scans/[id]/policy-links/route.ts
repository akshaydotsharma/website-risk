import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isDomainAuthorized } from '@/lib/discovery';
import { runPolicyLinksExtraction } from '@/lib/domainIntel';
import { resolveDomainAndScan, buildDomainPolicy } from '@/lib/domainUtils';
import { safeJsonParse } from '@/lib/utils';
import { DataPointKey } from '@/lib/constants';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await resolveDomainAndScan(id);
    if (!result || !result.latestScan) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    const { domain, latestScan, scanUrl } = result;
    const authResult = await isDomainAuthorized(scanUrl);
    const policy = buildDomainPolicy(authResult.config);

    const extraction = await runPolicyLinksExtraction(latestScan.id, scanUrl, policy);

    return NextResponse.json({
      scanId: latestScan.id,
      domainId: domain.id,
      policyLinks: extraction.policyLinks,
      summary: extraction.summary,
      errors: extraction.errors,
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
        key: DataPointKey.POLICY_LINKS,
      },
    });

    if (!dataPoint) {
      // Try domain data point
      const domainDataPoint = await prisma.domainDataPoint.findFirst({
        where: {
          domainId: id,
          key: DataPointKey.POLICY_LINKS,
        },
      });
      if (domainDataPoint) {
        summary = safeJsonParse(domainDataPoint.value, null);
      }
    } else {
      summary = safeJsonParse(dataPoint.value, null);
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
