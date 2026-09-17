import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYMBOLS = [
  { symbol: 'FFC', companyName: 'Fauji Fertilizer Company Limited', sector: 'Fertilizer' },
  { symbol: 'OGDC', companyName: 'Oil & Gas Development Company Limited', sector: 'Oil & Gas' },
  { symbol: 'HBL', companyName: 'Habib Bank Limited', sector: 'Commercial Banks' },
  // ENGRO used to be seeded here. Engro Corporation's listing no longer trades (the exchange
  // renders the page DELISTED and both price sources carry no live quote — Sarmaaya's payload
  // is stamped 2025-02-25), so seeding it only re-adds a symbol that can never sync. Removing a
  // delisted symbol only in the database is not enough: `prisma db seed` recreates this list.
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
