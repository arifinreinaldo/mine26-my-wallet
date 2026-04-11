# Common Bug Patterns

## Overview
Recurring mistakes that cause bugs in this codebase. Every developer (human or AI) should review this before making changes.

---

### 1. Missing Wallet Access Check

**Problem:** A new wallet-scoped endpoint doesn't call `checkWalletAccess()` before processing.

**Impact:** Authorization bypass — any authenticated user can access/modify any wallet's data.

**Prevention:** Every handler that takes `walletId` from URL params MUST call:
```javascript
const access = await checkWalletAccess(sql, params.walletId || params.id, user.userId);
if (!access.exists) return { status: 404, body: { success: false, message: 'Wallet not found' } };
if (!access.role) return { status: 403, body: { success: false, message: 'Access denied' } };
```
Then check `access.role` against required permission level.

---

### 2. User Identity from Request Body

**Problem:** Using `body.userId` or `params.userId` instead of `user.userId` (from JWT) for authorization decisions.

**Impact:** Any user can impersonate another user by sending a different userId in the request body.

**Prevention:** The `user` parameter (last arg in handler signature) contains the JWT-verified identity. ALWAYS use `user.userId` for:
- `created_by_user_id` on new records
- Ownership/permission checks
- Filtering "my" data

---

### 3. Missing Currency Validation

**Problem:** Assuming a currency code is valid without resolving it to `currency_id` first.

**Impact:** SQL error or null `currency_id` in inserted rows.

**Prevention:** Always resolve currency code to ID:
```javascript
const [currency] = await sql`SELECT id FROM currencies WHERE code = ${currencyCode}`;
if (!currency) return { status: 400, body: { success: false, message: 'Invalid currency' } };
```

---

### 4. Forgotten Soft Delete Filter

**Problem:** A query on `transactions` table missing `WHERE deleted_at IS NULL`.

**Impact:** "Deleted" transactions appear in lists, reports, or balance calculations.

**Prevention:** Every `SELECT` from `transactions` must include `AND deleted_at IS NULL` UNLESS it's specifically the sync pull endpoint (which intentionally includes deleted records).

---

### 5. Exchange Rate Bidirectionality

**Problem:** Only checking one direction (SGD→USD) when the stored rate might be the inverse (USD→SGD).

**Impact:** Returns null rate when a valid rate exists, causing unconverted amounts.

**Prevention:** Check both directions:
```javascript
// Check direct
let rate = await sql`SELECT rate FROM exchange_rates 
  WHERE from_currency_id = ${fromId} AND to_currency_id = ${toId} 
  ORDER BY effective_date DESC LIMIT 1`;
if (!rate.length) {
  // Check inverse
  rate = await sql`SELECT rate FROM exchange_rates 
    WHERE from_currency_id = ${toId} AND to_currency_id = ${fromId} 
    ORDER BY effective_date DESC LIMIT 1`;
  if (rate.length) rate[0].rate = 1 / rate[0].rate;
}
```

---

### 6. Pagination Off-by-One

**Problem:** Fetching `limit + 1` to detect `hasMore` but returning all fetched rows without slicing.

**Impact:** Client receives one extra row. `hasMore` flag is correct but data is wrong.

**Prevention:**
```javascript
const rows = await sql`SELECT ... LIMIT ${limit + 1}`;
const hasMore = rows.length > limit;
const results = hasMore ? rows.slice(0, limit) : rows;
```

---

### 7. Treating Recurring Deactivation as Deletion

**Problem:** Assuming a deactivated recurring transaction no longer exists in the DB.

**Impact:** Re-creating a "new" recurring with same params when the old one could be reactivated. Or errors when querying by ID.

**Prevention:** `is_active = FALSE` means paused, not gone. Check `is_active` status, don't check for existence.

---

### 8. OTP Attempt Counter Off-by-One

**Problem:** Misunderstanding when lockout triggers. The check is `attempts >= 5` BEFORE incrementing.

**Impact:** Allowing 6 attempts instead of 5, or locking out after 4 instead of 5.

**Prevention:** The flow is: check `attempts >= 5` → if yes, return 429. If no, increment attempts, then validate code. So the 6th submission is the one that gets locked out. The 5th submission still gets validated.

---

### 9. UTC Timezone Assumptions

**Problem:** Using local dates when the system operates in UTC.

**Impact:** Dashboard shows wrong "today" transactions. Week/month boundaries are off.

**Prevention:** All `CURRENT_DATE` and `date_trunc()` calls use UTC. Clients must convert local dates to UTC before sending. The server has no timezone configuration.

---

### 10. CSV Escaping

**Problem:** Not escaping strings that contain commas, quotes, or newlines in CSV export.

**Impact:** Broken CSV files that don't parse correctly in Excel/Google Sheets.

**Prevention:** For every string field in CSV output:
```javascript
function escapeCsv(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
```

---

### 11. Handler Response Format

**Problem:** Returning wrong response shape from a handler.

**Impact:** `index.js` can't process the response correctly, resulting in 500 errors or malformed responses.

**Prevention:** Standard handlers return `{ status, body }`. CSV export returns `{ csv, filename }`. Never mix these formats. Check `index.js` for how responses are dispatched.
