# Recurring Transactions

## Overview
Template-based recurring transactions that automatically create actual transactions via a daily cron job. Supports daily, weekly, biweekly, monthly, and yearly frequencies.

## Rules

1. **Template, not auto-repeat** — A recurring transaction is a template. The cron job reads templates and creates real transactions in the `transactions` table.
2. **Frequencies** — `daily`, `weekly`, `biweekly`, `monthly`, `yearly`.
3. **`next_due_date`** — Set to `start_date` on creation. Advanced after each processing cycle using `calculateNextDueDate()`.
4. **Cron processing** (daily 08:00 UTC):
   - Find all active recurring where `next_due_date <= CURRENT_DATE` AND `(end_date IS NULL OR next_due_date <= end_date)`
   - Create actual transaction with `date = next_due_date`
   - Calculate and set new `next_due_date`
   - If new `next_due_date > end_date`, set `is_active = FALSE`
5. **Deactivation, not deletion** — Reaching `end_date` sets `is_active = FALSE`. The recurring record stays in the DB. It can be manually reactivated.
6. **Type inheritance** — Created transactions inherit `type` (income/expense) from the recurring template.
7. **Batch processing** — All due recurring transactions are processed in a single iteration, with individual transaction inserts and a batch update of `next_due_date` values.

## Edge Cases

1. **Month-end clamping** — `monthNthDay` handles short months: Jan 31 → Feb 28 (or 29 in leap year). Implemented in `calculateNextDueDate()`.
2. **Feb 29 in non-leap years** — Clamps to Feb 28.
3. **Missed days** — If cron was down for 3 days, on restart it processes all overdue recurring transactions (each one creates a transaction dated to its `next_due_date`, not today).
4. **End date reached mid-cycle** — `is_active` set to FALSE after the last valid transaction is created. No partial processing.
5. **Deleting a recurring transaction** — Soft deactivation (`is_active = FALSE`). Previously created transactions are NOT affected.

## Common Mistakes
- Creating a recurring transaction with `start_date` in the past → will immediately be processed on next cron run, creating backdated transactions.
- Assuming deactivated recurring records are deleted — they remain in DB with `is_active = FALSE`.

## Related Pages
- [Transactions](transactions.md) — recurring creates actual transactions
- [Architecture](architecture.md) — cron schedule and processing order
