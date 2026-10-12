import { useEffect, useState, type FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useHolding, useHoldings } from '../lib/holdings';

/**
 * Record, change or drop a position in one symbol.
 *
 * Deliberately separate from the watchlist star: following a stock and owning it are different
 * questions, and the star is a one-tap toggle while this needs two numbers. The position is stored
 * on the device only (`lib/holdings.ts`) — nothing here talks to the API.
 */
export function HoldingDialog({
  symbol,
  open,
  onClose,
}: {
  symbol: string;
  open: boolean;
  onClose: () => void;
}) {
  const { upsert, remove } = useHoldings();
  const holding = useHolding(symbol);
  const [quantity, setQuantity] = useState('');
  const [avgBuyPrice, setAvgBuyPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Seed from what is stored each time it opens: editing starts from the recorded position, and a
  // dialog reopened after a cancel does not resurrect the abandoned draft.
  useEffect(() => {
    if (!open) return;
    setQuantity(holding ? String(holding.quantity) : '');
    setAvgBuyPrice(holding ? String(holding.avgBuyPrice) : '');
    setError(null);
  }, [open, holding]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const qty = Number(quantity);
    const avg = Number(avgBuyPrice);
    if (quantity.trim() === '' || !Number.isFinite(qty) || qty <= 0) {
      setError('Enter a quantity greater than zero.');
      return;
    }
    if (avgBuyPrice.trim() === '' || !Number.isFinite(avg) || avg < 0) {
      setError('Enter an average buy price of zero or more.');
      return;
    }
    upsert({ symbol, quantity: qty, avgBuyPrice: avg });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>{holding ? `Edit holding — ${symbol}` : `Add holding — ${symbol}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputProps={{ inputMode: 'numeric', min: 1, step: 1 }}
              autoFocus
              fullWidth
            />
            <TextField
              label="Average buy price (Rs)"
              value={avgBuyPrice}
              onChange={(e) => setAvgBuyPrice(e.target.value)}
              inputProps={{ inputMode: 'decimal', min: 0, step: 'any' }}
              fullWidth
            />
            {error && (
              <Typography variant="body2" color="error.main" role="alert">
                {error}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Saved on this device only — nothing is sent to the server.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {holding && (
            <Button
              color="error"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => {
                remove(symbol);
                onClose();
              }}
            >
              Remove
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/**
 * The trigger. `compact` is the portfolio table's row action — a small "Edit" that opens the same
 * dialog the stock's own page offers, so there is one editor, not two.
 */
export function HoldingButton({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const holding = useHolding(symbol);
  const [open, setOpen] = useState(false);
  const label = compact ? 'Edit' : holding ? 'Edit holding' : 'Add holding';

  return (
    <>
      <Button
        size={compact ? 'small' : 'medium'}
        variant="outlined"
        startIcon={compact ? undefined : <AccountBalanceWalletRoundedIcon />}
        onClick={() => setOpen(true)}
        aria-label={compact ? `Edit holding for ${symbol}` : undefined}
      >
        {label}
      </Button>
      <HoldingDialog symbol={symbol} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
