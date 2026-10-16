/**
 * The company-profile read model.
 *
 * Two behaviours here are load-bearing and easy to break silently, so they carry the weight of this
 * file: a tracked symbol with no profile must be a `null` profile (never a thrown error, because
 * most of the board is in that state), and a product image with no recorded source/licence must not
 * be published even though its row exists.
 */
jest.mock('../src/database/prisma', () => ({
  prisma: { stock: { findUnique: jest.fn() } },
}));

import { prisma } from '../src/database/prisma';
import { getCompanyProfile } from '../src/repositories/companyProfile.repository';

const findUnique = prisma.stock.findUnique as unknown as jest.Mock;

const PRODUCT = {
  name: 'Cement',
  summary: 'Grey cement and clinker.',
  imagePath: '/products/cement-plant.jpg',
  imageSource: 'Wikimedia Commons',
  imageLicence: 'CC BY-SA 4.0',
};

beforeEach(() => {
  findUnique.mockReset();
});

describe('getCompanyProfile', () => {
  it('answers null for a symbol we do not track, so the caller can 404 it', async () => {
    findUnique.mockResolvedValue(null);
    await expect(getCompanyProfile('nope')).resolves.toBeNull();
  });

  it('answers a null profile for a tracked stock nobody has written up yet', async () => {
    // The ordinary case for most of the 511 symbols. It must not look like a fault.
    findUnique.mockResolvedValue({ symbol: 'HUBC', profile: null });

    await expect(getCompanyProfile('HUBC')).resolves.toEqual({ symbol: 'HUBC', profile: null });
  });

  it('uppercases the symbol before looking it up', async () => {
    findUnique.mockResolvedValue({ symbol: 'HUBC', profile: null });
    await getCompanyProfile('hubc');

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { symbol: 'HUBC' } }));
  });

  it('maps a written profile to the wire shape, with an ISO timestamp', async () => {
    findUnique.mockResolvedValue({
      symbol: 'LUCK',
      profile: {
        description: 'A cement manufacturer.',
        headOffice: 'Lucky Tower, Karachi',
        phone: '+92 21 111 555 777',
        website: 'https://luck Cement.example',
        ceo: 'Muhammad Ali Tabba',
        sourceNote: 'Company website, 2026-10',
        updatedAt: new Date('2026-10-16T10:00:00.000Z'),
        products: [PRODUCT],
      },
    });

    const read = await getCompanyProfile('LUCK');

    expect(read?.profile).toEqual({
      description: 'A cement manufacturer.',
      headOffice: 'Lucky Tower, Karachi',
      phone: '+92 21 111 555 777',
      website: 'https://luck Cement.example',
      ceo: 'Muhammad Ali Tabba',
      sourceNote: 'Company website, 2026-10',
      updatedAt: '2026-10-16T10:00:00.000Z',
      products: [
        {
          name: 'Cement',
          summary: 'Grey cement and clinker.',
          imagePath: '/products/cement-plant.jpg',
          imageSource: 'Wikimedia Commons',
          imageLicence: 'CC BY-SA 4.0',
        },
      ],
    });
  });

  it('withholds an image that has no recorded licence, keeping the rest of the product', async () => {
    // A product row can exist before its picture is cleared for use. Publishing the file without
    // a licence is the failure this guards: the product survives, the image does not.
    findUnique.mockResolvedValue({
      symbol: 'HUBC',
      profile: {
        description: null,
        headOffice: null,
        phone: null,
        website: null,
        ceo: null,
        sourceNote: null,
        updatedAt: new Date('2026-10-16T10:00:00.000Z'),
        products: [{ ...PRODUCT, imageLicence: null }],
      },
    });

    const read = await getCompanyProfile('HUBC');
    const product = read?.profile?.products[0];

    expect(product?.imagePath).toBeNull();
    expect(product?.name).toBe('Cement');
    expect(product?.summary).toBe('Grey cement and clinker.');
  });

  it('withholds an image whose source is missing too', async () => {
    findUnique.mockResolvedValue({
      symbol: 'HUBC',
      profile: {
        description: null,
        headOffice: null,
        phone: null,
        website: null,
        ceo: null,
        sourceNote: null,
        updatedAt: new Date('2026-10-16T10:00:00.000Z'),
        products: [{ ...PRODUCT, imageSource: null }],
      },
    });

    const read = await getCompanyProfile('HUBC');
    expect(read?.profile?.products[0]?.imagePath).toBeNull();
  });

  it('serves a product with no image at all without complaint', async () => {
    findUnique.mockResolvedValue({
      symbol: 'HUBC',
      profile: {
        description: null,
        headOffice: null,
        phone: null,
        website: null,
        ceo: null,
        sourceNote: null,
        updatedAt: new Date('2026-10-16T10:00:00.000Z'),
        products: [{ ...PRODUCT, imagePath: null, imageSource: null, imageLicence: null }],
      },
    });

    const read = await getCompanyProfile('HUBC');
    expect(read?.profile?.products[0]).toEqual({
      name: 'Cement',
      summary: 'Grey cement and clinker.',
      imagePath: null,
      imageSource: null,
      imageLicence: null,
    });
  });

  it('orders products by the writer position, not by insert order', async () => {
    findUnique.mockResolvedValue({ symbol: 'HUBC', profile: null });
    await getCompanyProfile('HUBC');

    const select = findUnique.mock.calls[0][0].select.profile.select.products;
    expect(select.orderBy).toEqual({ position: 'asc' });
  });
});
