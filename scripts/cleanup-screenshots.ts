import { prisma } from '../lib/prisma';

/**
 * Delete screenshots to free up database space.
 * Usage:
 *   npx tsx scripts/cleanup-screenshots.ts          # show stats only (dry run)
 *   npx tsx scripts/cleanup-screenshots.ts --delete  # actually delete
 */
async function main() {
  const dryRun = !process.argv.includes('--delete');

  // Get screenshot stats
  const totalCount = await prisma.screenshot.count();
  const sizeResult = await prisma.$queryRaw<[{ total_bytes: bigint }]>`
    SELECT COALESCE(SUM(LENGTH(data)), 0) as total_bytes FROM "Screenshot"
  `;
  const totalMB = Number(sizeResult[0].total_bytes) / (1024 * 1024);

  console.log(`Screenshots: ${totalCount} total, ~${totalMB.toFixed(1)} MB`);

  if (totalCount === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  // Show breakdown by age
  const now = new Date();
  const oneDay = 24 * 60 * 60 * 1000;
  const ranges = [
    { label: '< 1 day', cutoff: new Date(now.getTime() - oneDay) },
    { label: '1-7 days', cutoff: new Date(now.getTime() - 7 * oneDay) },
    { label: '7-30 days', cutoff: new Date(now.getTime() - 30 * oneDay) },
    { label: '> 30 days', cutoff: new Date(0) },
  ];

  let prevCutoff = now;
  for (const range of ranges) {
    const count = await prisma.screenshot.count({
      where: { createdAt: { gte: range.cutoff, lt: prevCutoff } },
    });
    if (count > 0) console.log(`  ${range.label}: ${count}`);
    prevCutoff = range.cutoff;
  }

  if (dryRun) {
    console.log('\nDry run — pass --delete to actually remove screenshots.');
    return;
  }

  // Keep only the most recent screenshot per domain, delete all others
  console.log('\nDeleting all but the latest screenshot per domain...');

  // Get latest screenshot ID per domain
  const latestPerDomain = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT ON ("domainId") id
    FROM "Screenshot"
    ORDER BY "domainId", "createdAt" DESC
  `;
  const keepIds = new Set(latestPerDomain.map((r) => r.id));

  const deleted = await prisma.screenshot.deleteMany({
    where: { id: { notIn: [...keepIds] } },
  });

  console.log(`Deleted ${deleted.count} screenshots (kept ${keepIds.size} latest).`);

  // Show new size
  const newSize = await prisma.$queryRaw<[{ total_bytes: bigint }]>`
    SELECT COALESCE(SUM(LENGTH(data)), 0) as total_bytes FROM "Screenshot"
  `;
  const newMB = Number(newSize[0].total_bytes) / (1024 * 1024);
  console.log(`New size: ~${newMB.toFixed(1)} MB (freed ~${(totalMB - newMB).toFixed(1)} MB)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
