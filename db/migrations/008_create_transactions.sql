CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id),
    date DATE NOT NULL,
    description VARCHAR(255),
    amount NUMERIC(15, 2) NOT NULL,
    currency_id INTEGER NOT NULL REFERENCES currencies(id),
    category_id INTEGER REFERENCES categories(id),
    payment_method VARCHAR(50),
    notes TEXT,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions(currency_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_by ON transactions(created_by_user_id);
