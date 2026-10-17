/**
 * The weekly company-profile sync, tested against a throwaway content directory.
 *
 * The point of these cases is the two deliberate refusals in the loader, because they are what
 * keeps the section honest: an image without its provenance never ships, and a write-up for a
 * symbol we do not track is reported rather than created. Everything else is the idempotent
 * upsert path that the manual script has always used.
 */
jest.mock('../src/database/prisma', () => ({
  prisma: {
    stock: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/database/prisma';
import { syncCompanyProfiles } from '../src/services/companyProfileSync.service';

const mockPrisma = prisma as unknown as {
  stock: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

type Tx = {
  companyProfile: { upsert: jest.Mock };
  companyProduct: { deleteMany: jest.Mock; createMany: jest.Mock };
};

const tx: Tx = {
  companyProfile: { upsert: jest.fn() },
  companyProduct: { deleteMany: jest.fn(), createMany: jest.fn() },
};

let dir: string;

beforeEach(async () => {
  jest.clearAllMocks();
  dir = await mkdtemp(path.join(os.tmpdir(), 'company-profiles-'));
  mockPrisma.$transaction.mockImplementation(async (cb: (client: Tx) => unknown) => cb(tx));
  tx.companyProfile.upsert.mockResolvedValue({ id: 'profile-1' });
  tx.companyProduct.deleteMany.mockResolvedValue({ count: 0 });
  tx.companyProduct.createMany.mockResolvedValue({ count: 0 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const writeProfile = (file: string, body: unknown) =>
  writeFile(path.join(dir, file), JSON.stringify(body), 'utf8');

describe('syncCompanyProfiles', () => {
  it('upserts the profile and replaces its products in file order', async () => {
    mockPrisma.stock.findUnique.mockResolvedValue({ id: 'stock-1' });
    await writeProfile('HUBC.json', {
      symbol: 'hubc',
      description: 'A power producer.',
      ceo: 'Kamran Kamal',
      products: [
        { name: 'Hub Plant', summary: '1,292 MW thermal.' },
        { name: 'Thar Plant', summary: '660 MW lignite.' },
      ],
    });

    const result = await syncCompanyProfiles({ contentDir: dir });

    expect(result).toMatchObject({ files: 1, skipped: [], failed: [] });
    expect(result.written).toEqual([{ symbol: 'HUBC', products: 2 }]);
    expect(tx.companyProfile.upsert).toHaveBeenCalledWith({
      where: { stockId: 'stock-1' },
      update: expect.objectContaining({ description: 'A power producer.', ceo: 'Kamran Kamal' }),
      create: expect.objectContaining({ stockId: 'stock-1', description: 'A power producer.' }),
    });
    expect(tx.companyProduct.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: 'Hub Plant', position: 0 }),
        expect.objectContaining({ name: 'Thar Plant', position: 1 }),
      ],
    });
  });

  it('skips a write-up for a symbol we do not track rather than creating one', async () => {
    mockPrisma.stock.findUnique.mockResolvedValue(null);
    await writeProfile('NOPE.json', { symbol: 'NOPE', description: 'Not listed.' });

    const result = await syncCompanyProfiles({ contentDir: dir });

    expect(result.skipped).toEqual(['NOPE']);
    expect(result.written).toEqual([]);
    expect(tx.companyProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejects an image that carries only part of its provenance', async () => {
    mockPrisma.stock.findUnique.mockResolvedValue({ id: 'stock-1' });
    await writeProfile('LUCK.json', {
      symbol: 'LUCK',
      description: 'A cement manufacturer.',
      products: [{ name: 'Cement', imagePath: '/products/luck.jpg' }],
    });

    const result = await syncCompanyProfiles({ contentDir: dir });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.file).toBe('LUCK.json');
    expect(result.failed[0]?.reason).toMatch(/imagePath, imageSource and imageLicence together/);
    expect(result.written).toEqual([]);
    expect(tx.companyProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown field instead of quietly dropping it', async () => {
    await writeProfile('OGDC.json', { symbol: 'OGDC', descriptoin: 'typo' });

    const result = await syncCompanyProfiles({ contentDir: dir });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.file).toBe('OGDC.json');
  });

  it('keeps loading the good files when one file is malformed', async () => {
    mockPrisma.stock.findUnique.mockResolvedValue({ id: 'stock-1' });
    await writeProfile('BAD.json', '{ not json');
    await writeProfile('HBL.json', { symbol: 'HBL', description: 'A bank.' });

    const result = await syncCompanyProfiles({ contentDir: dir });

    expect(result.files).toBe(2);
    expect(result.written).toEqual([{ symbol: 'HBL', products: 0 }]);
    expect(result.failed.map((f) => f.file)).toEqual(['BAD.json']);
  });
});
