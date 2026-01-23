export * from './schemas';
export { collectSignals } from './collectSignals';
export { scoreRisk, createFailedAssessment } from './scoreRisk';
export {
  PHISHING_WEIGHTS,
  FRAUD_WEIGHTS,
  COMPLIANCE_WEIGHTS,
  CREDIT_WEIGHTS,
  CONFIDENCE_BASE,
  CONFIDENCE_ADJUSTMENTS,
} from './riskWeightsV1';
export {
  extractHomepageSkus,
  runHomepageSkuExtraction,
  parsePrice,
  normalizeProductUrl,
  isProductLikeUrl,
  type HomepageSkuItem,
  type ExtractHomepageSkusResult,
} from './extractHomepageSkus';
export {
  extractPolicyLinks,
  runPolicyLinksExtraction,
  persistPolicyLinks,
  type PolicyType,
  type PolicyLinkVerified,
  type PolicyLinksSummary,
  type ExtractPolicyLinksResult,
} from './extractPolicyLinks';

import { prisma } from '../prisma';
import { collectSignals } from './collectSignals';
import { scoreRisk, createFailedAssessment } from './scoreRisk';
import { DomainPolicy, RiskAssessment, CollectSignalsOutput } from './schemas';

/**
 * Main entry point for running the complete risk intelligence pipeline.
 *
 * @param scanId - The ID of the WebsiteScan to analyze
 * @param url - The URL to analyze
 * @returns The risk assessment result
 */
export async function runRiskIntelPipeline(
  scanId: string,
  url: string
): Promise<{
  assessment: RiskAssessment;
  signals: CollectSignalsOutput | null;
  error: string | null;
}> {
  try {
    // Extract domain from URL
    let domain: string;
    try {
      domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
    } catch {
      return {
        assessment: await createFailedAssessment(scanId, 'Invalid URL'),
        signals: null,
        error: 'Invalid URL',
      };
    }

    // Check for custom configuration (optional - uses defaults if not found)
    const authorizedDomain = await prisma.authorizedDomain.findFirst({
      where: {
        OR: [
          { domain: domain },
          // Check if the domain is a subdomain of an authorized domain with allowSubdomains
          ...domain.split('.').slice(1).map((_, i, arr) => ({
            domain: arr.slice(i).join('.'),
            allowSubdomains: true,
          })),
        ],
      },
    });

    // Build domain policy - use custom config if available, otherwise use safe defaults
    const policy: DomainPolicy = {
      isAuthorized: true, // Always authorized for risk scanning
      allowSubdomains: authorizedDomain?.allowSubdomains ?? true,
      respectRobots: authorizedDomain?.respectRobots ?? true,
      allowRobotsDisallowed: false,
      maxPagesPerRun: authorizedDomain?.maxPagesPerScan ?? 50,
      maxDepth: 2,
      crawlDelayMs: authorizedDomain?.crawlDelayMs ?? 1000,
      requestTimeoutMs: 8000,
    };

    // Collect signals
    const signalsOutput = await collectSignals(scanId, url, policy);

    // Score risk
    const assessment = await scoreRisk(
      scanId,
      signalsOutput.signals,
      signalsOutput.urls_checked
    );

    return {
      assessment,
      signals: signalsOutput,
      error: signalsOutput.errors.length > 0 ? signalsOutput.errors.join('; ') : null,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      assessment: await createFailedAssessment(scanId, errorMessage),
      signals: null,
      error: errorMessage,
    };
  }
}
