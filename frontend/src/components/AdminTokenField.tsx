import { useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { adminToken, clearAdminToken, setAdminToken } from '../lib/adminToken';

/**
 * Where the operator enters the admin token for this browser.
 *
 * It is kept in localStorage and sent as `X-Admin-Token` on mutating requests only. Nothing is
 * compiled into the bundle: a `VITE_` variable would ship the token to every visitor.
 */
export function AdminTokenField() {
  const [value, setValue] = useState(adminToken());
  const [saved, setSaved] = useState(false);

  const save = () => {
    setAdminToken(value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const forget = () => {
    clearAdminToken();
    setValue('');
    setSaved(false);
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <TextField
          size="small"
          type="password"
          label="Admin token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          sx={{ maxWidth: 320 }}
          helperText="Stored in this browser only; sent on sync and mutation requests."
        />
        <Button variant="outlined" size="small" onClick={save} disabled={!value.trim()}>
          Save
        </Button>
        <Button size="small" onClick={forget} disabled={!value && !adminToken()}>
          Forget
        </Button>
        {saved && (
          <Typography variant="caption" color="success.main">
            Saved
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
