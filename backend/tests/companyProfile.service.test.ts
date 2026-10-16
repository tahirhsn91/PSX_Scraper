/**
 * The service split that the page depends on:
 *
 *   - an untracked symbol is a 404, like every other per-symbol read
 *   - a tracked symbol with no profile is a 200 carrying `profile: null`
 *
 * Getting the second wrong (throwing instead) would make the stock page log a failure every time
 * someone opened one of the ~500 companies not yet written up, which is most of the board.
 */
jest.mock('../src/repositories/companyProfile.repository', () => ({
  getCompanyProfile: jest.fn(),
}));

import { getCompanyProfile } from '../src/repositories/companyProfile.repository';
import { companyProfileService } from '../src/services/companyProfile.service';
import { NotFoundError } from '../src/types/errors';

const mockRead = getCompanyProfile as unknown as jest.Mock;

beforeEach(() => {
  mockRead.mockReset();
});

describe('companyProfileService.get', () => {
  it('404s a symbol we do not track', async () => {
    mockRead.mockResolvedValue(null);

    await expect(companyProfileService.get('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(companyProfileService.get('nope')).rejects.toThrow(/Stock not tracked: NOPE/);
  });

  it('succeeds with a null profile for a tracked stock with nothing written yet', async () => {
    mockRead.mockResolvedValue({ symbol: 'OGDC', profile: null });

    await expect(companyProfileService.get('ogdc')).resolves.toEqual({
      symbol: 'OGDC',
      profile: null,
    });
  });

  it('returns the profile unchanged when there is one', async () => {
    const profile = {
      description: 'A cement manufacturer.',
      headOffice: null,
      phone: null,
      website: null,
      ceo: null,
      sourceNote: null,
      updatedAt: '2026-10-16T10:00:00.000Z',
      products: [],
    };
    mockRead.mockResolvedValue({ symbol: 'LUCK', profile });

    await expect(companyProfileService.get('LUCK')).resolves.toEqual({ symbol: 'LUCK', profile });
  });
});
