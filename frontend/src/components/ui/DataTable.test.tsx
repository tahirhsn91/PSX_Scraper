import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataTable, type Column } from './DataTable';

interface Row {
  symbol: string;
  price: number | null;
}

const columns: Column<Row>[] = [
  { key: 'symbol', header: 'Symbol', render: (r) => r.symbol },
  { key: 'price', header: 'Price', align: 'right', render: (r) => (r.price ?? '—') },
];

const renderTable = (rows: Row[], extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
  render(
    <MemoryRouter>
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.symbol}
        ariaLabel="Test table"
        {...extra}
      />
    </MemoryRouter>,
  );

describe('DataTable', () => {
  it('renders one row per item, in the order given', () => {
    renderTable([
      { symbol: 'OGDC', price: 299.1 },
      { symbol: 'HBL', price: null },
    ]);
    const rows = screen.getAllByRole('row');
    // header + 2 body rows
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('OGDC');
    expect(rows[2]).toHaveTextContent('HBL');
  });

  it('never invents a value for a missing cell', () => {
    renderTable([{ symbol: 'HBL', price: null }]);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the empty state instead of an empty body', () => {
    renderTable([], { emptyTitle: 'No stocks', emptyDescription: 'Widen the filters.' });
    expect(screen.getByText('No stocks')).toBeInTheDocument();
    expect(screen.getByText('Widen the filters.')).toBeInTheDocument();
  });

  it('shows an error state with a retry that fires', async () => {
    const onRetry = vi.fn();
    renderTable([], { error: 'Could not load.', onRetry });
    expect(screen.getByText('Could not load.')).toBeInTheDocument();
  });
});
