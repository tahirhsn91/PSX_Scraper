import { IconButton, Tooltip } from '@mui/material';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import { useWatchlist } from '../lib/watchlist';

/**
 * The watchlist star. A toggle, not a button: `aria-pressed` carries the state. Reads and writes the
 * device-local watchlist, so it works with no account. `stopPropagation` keeps it from tripping a
 * table row's own click — the row navigates; the star must not.
 */
export function WatchButton({ symbol, size = 'small' }: { symbol: string; size?: 'small' | 'medium' }) {
  const { has, toggle } = useWatchlist();
  const watching = has(symbol);
  return (
    <Tooltip title={watching ? 'Remove from watchlist' : 'Add to watchlist'}>
      <IconButton
        size={size}
        aria-label={watching ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
        aria-pressed={watching}
        onClick={(e) => {
          e.stopPropagation();
          toggle(symbol);
        }}
        sx={{ color: watching ? 'primary.main' : 'text.secondary' }}
      >
        {watching ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}
      </IconButton>
    </Tooltip>
  );
}
