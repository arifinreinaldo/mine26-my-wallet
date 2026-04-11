# Reports & Export

## Overview
Wallet-scoped spending reports with multi-currency conversion, dashboard aggregations, and CSV export/import functionality.

## Rules

### Reports
1. **5 parallel queries** — Income/expense totals, category totals (expenses only), monthly cash flow, user totals, paginated transaction list.
2. **Currency conversion in reports** — Summary aggregations use latest rates (fast). Transaction list uses per-date rates via LATERAL join (accurate).
3. **Target currency** — Query param `currency` or defaults to wallet's `default_currency_id`. All amounts converted to this currency.
4. **Missing rate** → `convertedAmount: null` for individual transactions, but original amount still counted in summaries.

### Dashboard
5. **Time windows** — All use UTC:
   - Today: `date = CURRENT_DATE`
   - This week: `date >= date_trunc('week', CURRENT_DATE)::date` (week starts Monday in PostgreSQL)
   - This month: `date >= date_trunc('month', CURRENT_DATE)::date`
6. **4 parallel queries** — Today/week/month spending, income/net for month, top 5 categories, 10 recent transactions.
7. **Rounding** — All converted amounts rounded to 2 decimal places.

### CSV Export
8. **Max 10,000 rows** per export.
9. **Columns**: Date, Type, Description, Amount, Currency, Category, Payment Method, Notes, Created By.
10. **CSV escaping** — Strings with commas, quotes, or newlines must be wrapped in double quotes. Quotes within strings are doubled (`""` escaping).
11. **Filename** — `{walletName}_transactions.csv` with sanitized wallet name.
12. **Special response format** — Returns `{ csv, filename }` instead of `{ status, body }`. Handled specially in `index.js`.

### CSV Import
13. **Max 1,000 transactions** per batch.
14. **Category auto-creation** — Unknown category names create custom categories for the wallet. Aliases applied first (case-insensitive).
15. **Date parsing** — Strips time portion. Accepts ISO timestamp or date string.
16. **Amount** — Always absolute value (negative signs stripped).
17. **Type** — Defaults to `'expense'` if missing.
18. **Non-fatal errors** — Errors per row (wrong format, etc.) are collected in `errors` array. Import continues for valid rows.
19. **Response** — `{ imported, skipped, total, categoriesCreated, errors }`.

## Edge Cases

1. Export with no transactions → returns CSV with headers only.
2. Import duplicate category names in single file → only creates category once.
3. Dashboard with no transactions for time window → returns 0 for all amounts (not null).
4. Report date range spanning multiple rate changes → per-date rates give accurate historical view.

## Common Mistakes
- Using latest rates for historical transaction display (inaccurate). Use per-date rates.
- Forgetting CSV escaping for strings containing commas → broken CSV output.
- Not handling the special `{ csv, filename }` response format in `index.js` when adding new export endpoints.

## Related Pages
- [Exchange Rates](exchange-rates.md) — conversion logic for reports
- [Transactions](transactions.md) — data source for reports
- [Categories](categories.md) — import auto-creates categories with aliases
