-- Performance indices for 10+ years of data
-- Covering index for balance computation (wallet list, dashboard)
-- Allows index-only scan for SUM(amount) GROUP BY wallet_id, currency_id, type
CREATE INDEX IF NOT EXISTS idx_transactions_balance
  ON transactions (wallet_id, currency_id, type)
  INCLUDE (amount)
  WHERE deleted_at IS NULL;

-- Composite index for date-range + type filtered queries (reports, transaction list)
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_date_type
  ON transactions (wallet_id, date DESC, type)
  WHERE deleted_at IS NULL;

-- Unique constraint on category name per wallet to prevent import duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_wallet
  ON categories (LOWER(name), wallet_id)
  WHERE wallet_id IS NOT NULL;
