# Spending Tracker API - Neon + Cloudflare Workers Plan

## Implementation Progress

| Step | Status | Details |
|---|---|---|
| Database migrations (`db/migrations/001-009`) | Done | 9 SQL files created |
| Migration runner (`db/migrate.sh`) | Done | Bash script with schema_migrations tracking |
| `db/.env.example` | Done | Template for DATABASE_URL |
| Cloudflare Worker entry (`api/src/index.js`) | Done | fetch + scheduled handlers |
| Router (`api/src/router.js`) | Done | Path matching with :param support |
| Rates handler (`api/src/handlers/rates.js`) | Done | 5 functions: fetch, recommendations, apply, manual, current |
| Wallets handler (`api/src/handlers/wallets.js`) | Done | 5 functions: create, list, members, add member, remove member |
| Transactions handler (`api/src/handlers/transactions.js`) | Done | Add + list with wallet scope and created_by tracking |
| Reports handler (`api/src/handlers/reports.js`) | Done | Spending report with currency conversion + user/category/monthly aggregation |
| `api/wrangler.toml` | Done | Worker config + cron trigger |
| `api/package.json` | Done | Dependencies defined |
| Root `package.json` | Done | Workspace convenience scripts |
| CI/CD: `db-migrate.yml` | Done | GitHub Actions, triggers on `db/**` changes |
| CI/CD: `worker-deploy.yml` | Done | GitHub Actions, triggers on `api/**` changes |
| Frontend integration | Pending | React components for wallet + rate management |

---

## Architecture Overview

- **Database**: Neon (serverless Postgres) using `@neondatabase/serverless` driver
- **Backend**: Cloudflare Workers (edge runtime, HTTP-based connections)
- **Frontend**: React/Next.js (existing app)
- **Key Constraints**: No stored procedures; all logic in application layer; edge-compatible code only

### Core Concepts

- **Users** — People who use the system. Each user has a name/email.
- **Wallets** — A wallet groups transactions together. A wallet can have **multiple users** (shared wallet). Each user-wallet link has a **role** (owner, editor, viewer).
- **Transactions** — Every transaction belongs to a wallet and records **which user created it** (`created_by_user_id`).

---

## Project Structure

```
mine26-my-wallet/
├── db/                              # Neon database (independent deploy)
│   ├── migrations/
│   │   ├── 001_create_currencies.sql
│   │   ├── 002_create_exchange_rates.sql
│   │   ├── 003_create_recommendations.sql
│   │   ├── 004_create_categories.sql
│   │   ├── 005_create_users.sql
│   │   ├── 006_create_wallets.sql
│   │   ├── 007_create_wallet_users.sql
│   │   ├── 008_create_transactions.sql
│   │   └── 009_seed_data.sql
│   ├── migrate.sh                   # Migration runner script
│   ├── .env.example                 # DATABASE_URL template
│   └── README.md
│
├── api/                             # Cloudflare Worker (independent deploy)
│   ├── src/
│   │   ├── index.js                 # Worker entry point (fetch + scheduled)
│   │   ├── router.js                # Route matching logic
│   │   └── handlers/
│   │       ├── rates.js             # Rate fetch, recommendations, apply, manual
│   │       ├── wallets.js           # Create wallet, manage members, list wallets
│   │       ├── transactions.js      # Add transaction (wallet-scoped, with created_by)
│   │       └── reports.js           # Spending report (wallet-scoped)
│   ├── wrangler.toml
│   ├── package.json
│   └── README.md
│
├── src/                             # Frontend (existing Next.js app)
│   └── ...
├── package.json                     # Root package.json (workspace scripts)
└── PLAN-neon-cloudflare-worker.md
```

Each folder (`db/` and `api/`) is self-contained with its own dependencies, config, and deploy command. They can be deployed independently via CI/CD or manually.

---

## Phase 1: Database — `db/`

### Database Schema

#### Entity Relationship

```
users 1──M wallet_users M──1 wallets
                                │
                           transactions
                           (wallet_id, created_by_user_id)
```

- A **user** can belong to many **wallets** (via `wallet_users`)
- A **wallet** can have many **users** (via `wallet_users`)
- Each **transaction** belongs to one **wallet** and tracks **who created it**

#### Tables

| Table | Purpose |
|---|---|
| `currencies` | Supported currencies (SGD, USD, EUR, MYR, GBP, JPY) |
| `exchange_rates` | Historical exchange rates (manual + applied recommendations) |
| `exchange_rate_recommendations` | Auto-fetched rate suggestions pending user approval |
| `categories` | Spending categories |
| `users` | User accounts (name, email) |
| `wallets` | Wallets that group transactions |
| `wallet_users` | Many-to-many: which users belong to which wallets + their role |
| `transactions` | Spending records scoped to a wallet, with `created_by_user_id` |

#### Schema SQL

```sql
-- 005_create_users.sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 006_create_wallets.sql
CREATE TABLE wallets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    default_currency_id INTEGER REFERENCES currencies(id),
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 007_create_wallet_users.sql
CREATE TABLE wallet_users (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'editor',
        -- 'owner'  = full control (delete wallet, manage members)
        -- 'editor' = can add/edit transactions
        -- 'viewer' = read-only access
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_wallet_user UNIQUE (wallet_id, user_id)
);

CREATE INDEX idx_wallet_users_user ON wallet_users(user_id);
CREATE INDEX idx_wallet_users_wallet ON wallet_users(wallet_id);

-- 008_create_transactions.sql (updated)
CREATE TABLE transactions (
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

CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_transactions_date ON transactions(date DESC);
CREATE INDEX idx_transactions_currency ON transactions(currency_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_created_by ON transactions(created_by_user_id);
```

### Migration Files

| File | Content |
|---|---|
| `001_create_currencies.sql` | `currencies` table |
| `002_create_exchange_rates.sql` | `exchange_rates` table + index |
| `003_create_recommendations.sql` | `exchange_rate_recommendations` table + index |
| `004_create_categories.sql` | `categories` table |
| `005_create_users.sql` | `users` table |
| `006_create_wallets.sql` | `wallets` table |
| `007_create_wallet_users.sql` | `wallet_users` join table + indexes |
| `008_create_transactions.sql` | `transactions` table (with `wallet_id` + `created_by_user_id`) + indexes |
| `009_seed_data.sql` | Insert currencies, categories, sample users |

### Migration Runner — `db/migrate.sh`

A simple bash script that:
1. Reads `DATABASE_URL` from env (or `.env` file)
2. Runs each `.sql` file in order via `psql`
3. Tracks applied migrations in a `schema_migrations` table to avoid re-running

```bash
# Usage
cd db
export DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/spending_tracker?sslmode=require"
./migrate.sh
```

### CI/CD (GitHub Actions example)

```yaml
# .github/workflows/db-migrate.yml
name: DB Migrate
on:
  push:
    paths:
      - 'db/**'
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run migrations
        env:
          DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}
        run: |
          cd db
          chmod +x migrate.sh
          ./migrate.sh
```

Triggers **only** when files inside `db/` change.

---

## Phase 2: Cloudflare Worker API — `api/`

### Files

| File | Purpose |
|---|---|
| `src/index.js` | Worker entry: CORS, error handling, delegates to router. Also exports `scheduled()` for cron. |
| `src/router.js` | Maps URL path + method to handler functions |
| `src/handlers/rates.js` | `handleFetchRates`, `handleGetRecommendations`, `handleApplyRate`, `handleManualRate`, `handleGetCurrentRate` |
| `src/handlers/wallets.js` | `handleCreateWallet`, `handleGetWallets`, `handleAddWalletMember`, `handleRemoveWalletMember`, `handleGetWalletMembers` |
| `src/handlers/transactions.js` | `handleAddTransaction` (wallet-scoped, records created_by), `handleGetTransactions` |
| `src/handlers/reports.js` | `handleGetSpendingReport` (wallet-scoped) |
| `wrangler.toml` | Worker name, compatibility date, cron triggers |
| `package.json` | `@neondatabase/serverless`, `wrangler` |

### API Endpoints

#### Exchange Rates

| Method | Path | Handler | Description |
|---|---|---|---|
| `POST` | `/api/rates/fetch` | `handleFetchRates` | Fetch rates from exchangerate-api.com, save as recommendations |
| `GET` | `/api/rates/recommendations` | `handleGetRecommendations` | List pending recommendations with diff vs current rate |
| `GET` | `/api/rates/current?from=X&to=Y` | `handleGetCurrentRate` | Current rate + latest recommendation for a pair |
| `POST` | `/api/rates/manual` | `handleManualRate` | Add a manual exchange rate |
| `POST` | `/api/rates/apply` | `handleApplyRate` | Apply a recommendation as the active rate |

#### Wallets

| Method | Path | Handler | Description |
|---|---|---|---|
| `POST` | `/api/wallets` | `handleCreateWallet` | Create a wallet (creator becomes owner) |
| `GET` | `/api/wallets?userId=X` | `handleGetWallets` | List wallets a user belongs to |
| `GET` | `/api/wallets/:id/members` | `handleGetWalletMembers` | List all members of a wallet with roles |
| `POST` | `/api/wallets/:id/members` | `handleAddWalletMember` | Add a user to a wallet with a role |
| `DELETE` | `/api/wallets/:id/members/:userId` | `handleRemoveWalletMember` | Remove a user from a wallet |

#### Transactions (wallet-scoped)

| Method | Path | Handler | Description |
|---|---|---|---|
| `POST` | `/api/wallets/:id/transactions` | `handleAddTransaction` | Add transaction to wallet (records `created_by_user_id`) |
| `GET` | `/api/wallets/:id/transactions` | `handleGetTransactions` | List transactions for a wallet (shows who created each) |

#### Reports (wallet-scoped)

| Method | Path | Handler | Description |
|---|---|---|---|
| `GET` | `/api/wallets/:id/reports/spending?currency=X&from=DATE&to=DATE` | `handleGetSpendingReport` | Spending report for a wallet, converted to target currency |

### Example Request/Response

**Add transaction:**
```json
POST /api/wallets/1/transactions
{
  "date": "2025-02-01",
  "description": "Team lunch",
  "amount": 45.00,
  "currencyCode": "SGD",
  "categoryId": 1,
  "paymentMethod": "Credit Card",
  "userId": 2
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": 42,
  "createdBy": {
    "id": 2,
    "name": "Jane"
  }
}
```

**Get transactions (shows who created each):**
```json
GET /api/wallets/1/transactions

{
  "success": true,
  "transactions": [
    {
      "id": 42,
      "date": "2025-02-01",
      "description": "Team lunch",
      "amount": 45.00,
      "currency": "SGD",
      "category": "Food & Dining",
      "paymentMethod": "Credit Card",
      "createdBy": { "id": 2, "name": "Jane" },
      "createdAt": "2025-02-01T08:30:00Z"
    }
  ]
}
```

### Access Control Logic

Enforced in handler code (not DB-level):

| Action | Required Role |
|---|---|
| View transactions | owner, editor, viewer |
| Add/edit transactions | owner, editor |
| Manage members | owner |
| Delete wallet | owner |

### Cross-Cutting Concerns

- CORS headers on all responses (`Access-Control-Allow-Origin: *`)
- OPTIONS preflight handling
- Global try/catch with JSON error responses
- Neon connection initialized per request via `neon(env.DATABASE_URL)`
- User identification via `userId` in request body/query (no auth layer yet — can add later)

### Scheduled Handler

- Cron: `0 8 * * *` (daily at 8 AM UTC)
- `scheduled()` export reuses `handleFetchRates` logic

### Deploy

```bash
cd api
npm install
wrangler secret put DATABASE_URL   # paste Neon connection string
wrangler deploy
```

### CI/CD (GitHub Actions example)

```yaml
# .github/workflows/worker-deploy.yml
name: Deploy Worker
on:
  push:
    paths:
      - 'api/**'
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install & Deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          cd api
          npm ci
          npx wrangler deploy
```

Triggers **only** when files inside `api/` change.

---

## Phase 3: Root Workspace Scripts

Optional convenience scripts in the root `package.json`:

```json
{
  "scripts": {
    "db:migrate": "cd db && ./migrate.sh",
    "api:dev": "cd api && npm run dev",
    "api:deploy": "cd api && npm run deploy"
  }
}
```

---

## Phase 4: Frontend Integration

- React component `RateManager` connecting to the Worker API
- React component `WalletManager` for wallet CRUD + member management
- Transaction forms scoped to a selected wallet
- Transaction list shows "created by" user name for each entry
- Features:
  - Fetch and display rate recommendations
  - Apply recommended rates with one click
  - Add manual exchange rates
  - View current vs recommended rate with percent change
  - Create/switch wallets
  - Invite users to a wallet
  - See who added each transaction
- `API_BASE` configured via environment variable pointing to the deployed Worker URL

---

## Summary: Deployment Matrix

| Component | Folder | Trigger | Command | Secrets Needed |
|---|---|---|---|---|
| Database | `db/` | Changes to `db/**` | `./migrate.sh` | `NEON_DATABASE_URL` |
| API Worker | `api/` | Changes to `api/**` | `wrangler deploy` | `CLOUDFLARE_API_TOKEN`, `DATABASE_URL` (wrangler secret) |
| Frontend | `src/` | Changes to `src/**` | Existing deploy pipeline | `NEXT_PUBLIC_API_URL` |

Each component deploys independently. A database migration does not redeploy the worker, and a worker change does not re-run migrations.

---

## Dependencies

| Package | Location | Version | Purpose |
|---|---|---|---|
| `@neondatabase/serverless` | `api/` | ^0.9.0 | Neon HTTP driver for edge runtime |
| `wrangler` | `api/` | ^3.0.0 | Cloudflare Workers CLI (dev dependency) |

---

## External Services

| Service | Usage |
|---|---|
| [exchangerate-api.com](https://api.exchangerate-api.com/v4/latest/USD) | Free exchange rate data source |
| Neon | Serverless Postgres database |
| Cloudflare Workers | Edge compute runtime + cron triggers |
