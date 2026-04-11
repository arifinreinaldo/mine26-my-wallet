# Database Schema

## Overview
16 ordered SQL migrations in `db/migrations/`. PostgreSQL on Neon (serverless). All timestamps use `TIMESTAMPTZ`. Snake_case column names.

## Rules

1. **Migration runner** — `db/migrate.sh` tracks applied migrations in `schema_migrations` table. Migrations are applied in filename order and never re-run.
2. **New migrations** — Create `db/migrations/NNN_description.sql` following existing numbering (next is 018).
3. **All timestamps** — Use `TIMESTAMPTZ`, not `TIMESTAMP`. Neon stores in UTC.
4. **Foreign keys** — Use `ON DELETE CASCADE` for child records (e.g., `wallet_users` → `wallets`). Transactions do NOT cascade (to support soft deletes).
5. **Indices** — Created on frequently queried columns. Key indices:
   - `idx_transactions_not_deleted` — partial index `WHERE deleted_at IS NULL`
   - `idx_transactions_updated_at` — for sync pull queries
   - `idx_transactions_client_id` — unique, for sync idempotency
   - `idx_recurring_next_due` — for cron efficiency

## Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | User accounts | id, name, email, username, verified |
| `otp_codes` | OTP verification | username, code, purpose, expires_at, used, attempts |
| `wallets` | Spending groups | id, name, default_currency_id, starting_balance, created_by_user_id |
| `wallet_users` | M2M with roles | wallet_id, user_id, role (owner/editor/viewer) |
| `transactions` | Income/expense records | wallet_id, date, amount, type, currency_id, category_id, created_by_user_id, client_id, deleted_at |
| `currencies` | Supported currencies | id, code, name (SGD, USD, EUR, MYR, GBP, JPY, IDR) |
| `categories` | Global + custom | id, name, wallet_id (NULL = global), parent_id, icon, color |
| `exchange_rates` | Active rates | from_currency_id, to_currency_id, rate, effective_date |
| `exchange_rate_recommendations` | Pending rates | same as above + is_applied |
| `recurring_transactions` | Recurring templates | wallet_id, frequency, next_due_date, end_date, is_active |

## Unique Constraints

- `transactions(client_id)` — sync idempotency
- `wallet_users(wallet_id, user_id)` — one role per user per wallet
- `exchange_rates(from_currency_id, to_currency_id, effective_date)` — one rate per pair per day
- `users(email)` — unique email
- `users(username)` — unique username

## Edge Cases

1. Neon suspends compute after inactivity → first query after suspension has ~200ms latency.
2. `NUMERIC(15, 2)` for amounts — supports up to 999,999,999,999.99.
3. `NUMERIC(20, 10)` for exchange rates — supports high-precision rates (e.g., JPY pairs).

## Related Pages
- [Architecture](architecture.md) — deployment and connection patterns
- [Transactions](transactions.md) — soft delete columns
- [Sync](sync.md) — client_id and updated_at columns
