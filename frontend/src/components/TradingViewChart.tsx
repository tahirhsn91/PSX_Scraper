import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

/**
 * TradingView's own chart widget, embedded.
 *
 * This is the sanctioned way to show TradingView's data: their script renders their chart in
 * an iframe served by them. Nothing is scraped, nothing is stored, and no key is needed. The
 * symbol comes straight from the route as `PSX:<SYMBOL>` — which their universe carries for
 * both stocks (PSX:FFC) and indices (PSX:KSE100, PSX:KSE30, PSX:ALLSHR), so it is dynamic and
 * there is no list to maintain.
 *
 * It complements the candle chart: ours is limited to what we have stored, theirs shows full
 * history immediately.
 */
export function TradingViewChart({ symbol, height = 420 }: { symbol: string; height?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !symbol) return;
    el.innerHTML = '';
    const target = document.createElement('div');
    target.className = 'tradingview-widget-container__widget';
    target.style.height = `${height}px`;
    target.style.width = '100%';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: `PSX:${symbol.toUpperCase()}`,
      interval: 'D',
      timezone: 'Asia/Karachi',
      theme: 'dark',
      style: '1',
      locale: 'en',
      autosize: true,
      allow_symbol_change: false,
      hide_side_toolbar: false,
      support_host: 'https://www.tradingview.com',
    });
    el.appendChild(target);
    el.appendChild(script);
    return () => {
      el.innerHTML = '';
    };
  }, [symbol, height]);

  return (
    <Box
      ref={ref}
      sx={{ width: '100%', height, '& iframe': { width: '100%', height: `${height}px`, border: 0 } }}
    />
  );
}
