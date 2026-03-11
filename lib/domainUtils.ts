/**
 * Shared domain/scan lookup utilities used across API routes.
 * Eliminates the repeated 40-line "resolve domain or scan ID" pattern.
 */

import { prisma } from "@/lib/prisma";
import type { DomainPolicy } from "@/lib/domainIntel/schemas";

/**
 * Resolve an ID that could be either a domain ID or a scan ID.
 * Returns the domain (with latest scan) or null if not found.
 */
export async function resolveDomainAndScan(
  id: string,
  options?: {
    includeDataPoints?: boolean;
    dataPointKeys?: string[];
  }
) {
  const include: any = {
    scans: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
    },
  };

  if (options?.includeDataPoints) {
    include.dataPoints = options.dataPointKeys
      ? { where: { key: { in: options.dataPointKeys } } }
      : true;
  }

  // Try as domain ID first
  let domain = await prisma.domain.findUnique({
    where: { id },
    include,
  });

  // Fallback: try as scan ID
  if (!domain) {
    const existingScan = await prisma.websiteScan.findUnique({
      where: { id },
      include: { domain: true },
    });

    if (existingScan) {
      domain = await prisma.domain.findUnique({
        where: { id: existingScan.domainId },
        include,
      });
    }
  }

  if (!domain) return null;

  const latestScan = (domain as any).scans?.[0] ?? null;
  const scanUrl = latestScan?.url || `https://${domain.normalizedUrl}`;

  return { domain, latestScan, scanUrl };
}

/**
 * Build a standard DomainPolicy from authorization config.
 * Eliminates the repeated 10-line policy construction pattern.
 */
export function buildDomainPolicy(authConfig: {
  allowSubdomains: boolean;
  respectRobots: boolean;
  maxPagesPerScan: number;
  crawlDelayMs: number;
}): DomainPolicy {
  return {
    isAuthorized: true,
    allowSubdomains: authConfig.allowSubdomains,
    respectRobots: authConfig.respectRobots,
    allowRobotsDisallowed: false,
    maxPagesPerRun: authConfig.maxPagesPerScan,
    maxDepth: 2,
    crawlDelayMs: authConfig.crawlDelayMs,
    requestTimeoutMs: 8000,
  };
}
