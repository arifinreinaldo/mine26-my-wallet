# Wallets

## Overview
Wallets group transactions and can be shared between users. Each wallet member has a role (owner/editor/viewer) that controls what they can do.

## Rules

1. **Wallet creation** — Creator is automatically added as `owner` in `wallet_users`. No separate "add member" step needed.
2. **`checkWalletAccess(sql, walletId, userId)`** — Shared helper used by ALL wallet-scoped endpoints. Returns `{ exists: boolean, role: 'owner'|'editor'|'viewer'|null }`.
   - `exists: false` → wallet doesn't exist → return 404
   - `role: null` → wallet exists but user is not a member → return 403
3. **Role permissions**:
   | Action | owner | editor | viewer |
   |--------|-------|--------|--------|
   | View transactions/reports | Yes | Yes | Yes |
   | Add/edit/delete transactions | Yes | Yes | No |
   | Add members | Yes | Yes (cannot add owners) | No |
   | Remove members | Yes | No | No |
   | Edit wallet details | Yes | No | No |
   | Delete wallet | Yes | No | No |
4. **Cannot remove last owner** — If removing a member would leave 0 owners, return 400. Checked by counting owners before removal.
5. **Only owners assign owner role** — Editors can add members as editor/viewer but cannot promote to owner.
6. **Balance calculation** — `starting_balance + SUM(income amounts) - SUM(expense amounts)` per currency. Computed on read, not stored.
7. **Multi-currency balance** — When wallet has transactions in multiple currencies, each currency balance is computed separately, then converted to the wallet's `default_currency_id` using the latest exchange rate.
8. **Default currency** — Set at wallet creation via `default_currency_id`. Used as the target currency for balance display and reports.

## Edge Cases

1. No exchange rate available for a currency pair → amount kept in original currency (no conversion applied). The converted amount shows as `null`.
2. Wallet with no transactions → balance equals `starting_balance` (or 0 if not set).
3. Removing yourself from a wallet is allowed (even as owner, if other owners exist).
4. A user can belong to many wallets. `GET /api/wallets` returns all wallets the JWT user is a member of.

## Common Mistakes
- Forgetting to call `checkWalletAccess()` on a new wallet-scoped endpoint. See [Common Bug Patterns #1](common-bug-patterns.md).
- Checking role against wrong permission level (e.g., allowing viewer to create transactions).

## Related Pages
- [Transactions](transactions.md) — wallet-scoped transaction CRUD
- [Authentication](authentication.md) — JWT provides user identity for access checks
- [Exchange Rates](exchange-rates.md) — used for multi-currency balance conversion
