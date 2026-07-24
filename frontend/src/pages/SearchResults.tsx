import { useSearchParams, Link } from 'react-router-dom';
import { List, ListItemButton, ListItemText, Typography, Box, Skeleton, Alert } from '@mui/material';
import { useSearch } from '../api/hooks';

export function SearchResults() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, isLoading, isError } = useSearch(q);

  if (q.trim().length === 0) return <Alert severity="info">Type a query to search.</Alert>;

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Results for “{q}”</Typography>
      {isError && <Alert severity="error">Search failed.</Alert>}
      {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={48} />)}
      {data && data.results.length === 0 && <Typography>No matches.</Typography>}
      <List>
        {data?.results.map((r) => (
          <ListItemButton key={r.symbol} component={Link} to={`/stocks/${r.symbol}`}>
            <ListItemText
              primary={`${r.symbol} — ${r.companyName ?? ''}`}
              secondary={`Price: ${r.currentPrice ?? '—'} · Last trade: ${r.lastTradeDate ? new Date(r.lastTradeDate).toLocaleDateString() : '—'}`}
            />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
