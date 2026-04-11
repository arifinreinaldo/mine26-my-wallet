# Transactions

## Overview
Transactions are income or expense records scoped to a wallet. They support soft deletes for sync compatibility and contribute to wallet balance calculations.

## Rules

1. **Type field** — Every transaction has `type`: `'income'` or `'expense'`. Defaults to `'expense'` if not provided in request body.
2. **Balance formula** — `starting_balance + SUM(income) - SUM(expense)` per currency. This is computed on read from `wallets.js`, not stored as a column.
3. **Soft deletes** — Deleting a transaction sets `deleted_at = NOW()` instead of removing the row. Hard deletion happens via scheduled cron after 90 days.
4. **All queries filter soft deletes** — Every SELECT on transactions MUST include `WHERE deleted_at IS NULL` (except sync pull which intentionally includes deleted records).
5. **created_by_user_id** — Always set from JWT `user.userId`, never from request body. Tracks who created each transaction.
6. **Wallet-scoped** — All transaction endpoints require `walletId` in URL path. `checkWalletAccess()` is called before any operation.
7. **Currency resolution** — Request sends `currencyCode` (e.g., `'SGD'`). Handler resolves to `currency_id` via DB lookup. Returns 400 if code is invalid.
8. **Amount storage** — `NUMERIC(15, 2)`. Always positive. The `type` field determines whether it's income or expense (not the sign of the amount).
9. **Pagination** — `GET` endpoints use `page` and `limit` query params. Fetch `limit + 1` rows to detect `hasMore`, then slice result to `limit` before returning.
10. **Date field** — `DATE` type (no time component). Stored as-is. Used for daily aggregations in reports.

## Edge Cases

1. Negative amount in request → stripped to absolute value (import.js) or rejected (transactions.js varies by endpoint — check handler).
2. Transaction with invalid `categoryId` → foreign key constraint fails → 500 error. Pre-validate if needed.
3. Updating a soft-deleted transaction → silently fails (sync) or returns 404 (normal endpoint). Not an error in sync context.
4. `hasMore` pagination: if you fetch `limit + 1` and get exactly `limit + 1` results, `hasMore = true`. Forgetting to slice → client sees an extra row. See [Common Bug Patterns #6](common-bug-patterns.md).

## Common Mistakes
- Forgetting `WHERE deleted_at IS NULL` in a new query. See [Common Bug Patterns #4](common-bug-patterns.md).
- Using amount sign to determine income/expense instead of the `type` field.
- Setting `created_by_user_id` from request body instead of JWT.

## Related Pages
- [Wallets](wallets.md) — transactions belong to wallets, balance calculated from transactions
- [Sync](sync.md) — soft deletes enable offline sync
- [Categories](categories.md) — transactions reference categories
- [Exchange Rates](exchange-rates.md) — cross-currency transaction conversion
