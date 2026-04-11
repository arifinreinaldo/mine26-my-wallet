# Architecture

## Overview
mine26-my-wallet is a serverless multi-currency shared wallet API running on Cloudflare Workers with Neon PostgreSQL. No frontend — API-only backend consumed by mobile/web clients.

## Rules

1. **Edge runtime only** — Cloudflare Workers use V8 isolates, not Node.js. No `fs`, `path`, `crypto` (Node), or npm packages that depend on them. Use Web Crypto API for cryptography.
2. **HTTP-based DB connections** — Neon's `@neondatabase/serverless` driver uses HTTP, not TCP sockets. Connection is created per-request via `neon(env.DATABASE_URL)` and uses tagged template literals for parameterized queries.
3. **No connection pooling in app** — Neon handles connection pooling server-side. Each Worker invocation creates a fresh `sql` client.
4. **Environment via `env` parameter** — Cloudflare Workers don't have `process.env`. All secrets (`DATABASE_URL`, `JWT_SECRET`, `EXCHANGE_RATE_API_KEY`) come from the `env` object passed to the fetch handler.
5. **Two entry points** — `fetch` handler for HTTP requests, `scheduled` handler for cron (daily 08:00 UTC).
6. **Independent deployments** — `db/` (migrations via GitHub Actions) and `api/` (Wrangler deploy) deploy separately. A migration does NOT trigger a worker redeploy.
7. **CORS open** — `Access-Control-Allow-Origin: *` on all responses. No origin restriction.
8. **ES modules only** — All code uses `import/export`, no CommonJS.

## Edge Cases

1. Cold starts are minimal on Workers but the first DB query per request has Neon wake-up latency (~100-200ms if the compute endpoint was suspended).
2. Worker execution limit is 30 seconds (paid plan) or 10ms CPU time (free). Long-running queries can timeout.
3. `Date` in Workers uses UTC. There is no timezone configuration.

## Related Pages
- [API Patterns](api-patterns.md) — how requests are routed and handled
- [Database Schema](database-schema.md) — table structure
