CREATE TABLE IF NOT EXISTS wallet_users (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'editor',
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_wallet_user UNIQUE (wallet_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_users_user ON wallet_users(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_users_wallet ON wallet_users(wallet_id);
