import { Alert, Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useDataSources } from '../api/hooks';
import { DASH, formatRelative } from '../lib/format';
import { StatePanel } from './ui/StatePanel';

/**
 * Where the data comes from, and whether it is working (#214).
 *
 * The licence column is the point: every source is `unconfirmed`, because no permission is on
 * record. That is stated rather than left blank, and nothing here calls the data licensed or
 * real-time.
 */
export function DataSourcesCard() {
  const { data, isLoading, isError } = useDataSources();
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));

  if (isLoading) return <StatePanel kind="loading" title="Loading data sources" />;
  if (isError || !data) return <StatePanel kind="error" title="Sources could not be loaded" description="The registry endpoint did not answer." />;

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6">Data sources</Typography>
        <Chip size="small" variant="outlined" color="warning" label={`${data.unlicensedCount} unconfirmed`} />
        {data.disabled.length > 0 && <Chip size="small" variant="outlined" label={`disabled: ${data.disabled.join(', ')}`} />}
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        No written permission or terms review is on record for any provider below. Licence status is
        recorded as <em>unconfirmed</em> until business/legal supplies a position.
      </Typography>

      {data.unknownDisabledIds.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          <code>DATA_SOURCES_DISABLED</code> names ids that do not exist: {data.unknownDisabledIds.join(', ')} — they disable nothing.
        </Alert>
      )}

      {isPhone ? (
        // Seven columns cannot survive 390px: the table was clipped at the card edge and the
        // Attempts/Last success columns were unreachable. Each source becomes its own block.
        <Stack spacing={1.25} aria-label="Data sources">
          {data.sources.map((s) => (
            <Box key={s.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                <Box sx={{ minWidth: 0 }}>
                  <Tooltip title={`${s.hosts.join(', ')} · ${s.provides.join(', ')}`}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {s.name}
                    </Typography>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {s.id} · {s.category}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant={s.enabled ? 'filled' : 'outlined'}
                  color={s.enabled ? 'success' : 'default'}
                  label={s.enabled ? 'enabled' : 'disabled'}
                />
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={s.licence.status === 'permitted' ? 'success' : 'warning'}
                  label={`Licence: ${s.licence.status}`}
                />
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                  {s.attempts ? `${s.attempts} attempts · ${(s.errorRate * 100).toFixed(1)}% errors` : 'No attempts'}
                  {' · '}Last success {s.lastSuccessAt ? formatRelative(s.lastSuccessAt) : DASH}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <Table size="small" aria-label="Data sources">
          <TableHead>
            <TableRow>
              <TableCell>Source</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Licence</TableCell>
              <TableCell align="right">Attempts</TableCell>
              <TableCell align="right">Error rate</TableCell>
              <TableCell>Last success</TableCell>
              <TableCell>State</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.sources.map((s) => (
              <TableRow key={s.id} hover>
                <TableCell>
                  <Tooltip title={`${s.hosts.join(', ')} · ${s.provides.join(', ')}`}>
                    <span>{s.name}</span>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {s.id}
                  </Typography>
                </TableCell>
                <TableCell>{s.category}</TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" color={s.licence.status === 'permitted' ? 'success' : 'warning'} label={s.licence.status} />
                </TableCell>
                <TableCell align="right">{s.attempts || DASH}</TableCell>
                <TableCell align="right">{s.attempts ? `${(s.errorRate * 100).toFixed(1)}%` : DASH}</TableCell>
                <TableCell>{s.lastSuccessAt ? formatRelative(s.lastSuccessAt) : DASH}</TableCell>
                <TableCell>
                  <Chip size="small" variant={s.enabled ? 'filled' : 'outlined'} color={s.enabled ? 'success' : 'default'} label={s.enabled ? 'enabled' : 'disabled'} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}
