# CLAUDE.md

## Project Overview

**mine26-my-wallet** is a multi-currency shared wallet/spending tracker. Serverless backend on Cloudflare Workers with Neon PostgreSQL. OTP-based authentication (no passwords), role-based shared wallets, exchange rate management, and multi-currency reporting.

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
│   │       ├── wallets.js  # Wallet CRUD, member management
│   │       ├── transactions.js  # Add/list transactions
│   │       └── reports.js  # Spending reports with currency conversion
│   ├── wrangler.toml       # Cloudflare Worker config
│   ├── package.json        # API dependencies
│   ├── API-DOCS.md         # Full API documentation
│   └── postman_collection.json  # Postman testing collection
├── db/                     # Database migrations
│   ├── migrations/         # 12 ordered SQL migration files (001-012)
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
- **Error handling**: Handlers return `{ status, body }` objects; centralized in `index.js`
- **Modules**: ES6 `import/export` throughout

## Architecture Patterns

- **Custom router** (`router.js`): Path matching with `:param` placeholders, JWT middleware for protected routes
- **Public routes**: `/api/auth/*` (register, login, OTP verification, username check)
- **Protected routes**: Everything else requires `Authorization: Bearer <jwt>`
- **Role-based access**: Wallet members have owner/editor/viewer roles enforced in handlers. User identity always comes from JWT, never from request body/params
- **Wallet authorization**: All wallet-scoped endpoints verify membership via `checkWalletAccess()`. Owners can manage members; editors can add members; viewers are read-only
- **OTP brute-force protection**: Max 5 attempts per OTP code before lockout
- **Scheduled trigger**: Daily 08:00 UTC cron fetches exchange rates from exchangerate-api.com
- **Two-stage rate workflow**: Fetch recommendations, then manually apply/approve
- **CORS**: Open (`*`) for all origins

## Database

- **13 migrations** in `db/migrations/` (001-013), applied via `migrate.sh`
- **Core tables**: users, wallets, wallet_users (M2M with roles), transactions, currencies (6 supported: SGD/USD/EUR/MYR/GBP/JPY), categories (8 seeded), exchange_rates, exchange_rate_recommendations, otp_codes
- **Conventions**: Use `TIMESTAMPTZ`, cascading deletes on foreign keys, indices on frequently queried columns
- **New migrations**: Create file `db/migrations/NNN_description.sql` following existing numbering

## CI/CD

- Pushing to `main` with changes in `db/**` triggers migration workflow
- Pushing to `main` with changes in `api/**` triggers Cloudflare deployment
- Both workflows use Node.js 20

## Key Files to Know

| File | Purpose |
|---|---|
| `api/src/index.js` | Request routing entry point, CORS, error handling |
| `api/src/router.js` | Route definitions and JWT middleware |
| `api/src/helpers/jwt.js` | JWT create/verify using Web Crypto API |
| `api/API-DOCS.md` | Complete API reference with examples |
| `PLAN-neon-cloudflare-worker.md` | Architecture decisions and schema design |
