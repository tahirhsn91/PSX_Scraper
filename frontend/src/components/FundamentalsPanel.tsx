import { Grid, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { SectionCard } from './ui/SectionCard';
import { StatTile } from './ui/StatTile';
import { DASH, formatCount, formatNumber } from '../lib/format';
import type { StockDetail } from '../types';

type Ratios = NonNullable<StockDetail['ratios']>;
type Insights = NonNullable<StockDetail['insights']>;

/** Per-metric tooltip: one line of what-it-is, one line of direction. */
interface MetricMeta {
  key: keyof Ratios;
  label: string;
  what: string;
  direction: 'higher' | 'lower' | 'band' | 'neutral';
  /** How the value is formatted and suffixed. */
  kind: 'rs' | 'pct' | 'x' | 'shares';
}

const METRICS: MetricMeta[] = [
  { key: 'eps', label: 'EPS', kind: 'rs', what: 'Earnings per share — the profit each share earned.', direction: 'higher' },
  { key: 'peRatio', label: 'P/E', kind: 'x', what: 'Price-to-earnings — the price for each rupee of earnings.', direction: 'lower' },
  { key: 'bookValue', label: 'Book Value / Share', kind: 'rs', what: 'Net assets per share (equity ÷ shares outstanding).', direction: 'higher' },
  { key: 'pbRatio', label: 'P/B', kind: 'x', what: 'Price-to-book — price versus book value per share.', direction: 'lower' },
  { key: 'dividendYield', label: 'Dividend Yield', kind: 'pct', what: 'Annual dividend as a percentage of the price.', direction: 'higher' },
  { key: 'dps', label: 'DPS', kind: 'rs', what: 'Dividend per share — the latest announced dividend.', direction: 'higher' },
  { key: 'payoutRatio', label: 'Payout Ratio', kind: 'pct', what: 'Share of earnings paid out as dividends.', direction: 'band' },
  { key: 'roe', label: 'ROE', kind: 'pct', what: 'Return on equity — profit as a % of shareholders\u2019 equity.', direction: 'higher' },
  { key: 'roa', label: 'ROA', kind: 'pct', what: 'Return on assets — profit as a % of total assets.', direction: 'higher' },
  { key: 'roic', label: 'ROIC', kind: 'pct', what: 'Return on average invested capital.', direction: 'higher' },
  { key: 'debtToEquity', label: 'D/E', kind: 'x', what: 'Debt-to-equity — debt as a multiple of equity.', direction: 'lower' },
  { key: 'currentRatio', label: 'Current Ratio', kind: 'x', what: 'Current assets ÷ current liabilities — short-term liquidity.', direction: 'higher' },
  { key: 'netProfitMargin', label: 'Net Profit Margin', kind: 'pct', what: 'Profit after tax as a percentage of revenue.', direction: 'higher' },
  { key: 'revenueGrowth', label: 'Revenue Growth', kind: 'pct', what: 'Year-over-year growth in net sales.', direction: 'higher' },
  { key: 'epsGrowth', label: 'EPS Growth', kind: 'pct', what: 'Year-over-year growth in basic earnings per share.', direction: 'higher' },
  { key: 'freeFloatShares', label: 'Free Float Share', kind: 'shares', what: 'Shares freely tradeable on the market.', direction: 'neutral' },
  { key: 'freeFloatPercent', label: 'Free Float Share %', kind: 'pct', what: 'Free float as a percentage of shares outstanding.', direction: 'neutral' },
];

const DIRECTION_TEXT: Record<MetricMeta['direction'], string> = {
  higher: 'Higher is better.',
  lower: 'Lower is better.',
  band: 'Between 20% and 70% is considered healthy.',
  neutral: 'Informational — no good/bad value.',
};

function formatMetric(value: number | null, kind: MetricMeta['kind']): string {
  if (value === null) return DASH;
  if (kind === 'shares') return formatCount(value);
  if (kind === 'pct') return `${formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (kind === 'x') return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The small ⓘ in each tile's top-right corner. */
function InfoIcon({ what, direction }: Pick<MetricMeta, 'what' | 'direction'>) {
  return (
    <Tooltip
      arrow
      title={
        <Stack spacing={0.5} sx={{ py: 0.5 }}>
          <Typography variant="body2">{what}</Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {DIRECTION_TEXT[direction]}
          </Typography>
        </Stack>
      }
    >
      <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} aria-label="Metric explanation" />
    </Tooltip>
  );
}

const VERDICT_LABEL: Record<'strong' | 'fair' | 'weak', string> = {
  strong: 'Strong',
  fair: 'Fair',
  weak: 'Weak',
};

const OUTLOOK_LABEL: Record<'positive' | 'neutral' | 'cautious', string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  cautious: 'Cautious',
};

function scoreColor(score: number | null, theme: Theme): string {
  if (score === null) return theme.palette.text.secondary;
  if (score >= 67) return theme.palette.up.main;
  if (score >= 34) return theme.palette.warning.main;
  return theme.palette.down.main;
}

interface FundamentalsPanelProps {
  ratios: Ratios | null;
  insights: Insights | null;
}

/**
 * The Fundamentals tab: the 17 per-share/ratio metrics, each with its own ⓘ, plus the two derived
 * blocks. Nothing here invents a number — an unpublished metric renders `—`, and an absent sector
 * hides the insights rather than scoring a stock against itself.
 */
export function FundamentalsPanel({ ratios, insights }: FundamentalsPanelProps) {
  const theme = useTheme();

  return (
    <Stack spacing={2}>
      <SectionCard
        title="Fundamentals"
        subtitle="As published on the company page · blank means the field was not on the page we read"
      >
        {ratios ? (
          <Grid container spacing={1.5}>
            {METRICS.map((m) => (
              <Grid item xs={6} sm={4} md={2} key={m.key}>
                <StatTile
                  label={m.label}
                  value={formatMetric(ratios[m.key], m.kind)}
                  valueTitle={ratios[m.key] != null ? formatMetric(ratios[m.key], m.kind) : undefined}
                  icon={<InfoIcon what={m.what} direction={m.direction} />}
                />
              </Grid>
            ))}
          </Grid>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Sync the company page to pick up EPS, P/E, ROE and the rest.
          </Typography>
        )}
      </SectionCard>

      {insights && (
        <SectionCard
          title="Performance Insights"
          subtitle={
            insights.current.assessed + insights.future.assessed > 0
              ? `Scored from ${insights.current.assessed} current and ${insights.future.assessed} future metrics`
              : 'No metrics to score'
          }
          action={
            <Tooltip
              arrow
              title={
                <Typography variant="body2" sx={{ py: 0.5 }}>
                  Calculated from the current Fundamentals metrics — not a forecast, not a
                  recommendation.
                </Typography>
              }
            >
              <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} aria-label="Performance Insights explanation" />
            </Tooltip>
          }
        >
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="baseline" flexWrap="wrap" useFlexGap>
              <Typography variant="h3" sx={{ color: scoreColor(insights.overall, theme), lineHeight: 1 }}>
                {insights.overall ?? DASH}
              </Typography>
              {insights.verdict && (
                <Typography variant="overline" color="text.secondary">
                  {VERDICT_LABEL[insights.verdict]}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                out of 100
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <StatTile
                label="Current performance"
                value={
                  insights.current.score == null
                    ? DASH
                    : `${insights.current.score} / 100`
                }
                valueTitle={insights.current.score == null ? undefined : `${insights.current.score} out of 100`}
                footer={
                  <Typography variant="caption" color="text.secondary">
                    {insights.current.assessed} metric{insights.current.assessed === 1 ? '' : 's'} scored
                  </Typography>
                }
                tone={insights.current.score == null ? 'muted' : insights.current.score >= 67 ? 'up' : insights.current.score >= 34 ? 'warning' : 'down'}
              />
              <StatTile
                label="Future performance"
                value={
                  insights.future.score == null
                    ? DASH
                    : `${insights.future.score} / 100`
                }
                valueTitle={insights.future.score == null ? undefined : `${insights.future.score} out of 100`}
                footer={
                  <Typography variant="caption" color="text.secondary">
                    {insights.future.assessed} metric{insights.future.assessed === 1 ? '' : 's'} scored
                  </Typography>
                }
                tone={insights.future.score == null ? 'muted' : insights.future.score >= 67 ? 'up' : insights.future.score >= 34 ? 'warning' : 'down'}
              />
            </Stack>
          </Stack>
        </SectionCard>
      )}

      {insights && (
        <SectionCard
          title="Future Outlook"
          subtitle="Forward-looking view from the growth metrics"
          action={
            <Tooltip
              arrow
              title={
                <Typography variant="body2" sx={{ py: 0.5 }}>
                  Derived from the current Fundamentals metrics — an indication of trajectory, not a
                  guarantee of future returns.
                </Typography>
              }
            >
              <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} aria-label="Future Outlook explanation" />
            </Tooltip>
          }
        >
          <Typography
            variant="h5"
            sx={{
              color:
                insights.outlook === 'positive'
                  ? theme.palette.up.main
                  : insights.outlook === 'cautious'
                    ? theme.palette.down.main
                    : theme.palette.warning.main,
            }}
          >
            {insights.outlook ? OUTLOOK_LABEL[insights.outlook] : DASH}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Based on revenue growth, EPS growth and leverage relative to the sector and to fixed
            benchmarks.
          </Typography>
        </SectionCard>
      )}
    </Stack>
  );
}
