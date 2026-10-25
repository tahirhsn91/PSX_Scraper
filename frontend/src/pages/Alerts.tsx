import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert as MuiAlert,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/ToastProvider';
import { SectionCard } from '../components/ui/SectionCard';
import { StatePanel } from '../components/ui/StatePanel';
import { deviceToken } from '../lib/deviceToken';

interface AlertRow {
  id: string;
  symbol: string;
  companyName: string | null;
  kind: string;
  threshold: number | null;
  description: string;
  cooldownMinutes: number;
  paused: boolean;
  lastFiredAt: string | null;
  lastEvent: { firedAt: string; message: string; deliveryStatus: string; error: string | null } | null;
}

/** Kinds whose reading this app can evaluate today. Crosses need yesterday's average, which the
 * board-wide technical snapshot does not carry — offering them would create alerts that never fire. */
const KINDS = [
  { value: 'PRICE_ABOVE', label: 'Price at or above' },
  { value: 'PRICE_BELOW', label: 'Price at or below' },
  { value: 'PCT_MOVE', label: 'Daily move of at least (%)' },
  { value: 'RSI_ABOVE', label: 'RSI(14) at or above' },
  { value: 'RSI_BELOW', label: 'RSI(14) at or below' },
];

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Alerts as data conditions, evaluated while this page is open.
 *
 * Deliberately not a recommendation engine: the copy states readings, the conditions are things the
 * reader chose, and the page says when it last checked rather than implying a background daemon.
 */
export function Alerts() {
  const token = deviceToken();
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState('');
  const [kind, setKind] = useState('PRICE_ABOVE');
  const [threshold, setThreshold] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const headers = { headers: { 'X-Device-Token': token } };

  const list = useQuery({
    queryKey: ['alerts', token],
    queryFn: async () => (await api.get<{ items: AlertRow[] }>('/alerts', headers)).data,
  });

  const evaluate = useMutation({
    mutationFn: async () => (await api.post('/alerts/evaluate', {}, headers)).data as { checked: number; fired: unknown[] },
    onSuccess: (r) => {
      setCheckedAt(new Date().toISOString());
      if (r.fired.length > 0) qc.invalidateQueries({ queryKey: ['alerts', token] });
    },
  });

  // Evaluate on arrival, and every minute while the page stays open.
  useEffect(() => {
    evaluate.mutate();
    const t = setInterval(() => evaluate.mutate(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post(
          '/alerts',
          {
            symbol: symbol.trim().toUpperCase(),
            kind,
            threshold: threshold === '' ? undefined : Number(threshold),
            cooldownMinutes: 60,
          },
          headers,
        )
      ).data,
    onSuccess: () => {
      notify({ message: `${symbol.trim().toUpperCase()} alert created`, severity: 'success' });
      setSymbol('');
      setThreshold('');
      setFormError(null);
      qc.invalidateQueries({ queryKey: ['alerts', token] });
      // Check the new alert immediately rather than making the reader wait for the next minute.
      evaluate.mutate();
    },
    onError: (e) => setFormError((e as Error).message),
  });

  const toggle = useMutation({
    mutationFn: async (a: AlertRow) => (await api.patch(`/alerts/${a.id}`, { paused: !a.paused }, headers)).data,
    onSuccess: (_data, a) => {
      notify({ message: a.paused ? `${a.symbol} alert resumed` : `${a.symbol} alert paused`, severity: 'success' });
      qc.invalidateQueries({ queryKey: ['alerts', token] });
    },
  });

  const remove = useMutation({
    mutationFn: async (a: AlertRow) => (await api.delete(`/alerts/${a.id}`, headers)).data,
    onSuccess: (_data, a) => {
      notify({ message: `${a.symbol} alert deleted`, severity: 'success' });
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['alerts', token] });
    },
    onError: () => notify({ message: 'Could not delete the alert', severity: 'error' }),
  });

  const rows = list.data?.items ?? [];
  const [pendingDelete, setPendingDelete] = useState<AlertRow | null>(null);
  const { notify } = useToast();
  const needsThreshold = kind !== 'CROSS_ABOVE_SMA' && kind !== 'CROSS_BELOW_SMA';

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <PageHeader
        title="Alerts"
        subtitle="Conditions on price and RSI, checked while this page is open"
      />

      <SectionCard title="New alert" sx={{ mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
          <TextField
            size="small"
            label="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            sx={{ width: { xs: '100%', sm: 150 } }}
            inputProps={{ maxLength: 12 }}
          />
          <TextField
            select
            size="small"
            label="Condition"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            sx={{ width: { xs: '100%', sm: 260 } }}
          >
            {KINDS.map((k) => (
              <MenuItem key={k.value} value={k.value}>
                {k.label}
              </MenuItem>
            ))}
          </TextField>
          {needsThreshold && (
            <TextField
              size="small"
              label={kind.startsWith('RSI') ? 'Level' : 'Value'}
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              sx={{ width: { xs: '100%', sm: 130 } }}
            />
          )}
          <Button
            variant="contained"
            disabled={!symbol.trim() || (needsThreshold && threshold === '') || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </Stack>
        {formError && (
          <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
            {formError}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          An alert fires once, then stays quiet for an hour so a price resting on the line does not
          notify on every check.
        </Typography>
      </SectionCard>

      {/* The scope caveats sit after the form: a reader who wants to set an alert should meet the
          controls first, and these still explain the limits before the alert list. */}
      <MuiAlert severity="info" sx={{ mb: 3 }}>
        These are data conditions you set, not recommendations. Checks run when this page is open and
        every minute after; there is no background sender, and nothing is emailed. Alerts are tied to
        this browser — clearing site data removes them.
      </MuiAlert>

      <SectionCard
        title="Your alerts"
        subtitle={
          checkedAt
            ? `Last checked ${fmt(checkedAt)}${list.data ? ` · ${rows.length} on this device` : ''}`
            : 'Checking…'
        }
        flush
      >
        {list.isLoading ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">Loading…</Typography>
          </Box>
        ) : rows.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <StatePanel
              kind="empty"
              compact
              title="No alerts on this device"
              description="Create one above. Alerts live in this browser only — they are not an account and will not follow you to another device."
            />
          </Box>
        ) : (
          <Stack divider={<Typography sx={{ borderTop: 1, borderColor: 'divider', m: 0 }} />}>
            {rows.map((a) => (
              <Stack key={a.id} sx={{ px: 2, py: 1.5 }} spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography fontWeight={700}>{a.symbol}</Typography>
                  <Typography variant="body2">{a.description}</Typography>
                  {a.paused && <Chip size="small" label="paused" />}
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" onClick={() => toggle.mutate(a)}>
                    {a.paused ? 'Resume' : 'Pause'}
                  </Button>
                  <IconButton size="small" aria-label={`Delete alert for ${a.symbol}`} onClick={() => setPendingDelete(a)}>
                    ✕
                  </IconButton>
                </Stack>
                {a.lastEvent ? (
                  <Typography variant="caption" color="text.secondary">
                    {fmt(a.lastEvent.firedAt)} — {a.lastEvent.message}
                    {a.lastEvent.deliveryStatus === 'failed' && a.lastEvent.error
                      ? ` (delivery failed: ${a.lastEvent.error})`
                      : ''}
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    Not fired yet.
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        tone="error"
        title={`Delete the ${pendingDelete?.symbol ?? ''} alert?`}
        message={`This removes "${pendingDelete?.description ?? ''}" from this browser. It cannot be undone.`}
        confirmLabel="Delete alert"
        pendingLabel="Deleting…"
        pending={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      />
    </Container>
  );
}
