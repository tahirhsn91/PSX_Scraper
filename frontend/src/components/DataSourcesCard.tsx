import { Alert, Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
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
    </Box>
  );
}
