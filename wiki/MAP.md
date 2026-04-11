# MAP — Memory Palace

> Read this first. 30-second orientation for AI agents.

## What Is This?

Multi-currency shared wallet API. Users create wallets, invite members, track income/expenses, convert currencies. No frontend — API only.

## The Stack

```
Client → Cloudflare Worker (V8 edge) → Neon PostgreSQL (serverless)
          ├─ fetch handler (HTTP)      └─ @neondatabase/serverless (HTTP, not TCP)
          └─ scheduled handler (cron 08:00 UTC daily)
```

- **No Node.js** — Edge runtime. No `fs`, `path`, `crypto` (Node). Use Web Crypto API.
- **No `process.env`** — Secrets come from `env` parameter: `DATABASE_URL`, `JWT_SECRET`, `EXCHANGE_RATE_API_KEY`
- **ES modules only** — `import/export`, no CommonJS.

## The Data Model

```
users ←→ wallet_users (role: owner|editor|viewer) ←→ wallets
                                                        │
                                                   transactions
                                                   (type: income|expense)
                                                   (soft delete: deleted_at)
                                                        │
                                              ┌─────────┼──────────┐
                                          categories  currencies  exchange_rates
```

**7 currencies**: SGD, USD, EUR, MYR, GBP, JPY, IDR
**Balance formula**: `starting_balance + Σ(income) - Σ(expense)` per currency, converted via latest rate

## The Auth Flow

```
Register → OTP via ntfy.sh → Verify → JWT (7 days)
Login    → OTP via ntfy.sh → Verify → JWT (7 days)
```

- OTP: 6 digits, 5 min expiry, max 5 attempts, 60s resend cooldown
- JWT payload: `{ userId, username, iat, exp }`
- **Identity = `user.userId` from JWT. NEVER from request body.**

## The Handler Pattern

```javascript
async function handleX(sql, params, url, body, env, user) {
  // 1. checkWalletAccess(sql, walletId, user.userId) — ALWAYS for wallet-scoped
  // 2. Validate input, resolve currencyCode → currency_id
  // 3. Query with `WHERE deleted_at IS NULL` (transactions)
  // 4. Return { status: 200, body: { success: true, ... } }
}
```

## The 5 Things That Cause Bugs

| # | Bug | Prevention |
|---|-----|-----------|
| 1 | Missing `checkWalletAccess()` | Every wallet-scoped handler MUST call it first |
| 2 | `body.userId` instead of `user.userId` | Identity ONLY from JWT, never request body |
| 3 | Missing `WHERE deleted_at IS NULL` | Every transaction SELECT except sync pull |
| 4 | One-direction rate lookup | Check both SGD→USD AND USD→SGD (invert) |
| 5 | Pagination `limit+1` not sliced | Fetch `limit+1`, set `hasMore`, return `rows.slice(0, limit)` |

## The Cron (daily 08:00 UTC)

1. Fetch exchange rates → save as recommendations
2. Process recurring transactions → create actual transactions
3. Hard-delete soft-deleted records > 90 days

## Key File Map

```
api/src/
├── index.js          ← Entry point: CORS, error handling, CSV response detection
├── router.js         ← Route matching, JWT middleware, handler dispatch
├── helpers/jwt.js    ← signJwt/verifyJwt (Web Crypto API, HMAC-SHA256)
└── handlers/
    ├── auth.js       ← Register, login, OTP verify (PUBLIC routes)
    ├── users.js      ← User profile, search
    ├── wallets.js    ← CRUD + checkWalletAccess() (shared helper)
    ├── transactions.js ← Income/expense CRUD, soft delete
    ├── rates.js      ← Two-stage: fetch→recommend→apply
    ├── categories.js ← Global (8 seeded) + per-wallet custom
    ├── recurring.js  ← Templates + calculateNextDueDate()
    ├── reports.js    ← 5 parallel queries, per-date rate conversion
    ├── export.js     ← CSV export/import, { csv, filename } response
    ├── sync.js       ← Push/pull, client_id idempotency, LWW conflicts
    └── dashboard.js  ← 4 parallel queries, UTC time windows
```

## Role Permissions Quick Ref

| Action | owner | editor | viewer |
|--------|-------|--------|--------|
| View data | ✓ | ✓ | ✓ |
| Add/edit/delete transactions | ✓ | ✓ | ✗ |
| Add members (not as owner) | ✓ | ✓ | ✗ |
| Remove members / delete wallet | ✓ | ✗ | ✗ |

## Deep Dive

→ [index.md](index.md) for full wiki pages by topic
→ [common-bug-patterns.md](common-bug-patterns.md) for prevention code snippets
→ [api-patterns.md](api-patterns.md) for new endpoint checklist
