import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { useMarketStatus } from '../../api/hooks';
import type { DatasetStatus, SessionLabel } from '../../types';

/**
 * "How current is what I am looking at?"
 *
 * A small line for a page header: a coloured dot, the freshness word and the reading's own
 * timestamp, with the source and the session context in the tooltip. It is deliberately quiet —
 * this is provenance, not a headline — and it never animates, because a status that pulses draws
 * the eye away from the numbers it is describing.
 *
 * The one thing it must not do is guess: if the status payload cannot be read, it says so instead
 * of defaulting to "live".
 */

type DatasetKey = 'quotes' | 'indices' | 'candles' | 'dividends';

export interface DataStatusProps {
  /** Which dataset the numbers on this page come from. */
  dataset?: DatasetKey;
  /** Show the session chip alongside the freshness ("Market open", "Closed · Fri 16 Oct"). */
  session?: boolean;
}

const STATUS_TEXT: Record<DatasetStatus, string> = {
  live: 'Live',
  delayed: 'Delayed',
  'end-of-day': 'End of day',
  stale: 'Stale',
  unavailable: 'No data',
};

const STATUS_COLOUR: Record<DatasetStatus, string> = {
  live: 'success.main',
  delayed: 'warning.main',
  'end-of-day': 'text.secondary',
  stale: 'error.main',
  unavailable: 'text.disabled',
};

const SESSION_TEXT: Record<SessionLabel, string> = {
  open: 'Market open',
  'pre-open': 'Pre-open',
  'post-close': 'Market closed',
  weekend: 'Weekend',
  holiday: 'Exchange holiday',
};

const DATASET_LABEL: Record<DatasetKey, string> = {
  quotes: 'Prices',
  indices: 'Index levels',
  candles: 'Daily candles',
  dividends: 'Dividends',
};

/** Karachi time, because "as of 09:30" means nothing without the clock it was read on. */
const karachi = (iso: string, opts: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', ...opts }).format(new Date(iso));

const dayKey = (iso: string): string =>
  karachi(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });

const clock = (iso: string): string => karachi(iso, { hour: '2-digit', minute: '2-digit', hour12: false });

const shortDate = (iso: string): string => karachi(iso, { day: 'numeric', month: 'short' });

/** "14:32 today", "16 Oct" — the shortest form that is unambiguous for the reading. */
const readingTime = (iso: string): string => {
  const today = dayKey(new Date().toISOString());
  return dayKey(iso) === today ? `${clock(iso)} today` : `${clock(iso)} on ${shortDate(iso)}`;
};

const ageText = (seconds: number | null): string => {
  if (seconds == null) return 'never read';
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

export function DataStatus({ dataset = 'quotes', session = false }: DataStatusProps) {
  const { data, isError } = useMarketStatus();

  if (isError) {
    return (
      <Typography variant="caption" color="text.disabled">
        Data status unavailable
      </Typography>
    );
  }

  if (!data) {
    // A fixed line rather than nothing: the header must not jump when the answer arrives.
    return (
      <Typography variant="caption" color="text.disabled">
        Checking data status…
      </Typography>
    );
  }

  const reading = data.datasets[dataset];
  const statusColour = STATUS_COLOUR[reading.status];
  const sessionLabel = data.sessionLabel;
  const lastSession = data.lastSessionDate
    ? shortDate(`${data.lastSessionDate}T12:00:00Z`)
    : null;

  const tooltip = (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
        {DATASET_LABEL[dataset]} · {STATUS_TEXT[reading.status]}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        {reading.asOf
          ? `Read ${readingTime(reading.asOf)} (${ageText(reading.ageSeconds)})`
          : 'No reading stored for this dataset'}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        Source: {reading.source}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        {SESSION_TEXT[sessionLabel]}
        {lastSession ? ` · last session ${lastSession}` : ''}
      </Typography>
    </Box>
  );

  return (
    <Tooltip title={tooltip} placement="bottom-start" arrow>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        useFlexGap
        flexWrap="wrap"
        sx={{ rowGap: 0.5, cursor: 'help', width: 'fit-content' }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box
            aria-hidden
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: statusColour,
              flexShrink: 0,
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ color: statusColour, fontWeight: 600 }}>
              {STATUS_TEXT[reading.status]}
            </Box>
            {reading.asOf ? ` · as of ${readingTime(reading.asOf)}` : ''}
          </Typography>
        </Stack>

        {session && (
          <Typography
            variant="caption"
            sx={{
              color: sessionLabel === 'open' ? 'success.main' : 'text.secondary',
              fontWeight: sessionLabel === 'open' ? 600 : 500,
              whiteSpace: 'nowrap',
              '&::before': { content: '""', mx: 0.25 },
            }}
          >
            {SESSION_TEXT[sessionLabel]}
            {sessionLabel !== 'open' && lastSession ? ` · last session ${lastSession}` : ''}
          </Typography>
        )}
      </Stack>
    </Tooltip>
  );
}
