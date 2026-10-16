import { NotFoundError } from '../types/errors';
import {
  getCompanyProfile,
  type CompanyProfileRead,
} from '../repositories/companyProfile.repository';

/**
 * The stock page's "Company Description" section.
 *
 * Thin on purpose: the repository owns the shape and the absent-vs-untracked distinction, and this
 * layer only decides that an untracked symbol is a 404 (matching `/stocks/:symbol` and
 * `/stocks/:symbol/candles`) while a tracked symbol with nothing written yet is a `200` carrying
 * `profile: null`. The frontend renders *no section at all* for that case, so the empty answer has
 * to be a normal, successful response — a 404 here would make the page log an error every time
 * someone opened one of the ~500 companies not yet written up.
 */
export const companyProfileService = {
  async get(symbol: string): Promise<CompanyProfileRead> {
    const read = await getCompanyProfile(symbol);
    if (read === null) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);
    return read;
  },
};
