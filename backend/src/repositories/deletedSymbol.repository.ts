import { prisma } from '../database/prisma';

/**
 * Symbols removed on purpose, remembered across restarts.
 *
 * A stock row cannot carry this flag itself — the row is what gets deleted. Without this record a
 * discovery pass reading a listing page that outlived the listing (ENGRO still has one; the board
 * carries ENGROH) puts the symbol straight back, which is exactly what kept happening.
 */
export const deletedSymbolRepository = {
  async record(symbol: string, reason?: string): Promise<void> {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    await prisma.deletedSymbol.upsert({
      where: { symbol: sym },
      update: { reason: reason ?? null, deletedAt: new Date() },
      create: { symbol: sym, reason: reason ?? null },
    });
  },

  /** Forget a deletion: only an explicit add should ever call this. */
  async forget(symbol: string): Promise<void> {
    const sym = symbol.trim().toUpperCase();
    await prisma.deletedSymbol.deleteMany({ where: { symbol: sym } });
  },

  async isDeleted(symbol: string): Promise<boolean> {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return false;
    const row = await prisma.deletedSymbol.findUnique({ where: { symbol: sym }, select: { symbol: true } });
    return row !== null;
  },

  /** The set of removed symbols, for a pass that wants to filter in one query. */
  async all(): Promise<Set<string>> {
    const rows = await prisma.deletedSymbol.findMany({ select: { symbol: true } });
    return new Set(rows.map((r) => r.symbol.toUpperCase()));
  },
};
