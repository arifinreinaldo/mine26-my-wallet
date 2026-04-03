# CLAUDE.md

## Project Overview

**mine26-my-wallet** is a multi-currency shared wallet/spending tracker. Serverless backend on Cloudflare Workers with Neon PostgreSQL. OTP-based authentication (no passwords), role-based shared wallets, exchange rate management, income/expense tracking, budgeting via categories, recurring transactions, and multi-currency reporting with CSV export.

## Repository Structure

```
mine26-my-wallet/
├── api/                    # Cloudflare Worker backend
│   ├── src/
│   │   ├── index.js        # Entry point (fetch + scheduled handlers)
│   │   ├── router.js       # Custom path-matching router with JWT middleware
│   │   ├── helpers/
│   │   │   └── jwt.js      # JWT signing/verification (HMAC-SHA256, Web Crypto API)
│   │   └── handlers/       # Route handler modules
│   │       ├── auth.js     # Register, login, OTP verification
│   │       ├── users.js    # Profile, user search
│   │       ├── rates.js    # Exchange rates: fetch, recommend, apply, manual
│   │       ├── wallets.js  # Wallet CRUD, member management, balance tracking
│   │       ├── transactions.js  # Transaction CRUD (income/expense)
│   │       ├── categories.js    # Custom categories with icons/colors
│   │       ├── recurring.js     # Recurring transactions (auto-posting via cron)
│   │       ├── reports.js  # Spending reports with income/expense & cash flow
│   │       └── export.js   # CSV export
│   ├── wrangler.toml       # Cloudflare Worker config
│   ├── package.json        # API dependencies
│   ├── API-DOCS.md         # Full API documentation
│   └── postman_collection.json  # Postman testing collection
├── db/                     # Database migrations
│   ├── migrations/         # 14 ordered SQL migration files (001-014)
│   ├── migrate.sh          # Bash migration runner (tracks via schema_migrations table)
│   └── .env.example        # DATABASE_URL template
├── .github/workflows/      # CI/CD
│   ├── db-migrate.yml      # Runs migrations on db/** changes to main
│   └── worker-deploy.yml   # Deploys worker on api/** changes to main
├── package.json            # Root workspace scripts
└── PLAN-neon-cloudflare-worker.md  # Architecture plan
```

## Tech Stack

- **Runtime**: Cloudflare Workers (edge, not Node.js)
- **Language**: JavaScript (ES6 modules, no TypeScript)
- **Database**: Neon serverless PostgreSQL (`@neondatabase/serverless`)
- **Build/Deploy**: Wrangler v4.61.1
- **Auth**: OTP via ntfy.sh push notifications, JWT bearer tokens (7-day expiry)
- **CI/CD**: GitHub Actions (separate workflows for DB and API)

## Development Commands

```bash
# From root
npm run api:dev        # Start local dev server (wrangler dev)
npm run api:deploy     # Deploy to Cloudflare Workers
npm run db:migrate     # Run pending database migrations

# From api/
npm run dev            # wrangler dev
npm run deploy         # wrangler deploy
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing/verifying JWTs |
| `CLOUDFLARE_API_TOKEN` | Wrangler deployment (CI/CD) |

These are configured as Cloudflare Worker secrets (not .env files) and GitHub Actions secrets.

## Code Conventions

- **No linter/formatter configured** - no ESLint, Prettier, or TypeScript
- **No test framework** - API testing via Postman collection only
- **Naming**: camelCase for JS variables/functions, snake_case for DB columns
- **Response format**: All API responses use `{ success: boolean, ... }` pattern
- **DB queries**: Parameterized tagged template literals via neon driver (SQL injection safe)
- **Error handling**: Handlers return `{ status, body }` objects; centralized in `index.js`. CSV export returns `{ csv, filename }` handled specially.
- **Modules**: ES6 `import/export` throughout

## Architecture Patterns

- **Custom router** (`router.js`): Path matching with `:param` placeholders, JWT middleware for protected routes
- **Public routes**: `/api/auth/*` (register, login, OTP verification, username check)
- **Protected routes**: Everything else requires `Authorization: Bearer <jwt>`
- **Role-based access**: Wallet members have owner/editor/viewer roles enforced in handlers. User identity always comes from JWT, never from request body/params
- **Wallet authorization**: All wallet-scoped endpoints verify membership via `checkWalletAccess()`. Owners can manage members and edit/delete wallets; editors can add transactions and members; viewers are read-only
- **Transaction types**: Each transaction has a `type` field (`income` or `expense`) used for balance calculation and cash flow reports
- **Wallet balance**: `startingBalance` + sum of income - sum of expenses = `currentBalance` (computed on read)
- **Custom categories**: Global seeded categories (8) + per-wallet custom categories with icon/color
- **Recurring transactions**: Cron job processes due recurring entries, creating actual transactions and advancing `next_due_date`
- **OTP brute-force protection**: Max 5 attempts per OTP code before lockout
- **Scheduled trigger**: Daily 08:00 UTC cron fetches exchange rates and processes recurring transactions
- **Two-stage rate workflow**: Fetch recommendations, then manually apply/approve
- **CORS**: Open (`*`) for all origins

## Database

- **14 migrations** in `db/migrations/` (001-014), applied via `migrate.sh`
- **Core tables**: users, wallets, wallet_users (M2M with roles), transactions (income/expense), currencies (6 supported: SGD/USD/EUR/MYR/GBP/JPY), categories (8 seeded + custom), exchange_rates, exchange_rate_recommendations, otp_codes, recurring_transactions
- **Conventions**: Use `TIMESTAMPTZ`, cascading deletes on foreign keys, indices on frequently queried columns
- **New migrations**: Create file `db/migrations/NNN_description.sql` following existing numbering

## CI/CD

- Pushing to `main` with changes in `db/**` triggers migration workflow
- Pushing to `main` with changes in `api/**` triggers Cloudflare deployment
- Both workflows use Node.js 20

## Key Files to Know

| File | Purpose |
|---|---|
| `api/src/index.js` | Request routing entry point, CORS, error handling, CSV response |
| `api/src/router.js` | Route definitions and JWT middleware |
| `api/src/helpers/jwt.js` | JWT create/verify using Web Crypto API |
| `api/src/handlers/wallets.js` | Wallet CRUD + `checkWalletAccess()` shared helper |
| `api/src/handlers/recurring.js` | Recurring transactions + `processRecurringTransactions()` for cron |
| `api/API-DOCS.md` | Complete API reference with examples |
| `PLAN-neon-cloudflare-worker.md` | Architecture decisions and schema design |
