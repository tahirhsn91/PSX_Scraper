import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@mui/material';
import { StatePanel } from './StatePanel';

describe('StatePanel', () => {
  it('explains an empty result instead of showing a blank card', () => {
    render(<StatePanel kind="empty" title="No dividends on record" description="Nothing matches these filters." />);
    expect(screen.getByText('No dividends on record')).toBeInTheDocument();
    expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument();
  });

  it('announces errors to assistive technology', () => {
    render(<StatePanel kind="error" title="Could not load" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
  });

  it('marks a loading panel busy', () => {
    render(<StatePanel kind="loading" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the recovery action it is given', async () => {
    const onRetry = vi.fn();
    render(<StatePanel kind="error" action={<Button onClick={onRetry}>Try again</Button>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
