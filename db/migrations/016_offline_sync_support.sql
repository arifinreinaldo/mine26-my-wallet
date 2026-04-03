-- Add offline sync support to transactions

-- Client-generated UUID for idempotent sync
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_id UUID UNIQUE;

-- Change tracking for pull sync
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Soft delete for sync propagation
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE transactions SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE transactions SET client_id = gen_random_uuid() WHERE client_id IS NULL;

-- Enforce NOT NULL going forward
ALTER TABLE transactions ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN client_id SET DEFAULT gen_random_uuid();

-- Indices for sync queries
CREATE INDEX IF NOT EXISTS idx_transactions_updated_at ON transactions(wallet_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_not_deleted ON transactions(wallet_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions(client_id);
