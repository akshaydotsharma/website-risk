import { prisma } from '../lib/prisma';

const domainToDelete = process.argv[2];

if (!domainToDelete) {
  console.error('Usage: npx tsx scripts/delete-domain.ts <normalizedUrl>');
  process.exit(1);
}

async function main() {
  // Find the domain
  const domain = await prisma.domain.findFirst({
    where: { normalizedUrl: domainToDelete }
  });

  if (!domain) {
    console.log(`Domain "${domainToDelete}" not found`);
    return;
  }

  console.log('Found domain:', domain.id, domain.normalizedUrl);

  // Delete the domain (cascades will handle related records)
  await prisma.domain.delete({
    where: { id: domain.id }
  });

  console.log('Deleted domain and all related records');
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
