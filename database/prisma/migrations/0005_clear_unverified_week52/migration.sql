-- Clear 52-week ranges that contradict the price on their own row.
--
-- These rows were written before every write path went through verification: a price below the
-- 52-week low (or above the high) is internally inconsistent, so one of the two numbers is wrong.
-- The range is the derived block and the price the primary reading, so the range is dropped: the
-- column becomes NULL and the dashboard shows a dash instead of a figure that contradicts its own
-- row. The next verified sync repopulates it from the source.
--
-- Bounded to the newest priced row per stock — older history stays as scraped — and tolerant to 1%,
-- so a session that genuinely set a new low or high is not touched.

WITH newest AS (
  SELECT DISTINCT ON (p.stock_id)
    p.id,
    p.current_price,
    p.week52_low,
    p.week52_high
  FROM stock_prices p
  WHERE p.current_price IS NOT NULL
  ORDER BY p.stock_id, p.last_trade_date DESC
)
UPDATE stock_prices sp
SET week52_low = NULL,
    week52_high = NULL
FROM newest n
WHERE sp.id = n.id
  AND n.week52_low IS NOT NULL
  AND n.week52_high IS NOT NULL
  AND (n.current_price < n.week52_low * 0.99 OR n.current_price > n.week52_high * 1.01);
