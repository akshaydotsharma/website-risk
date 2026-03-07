import { processScanWrapper } from "@/lib/scan-processor";

/**
 * Process a single scan for bulk operations.
 * Calls processScanWrapper directly — no HTTP self-calls.
 * Error handling is built into processScanWrapper (marks scan as failed on error).
 */
export async function processScanForBulk(
  scanId: string,
  domainId: string,
  url: string,
  normalizedDomain: string
): Promise<void> {
  const logPrefix = `[BulkScan ${scanId.slice(-8)}]`;
  console.log(`${logPrefix} Starting scan for ${normalizedDomain}`);

  await processScanWrapper(scanId, domainId, url, normalizedDomain);

  console.log(`${logPrefix} Completed ${normalizedDomain}`);
}
