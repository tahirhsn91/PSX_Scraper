import { useEffect, useState } from 'react';
import { Autocomplete, Box, CircularProgress, InputAdornment, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/SearchRounded';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../../api/hooks';
import type { SearchResult } from '../../types';

export interface GlobalSearchProps {
  autoFocus?: boolean;
  size?: 'small' | 'medium';
  /** Called after a navigation is triggered (the mobile sheet closes itself with this). */
  onNavigate?: () => void;
  placeholder?: string;
}

/**
 * The app's single search input, used inline in the desktop header and inside the mobile sheet.
 *
 * Behaviour changes from the old page-local bar: it needs two characters before querying (one
 * keystroke used to fire a request), it shows one loading indicator instead of two, it labels
 * options with the sector, and pressing Enter on free text goes to the results page instead of
 * doing nothing.
 */
export function GlobalSearch({
  autoFocus = false,
  size = 'small',
  onNavigate,
  placeholder = 'Search symbol or company',
}: GlobalSearchProps) {
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const enabled = debounced.length >= 2;
  const { data, isFetching } = useSearch(enabled ? debounced : '');
  const results: SearchResult[] = enabled ? (data?.results ?? []) : [];

  const go = (path: string) => {
    navigate(path);
    setInput('');
    onNavigate?.();
  };

  return (
    <Autocomplete
      freeSolo
      size={size}
      options={results}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.symbol)}
      filterOptions={(x) => x}
      loading={isFetching}
      autoHighlight
      noOptionsText={enabled ? 'No matches' : 'Type at least two characters'}
      onInputChange={(_e, value) => setInput(value)}
      onChange={(_e, value) => {
        if (value && typeof value !== 'string') go(`/stocks/${value.symbol}`);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const prevented = (e as unknown as { defaultMuiPrevented?: boolean }).defaultMuiPrevented;
        const typed = input.trim();
        if (prevented || typed.length === 0) return;
        const exact = results.some((r) => r.symbol.toLowerCase() === typed.toLowerCase());
        if (!exact) go(`/search?q=${encodeURIComponent(typed)}`);
      }}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option.symbol} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {option.symbol}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 320 }}>
            {[option.companyName, option.sector].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={placeholder}
          placeholder="e.g. OGDC"
          autoFocus={autoFocus}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: (
              <>
                {isFetching ? <CircularProgress size={16} thickness={5} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
