import { useEffect, useState } from 'react';
import { Autocomplete, TextField, CircularProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../api/hooks';

export function SearchBar() {
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input), 300);
    return () => clearTimeout(t);
  }, [input]);
  const { data, isFetching } = useSearch(debounced);

  return (
    <Autocomplete
      freeSolo
      options={data?.results ?? []}
      getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.symbol} — ${o.companyName ?? ''}`)}
      filterOptions={(x) => x}
      loading={isFetching}
      onInputChange={(_e, v) => setInput(v)}
      onChange={(_e, v) => {
        if (v && typeof v !== 'string') navigate(`/stocks/${v.symbol}`);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Search stocks (symbol or company)"
          placeholder="e.g. FFC"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isFetching ? <CircularProgress size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
