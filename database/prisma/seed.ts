import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYMBOLS = [
  { symbol: 'FFC', companyName: 'Fauji Fertilizer Company Limited', sector: 'Fertilizer' },
  { symbol: 'OGDC', companyName: 'Oil & Gas Development Company Limited', sector: 'Oil & Gas' },
  { symbol: 'HBL', companyName: 'Habib Bank Limited', sector: 'Commercial Banks' },
  { symbol: 'ENGRO', companyName: 'Engro Corporation Limited', sector: 'Conglomerate' },
];

async function main() {
  for (const s of SYMBOLS) {
    await prisma.stock.upsert({
      where: { symbol: s.symbol },
      update: {},
      create: s,
    });
  }
  console.log(`Seeded ${SYMBOLS.length} stocks`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
