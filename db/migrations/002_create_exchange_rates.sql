CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    from_currency_id INTEGER NOT NULL REFERENCES currencies(id),
    to_currency_id INTEGER NOT NULL REFERENCES currencies(id),
    rate NUMERIC(15, 6) NOT NULL,
    effective_date DATE NOT NULL,
    source VARCHAR(50),
    is_manual BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_rate UNIQUE (from_currency_id, to_currency_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
ON exchange_rates(from_currency_id, to_currency_id, effective_date DESC);
