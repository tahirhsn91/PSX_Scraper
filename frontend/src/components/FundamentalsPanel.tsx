import { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Card,
  Drawer,
  Grid,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { SectionCard } from './ui/SectionCard';
import { StatTile } from './ui/StatTile';
import { DASH, formatCount, formatNumber } from '../lib/format';
import type { StockDetail } from '../types';

type Ratios = NonNullable<StockDetail['ratios']>;
type Insights = NonNullable<StockDetail['insights']>;

/** Per-metric copy: one line of what-it-is, one line of direction. */
interface MetricMeta {
  key: keyof Ratios;
  label: string;
  what: string;
  direction: 'higher' | 'lower' | 'band' | 'neutral';
  /** How the value is formatted and suffixed. */
  kind: 'rs' | 'pct' | 'x' | 'shares';
  /** Colour the value by sign — for figures that can be negative (growth). */
  signed?: boolean;
}

/** A logical cluster of metrics, shown as one collapsible group. */
interface MetricCategory {
  key: string;
  label: string;
  metrics: MetricMeta[];
}

/**
 * The metrics grouped into five scannable clusters. Grouping is fixed, not derived: a metric's
 * category is a display decision, so it lives with the label and the explanation rather than being
 * inferred from the field name.
 */
const CATEGORIES: MetricCategory[] = [
  {
    key: 'valuation',
    label: 'Valuation',
    metrics: [
      { key: 'eps', label: 'EPS', kind: 'rs', what: 'Earnings per share — the profit each share earned.', direction: 'higher' },
      { key: 'peRatio', label: 'P/E', kind: 'x', what: 'Price-to-earnings — the price for each rupee of earnings.', direction: 'lower' },
      { key: 'bookValue', label: 'Book Value / Share', kind: 'rs', what: 'Net assets per share (equity ÷ shares outstanding).', direction: 'higher' },
      { key: 'pbRatio', label: 'P/B', kind: 'x', what: 'Price-to-book — price versus book value per share.', direction: 'lower' },
      { key: 'dividendYield', label: 'Dividend Yield', kind: 'pct', what: 'Annual dividend as a percentage of the price.', direction: 'higher' },
      { key: 'dps', label: 'DPS', kind: 'rs', what: 'Dividend per share — the latest announced dividend.', direction: 'higher' },
    ],
  },
  {
    key: 'profitability',
    label: 'Profitability',
    metrics: [
      { key: 'roe', label: 'ROE', kind: 'pct', what: 'Return on equity — profit as a % of shareholders’ equity.', direction: 'higher' },
      { key: 'roa', label: 'ROA', kind: 'pct', what: 'Return on assets — profit as a % of total assets.', direction: 'higher' },
      { key: 'roic', label: 'ROIC', kind: 'pct', what: 'Return on average invested capital.', direction: 'higher' },
      { key: 'netProfitMargin', label: 'Net Profit Margin', kind: 'pct', what: 'Profit after tax as a percentage of revenue.', direction: 'higher' },
    ],
  },
  {
    key: 'health',
    label: 'Financial Health',
    metrics: [
      { key: 'debtToEquity', label: 'D/E', kind: 'x', what: 'Debt-to-equity — debt as a multiple of equity.', direction: 'lower' },
      { key: 'currentRatio', label: 'Current Ratio', kind: 'x', what: 'Current assets ÷ current liabilities — short-term liquidity.', direction: 'higher' },
      { key: 'payoutRatio', label: 'Payout Ratio', kind: 'pct', what: 'Share of earnings paid out as dividends.', direction: 'band' },
      { key: 'beta', label: 'Beta', kind: 'x', what: 'Volatility versus the market — above 1 moves more, below 1 moves less.', direction: 'neutral' },
    ],
  },
  {
    key: 'growth',
    label: 'Growth',
    metrics: [
      { key: 'revenueGrowth', label: 'Revenue Growth', kind: 'pct', what: 'Year-over-year growth in net sales.', direction: 'higher', signed: true },
      { key: 'epsGrowth', label: 'EPS Growth', kind: 'pct', what: 'Year-over-year growth in basic earnings per share.', direction: 'higher', signed: true },
    ],
  },
  {
    key: 'shareholding',
    label: 'Shareholding',
    metrics: [
      { key: 'freeFloatShares', label: 'Free Float Share', kind: 'shares', what: 'Shares freely tradeable on the market.', direction: 'neutral' },
      { key: 'freeFloatPercent', label: 'Free Float Share %', kind: 'pct', what: 'Free float as a percentage of shares outstanding.', direction: 'neutral' },
    ],
  },
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
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Growth figures carry direction colour by sign; everything else stays neutral to avoid fatigue. */
function valueColor(meta: MetricMeta, value: number | null, theme: Theme): string {
  if (meta.signed && value != null && value !== 0) {
    return value > 0 ? theme.palette.up.main : theme.palette.down.main;
  }
  return theme.palette.text.primary;
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
 * The Fundamentals tab. The 18 per-share/ratio metrics are grouped into five collapsible clusters,
 * each a two-column grid, so a phone gets a scannable, grouped board instead of a single-column wall
 * of tiles. Every metric carries a ⓘ that opens a bottom sheet with its definition — hover tooltips
 * do not exist on a phone. Nothing here invents a number: an unpublished metric renders `—`, and a
 * stock with no published fundamentals at all shows an explicit note rather than a blank.
 */
export function FundamentalsPanel({ ratios, insights }: FundamentalsPanelProps) {
  const theme = useTheme();
  const [info, setInfo] = useState<MetricMeta | null>(null);

  const currentAssessed = insights?.current.assessed ?? 0;
  const futureAssessed = insights?.future.assessed ?? 0;
  const hasAnyMetric = currentAssessed + futureAssessed > 0;

  return (
    <Stack spacing={2}>
      <SectionCard
        title="Fundamentals"
        subtitle="Grouped by what they measure · blank means the field was not on the page we read"
      >
        {ratios ? (
          <Stack spacing={1}>
            {CATEGORIES.map((cat) => (
              <Accordion
                key={cat.key}
                defaultExpanded
                disableGutters
                elevation={0}
                square={false}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  '&:before': { display: 'none' },
                  '&.Mui-expanded': { m: 0 },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  aria-controls={`fundamentals-${cat.key}-content`}
                  id={`fundamentals-${cat.key}-header`}
                  // 48px ≥ the 44px touch target, chevron included inside that height.
                  sx={{ minHeight: 48, '& .MuiAccordionSummary-content': { my: 1, alignItems: 'center' } }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {cat.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {cat.metrics.length}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0.5, px: 1.5, pb: 1.5 }}>
                  <Grid container spacing={1.5}>
                    {cat.metrics.map((m) => (
                      <Grid item xs={6} md={4} key={m.key}>
                        <Card variant="outlined" sx={{ height: '100%' }}>
                          <Box sx={{ p: 1.5 }}>
                            <Stack direction="row" spacing={0.5} alignItems="flex-start" justifyContent="space-between">
                              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                                {m.label}
                              </Typography>
                              <IconButton
                                size="small"
                                onClick={() => setInfo(m)}
                                aria-label={`What is ${m.label}?`}
                                sx={{ p: 0.5, mt: -0.5, mr: -0.5, color: 'text.secondary' }}
                              >
                                <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Stack>
                            <Typography
                              variant="subtitle1"
                              noWrap
                              title={ratios[m.key] != null ? formatMetric(ratios[m.key], m.kind) : undefined}
                              sx={{ color: valueColor(m, ratios[m.key], theme), lineHeight: 1.25, mt: 0.25 }}
                            >
                              {formatMetric(ratios[m.key], m.kind)}
                            </Typography>
                          </Box>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </AccordionDetails>
              </Accordion>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Sync the company page to pick up EPS, P/E, ROE and the rest.
          </Typography>
        )}
      </SectionCard>

      {/* The ⓘ definition as a bottom sheet — reachable by tap on every viewport. */}
      <Drawer
        anchor="bottom"
        open={info != null}
        onClose={() => setInfo(null)}
        PaperProps={{
          sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, p: 2, pb: 3, maxWidth: 640, mx: 'auto' },
        }}
      >
        {info && (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Typography variant="h6" component="h3">
                {info.label}
              </Typography>
              <IconButton onClick={() => setInfo(null)} aria-label="Close definition" edge="end">
                <CloseIcon />
              </IconButton>
            </Stack>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {info.what}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {DIRECTION_TEXT[info.direction]}
            </Typography>
          </Box>
        )}
      </Drawer>

      <SectionCard
        title="Performance Insights"
        subtitle={
          hasAnyMetric
            ? `Scored from ${currentAssessed} current${
                futureAssessed ? ` and ${futureAssessed} forward` : ''
              } metrics`
            : 'No fundamentals published for this stock'
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
        {hasAnyMetric && insights ? (
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
                value={insights.current.score == null ? DASH : `${insights.current.score} / 100`}
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
                value={insights.future.score == null ? DASH : `${insights.future.score} / 100`}
                valueTitle={insights.future.score == null ? undefined : `${insights.future.score} out of 100`}
                footer={
                  <Typography variant="caption" color="text.secondary">
                    {insights.future.fallback
                      ? 'from current metrics'
                      : `${insights.future.assessed} metric${insights.future.assessed === 1 ? '' : 's'} scored`}
                  </Typography>
                }
                tone={insights.future.score == null ? 'muted' : insights.future.score >= 67 ? 'up' : insights.future.score >= 34 ? 'warning' : 'down'}
              />
            </Stack>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            The source publishes no fundamentals for this stock, so there is nothing to score — a
            blank means the figure does not exist, not that it is zero.
          </Typography>
        )}
      </SectionCard>

      <SectionCard
        title="Future Outlook"
        subtitle="Forward-looking view from growth, profitability and leverage"
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
        {insights?.outlook ? (
          <>
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
              {OUTLOOK_LABEL[insights.outlook]}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {insights.future.fallback
                ? 'Growth figures are not published for this stock, so the outlook is derived from its current fundamentals.'
                : 'Based on revenue growth, EPS growth, profitability and leverage relative to the sector and to fixed benchmarks.'}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Not enough published fundamentals to estimate the outlook.
          </Typography>
        )}
      </SectionCard>
    </Stack>
  );
}
