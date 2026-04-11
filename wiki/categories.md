# Categories

## Overview
Transaction categories with two types: global seeded categories (shared across all wallets) and custom per-wallet categories with icon/color support.

## Rules

1. **Global categories** — 8 seeded categories with `wallet_id = NULL`. Cannot be edited or deleted. Returned in all `GET /api/categories` calls regardless of wallet.
2. **Custom categories** — Have `wallet_id` set. Scoped to a specific wallet. Require editor+ role to create/edit/delete.
3. **Parent categories** — Categories can have `parent_id` for subcategory hierarchy. No depth limit enforced in code.
4. **Icon and color** — Optional fields on custom categories. Used by clients for display.
5. **Category lookup** — When listing categories for a wallet, returns BOTH global categories (wallet_id IS NULL) AND custom categories for that wallet.

## Edge Cases

1. **Import auto-creation** — During CSV import, if a category name doesn't match any existing category, a new custom category is auto-created for that wallet.
2. **Import aliases** — Case-insensitive mapping applied only during import:
   - `'food & drink'` → `'Food & Dining'`
   - `'utilities'` → `'Bills & Utilities'`
3. **Duplicate in single import** — If the same unknown category name appears in multiple import rows, it's only created once (checked after first creation).
4. **Deleting a category** — Transactions referencing it keep the `category_id` (no cascade delete on transactions). The category just won't appear in category lists.

## Common Mistakes
- Querying only custom categories and forgetting global ones (WHERE wallet_id = :walletId misses globals). Must use `WHERE wallet_id = :walletId OR wallet_id IS NULL`.
- Case-sensitive category name matching during import — aliases are case-insensitive but direct DB lookup may not be.

## Related Pages
- [Transactions](transactions.md) — transactions reference categories
- [Reports & Export](reports-and-export.md) — import uses category aliases
