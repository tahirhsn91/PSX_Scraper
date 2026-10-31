-- The percentage the exchange publishes with a corporate action: of face value for a cash dividend
-- or a right issue, of shares held for a bonus. Kept beside `amount` because the two are different
-- facts — the register states a percentage, and a rupee amount exists only when the dividend row it
-- describes is already stored. Dating a dividend from the register needs the percentage, and no
-- face value is stored on `stocks` to convert one into the other.
ALTER TABLE "corporate_actions" ADD COLUMN "percent" DECIMAL(8, 4);
