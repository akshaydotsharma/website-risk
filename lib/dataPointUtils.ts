/**
 * Shared data point save utilities.
 * Eliminates the repeated scanDataPoint.create + domainDataPoint.upsert pattern.
 */

import { prisma } from "@/lib/prisma";

/**
 * Save a data point to both ScanDataPoint and DomainDataPoint tables.
 * Uses a transaction for atomicity.
 */
export async function saveDataPoint(
  scanId: string,
  domainId: string,
  key: string,
  label: string,
  value: any,
  sources: string[],
  rawOpenAIResponse: any = {}
): Promise<void> {
  const valueJson = JSON.stringify(value);
  const sourcesJson = JSON.stringify(sources);
  const rawJson = JSON.stringify(rawOpenAIResponse);

  await prisma.$transaction([
    prisma.scanDataPoint.create({
      data: { scanId, key, label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: rawJson },
    }),
    prisma.domainDataPoint.upsert({
      where: { domainId_key: { domainId, key } },
      create: { domainId, key, label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: rawJson },
      update: { value: valueJson, sources: sourcesJson, rawOpenAIResponse: rawJson, extractedAt: new Date() },
    }),
  ]);
}

/**
 * Save multiple data points in a single transaction.
 */
export async function saveDataPointsBatch(
  scanId: string,
  domainId: string,
  points: Array<{
    key: string;
    label: string;
    value: any;
    sources: string[];
    rawOpenAIResponse?: any;
  }>
): Promise<void> {
  if (points.length === 0) return;

  await prisma.$transaction(
    points.flatMap((op) => {
      const valueJson = JSON.stringify(op.value);
      const sourcesJson = JSON.stringify(op.sources);
      const rawJson = JSON.stringify(op.rawOpenAIResponse ?? {});
      return [
        prisma.scanDataPoint.create({
          data: { scanId, key: op.key, label: op.label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: rawJson },
        }),
        prisma.domainDataPoint.upsert({
          where: { domainId_key: { domainId, key: op.key } },
          create: { domainId, key: op.key, label: op.label, value: valueJson, sources: sourcesJson, rawOpenAIResponse: rawJson },
          update: { value: valueJson, sources: sourcesJson, rawOpenAIResponse: rawJson, extractedAt: new Date() },
        }),
      ];
    })
  );
}
