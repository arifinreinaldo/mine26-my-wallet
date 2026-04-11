# Exchange Rates

## Overview
Two-stage exchange rate workflow: rates are fetched as recommendations, then manually applied/approved. Supports bidirectional currency pair lookups.

## Rules

1. **Two-stage workflow**:
   - Stage 1: `POST /api/rates/fetch` → fetches from exchangerate-api.com → saves to `exchange_rate_recommendations` table
   - Stage 2: `POST /api/rates/apply` → moves a recommendation to `exchange_rates` table (the active rates)
2. **Fetch deduplication** — If rates were already fetched today, the fetch endpoint skips the API call and returns existing recommendations.
3. **Base currencies** — Rates fetched for SGD, IDR, PHP base currencies. Only target currencies matching the `TARGET_CURRENCIES` list are stored.
4. **Apply uses upsert** — `ON CONFLICT (from_currency_id, to_currency_id, effective_date) DO UPDATE`. Applying the same recommendation twice overwrites (no error).
5. **Manual rates** — `POST /api/rates/manual` inserts directly into `exchange_rates`, bypassing the recommendation workflow.
6. **Current rate lookup** — Uses `ORDER BY effective_date DESC LIMIT 1` for a given currency pair. Returns the most recent rate regardless of how old it is.
7. **Bidirectional pairs** — If SGD→USD rate is stored as `4.0`, then USD→SGD is `1/4.0 = 0.25`. When looking up a rate, the system checks both directions and inverts if needed.
8. **Rate storage** — `NUMERIC(20, 10)` for precision. One rate per `(from_currency_id, to_currency_id, effective_date)` tuple (unique constraint).

## Edge Cases

1. No rate exists for a pair → `handleGetCurrentRate` returns `null` rate. Callers (balance calc, reports) treat unconverted amounts as-is or show `convertedAmount: null`.
2. Rate fetched, then same pair applied manually on same day → upsert overwrites the fetched rate with the manual one.
3. exchangerate-api.com rate limit → fetch fails silently (returns error to user, doesn't crash).
4. Recommendation already applied (`is_applied = TRUE`) → can be re-applied (overwrites same-day rate again).

## Common Mistakes
- Forgetting bidirectional lookup — if you only check SGD→USD but the stored rate is USD→SGD, you'll get null instead of the inverse.
- Using stale rates for historical accuracy — current rate lookup always returns the latest, not the rate on the transaction date. Reports use per-date rates via LATERAL join.

## Related Pages
- [Wallets](wallets.md) — balance conversion uses latest rates
- [Reports & Export](reports-and-export.md) — reports use per-date rates for accuracy
- [Architecture](architecture.md) — cron fetches rates daily at 08:00 UTC
