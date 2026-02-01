CREATE TABLE IF NOT EXISTS exchange_rate_recommendations (
    id SERIAL PRIMARY KEY,
    from_currency_id INTEGER NOT NULL REFERENCES currencies(id),
    to_currency_id INTEGER NOT NULL REFERENCES currencies(id),
    recommended_rate NUMERIC(15, 6) NOT NULL,
    source VARCHAR(50) NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_applied BOOLEAN DEFAULT FALSE,
    applied_at TIMESTAMPTZ,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_rate_recommendations_currencies
ON exchange_rate_recommendations(from_currency_id, to_currency_id, fetched_at DESC);
