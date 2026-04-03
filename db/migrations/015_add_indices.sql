-- Wallet balance: GROUP BY (wallet_id, currency_id)
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_currency
ON transactions(wallet_id, currency_id);

-- Date-range queries within a wallet
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_date
ON transactions(wallet_id, date DESC);

-- Inverse exchange rate lookups
CREATE INDEX IF NOT EXISTS idx_exchange_rates_reverse_lookup
ON exchange_rates(to_currency_id, from_currency_id, effective_date DESC);
