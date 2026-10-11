import { marketRepository } from '../repositories/market.repository';

/**
 * Market-wide read models: breadth, movers, sectors and dividends.
 *
 * All of these are derived from data the sync already holds (the newest price and ratio rows), so
 * nothing here fetches a source — the whole surface is local SQL, which is what keeps it cheap
 * enough to sit on the public dashboard rather than behind a sync.
 */
export const marketService = {
  /** Breadth over the whole tracked universe, plus the top gainers / losers / most active. */
  async overview() {
    const [breadth, movers] = await Promise.all([
      marketRepository.breadth(),
      marketRepository.movers(5),
    ]);
    return { breadth, movers };
  },

  /** One row per sector, aggregated over its members' newest priced rows. */
  async sectors() {
    return marketRepository.sectors();
  },

  /**
   * Upcoming dividend events plus the highest current yields. The two are different questions —
   * "what is coming" vs "what pays best" — so they answer in one payload rather than two
   * round-trips.
   */
  async dividends(limit: number) {
    const [upcoming, topYield] = await Promise.all([
      marketRepository.upcomingDividends(limit),
      marketRepository.highestYield(20),
    ]);
    return { upcoming, topYield };
  },
};
