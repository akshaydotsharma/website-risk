export * from './schemas';
export { collectSignals } from './collectSignals';
export { scoreRisk, createFailedAssessment } from './scoreRisk';
export {
  PHISHING_WEIGHTS,
  SHELL_COMPANY_WEIGHTS,
  COMPLIANCE_WEIGHTS,
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

import { collectSignals } from './collectSignals';
import { scoreRisk, createFailedAssessment } from './scoreRisk';
import { DomainPolicy, RiskAssessment, CollectSignalsOutput } from './schemas';

// Default crawling configuration - all domains use these thresholds
const DEFAULT_CRAWL_CONFIG = {
  allowSubdomains: true,
  respectRobots: true,
  maxPagesPerScan: 50,
  crawlDelayMs: 1000,
};

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
    // Validate URL
    try {
      new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      return {
        assessment: await createFailedAssessment(scanId, 'Invalid URL'),
        signals: null,
        error: 'Invalid URL',
      };
    }

    // Build domain policy with default config
    const policy: DomainPolicy = {
      isAuthorized: true,
      allowSubdomains: DEFAULT_CRAWL_CONFIG.allowSubdomains,
      respectRobots: DEFAULT_CRAWL_CONFIG.respectRobots,
      allowRobotsDisallowed: false,
      maxPagesPerRun: DEFAULT_CRAWL_CONFIG.maxPagesPerScan,
      maxDepth: 2,
      crawlDelayMs: DEFAULT_CRAWL_CONFIG.crawlDelayMs,
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
