# Wiki Index

> **Start here:** Read [MAP.md](MAP.md) first for instant project orientation.

## Architecture & Infrastructure
- [Architecture](architecture.md) — System architecture: Cloudflare Workers, Neon PostgreSQL, edge runtime constraints
- [Database Schema](database-schema.md) — Tables, constraints, indices, and migration patterns
- [API Patterns](api-patterns.md) — Handler signature, response format, router mechanics, CORS

## Authentication & Authorization
- [Authentication](authentication.md) — OTP-based auth flow, JWT tokens, brute-force protection

## Core Domain
- [Wallets](wallets.md) — Wallet CRUD, shared wallet roles, access control via checkWalletAccess()
- [Transactions](transactions.md) — Income/expense types, soft deletes, balance calculation formula
- [Categories](categories.md) — Global seeded vs custom per-wallet, aliases during import
- [Exchange Rates](exchange-rates.md) — Two-stage rate workflow, bidirectional pairs, rate lookup
- [Recurring Transactions](recurring-transactions.md) — Frequency calculation, cron processing, deactivation logic

## Features
- [Sync](sync.md) — Offline sync protocol: push/pull, conflict resolution, idempotency
- [Reports & Export](reports-and-export.md) — Spending reports, dashboard aggregation, CSV export/import

## Reference
- [Common Bug Patterns](common-bug-patterns.md) — Known pitfalls with examples and prevention guidance
- [MAP](MAP.md) — Memory palace: rapid orientation for AI agents
- [Schema](SCHEMA.md) — Wiki conventions and maintenance rules
