-- Add transaction type (income/expense) to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type VARCHAR(10) NOT NULL DEFAULT 'expense';

-- Add starting_balance to wallets
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS starting_balance NUMERIC(15, 2) NOT NULL DEFAULT 0;

-- Add custom category support: icon, color, wallet_id (NULL = global/seeded), created_by_user_id
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon VARCHAR(50);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color VARCHAR(7);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS wallet_id INTEGER REFERENCES wallets(id) ON DELETE CASCADE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);

-- Create recurring_transactions table
CREATE TABLE IF NOT EXISTS recurring_transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    description VARCHAR(255),
    amount NUMERIC(15, 2) NOT NULL,
    type VARCHAR(10) NOT NULL DEFAULT 'expense',
    currency_id INTEGER NOT NULL REFERENCES currencies(id),
    category_id INTEGER REFERENCES categories(id),
    payment_method VARCHAR(50),
    notes TEXT,
    frequency VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    next_due_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recurring_wallet ON recurring_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_recurring_next_due ON recurring_transactions(next_due_date) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_categories_wallet ON categories(wallet_id);
