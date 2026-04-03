# Spending Tracker API Documentation

**Base URL:** `https://spending-tracker-api.arifin-reinaldo.workers.dev`

All responses return JSON with a `success` field. Errors include an `error` or `message` field.
All protected endpoints require `Authorization: Bearer <jwt>` header.

---

## Authentication

### Check Username Availability

```
GET /api/auth/check-username?username={USERNAME}
```

### Register

```
POST /api/auth/register
```

**Body:** `{ "name": "...", "email": "...", "username": "..." }`

### Verify Registration

```
POST /api/auth/verify-registration
```

**Body:** `{ "username": "...", "otp": "123456" }`

**Returns:** `{ "success": true, "token": "jwt..." }`

### Login

```
POST /api/auth/login
```

**Body:** `{ "username": "..." }`

### Verify Login

```
POST /api/auth/verify-login
```

**Body:** `{ "username": "...", "otp": "123456" }`

**Returns:** `{ "success": true, "token": "jwt..." }`

> OTP codes expire in 5 minutes. Max 5 failed attempts before lockout (429).

---

## Exchange Rates

### Fetch Latest Rates

```
POST /api/rates/fetch
```

Fetches rates from exchangerate-api.com and saves as pending recommendations.

### Get Pending Recommendations

```
GET /api/rates/recommendations
```

### Get Current Rate

```
GET /api/rates/current?from=USD&to=SGD
```

### Apply a Recommendation

```
POST /api/rates/apply
```

**Body:** `{ "recommendationId": 1, "notes": "optional" }`

### Add Manual Rate

```
POST /api/rates/manual
```

**Body:** `{ "fromCurrency": "USD", "toCurrency": "SGD", "rate": 1.335, "notes": "optional" }`

---

## Wallets

### Create Wallet

```
POST /api/wallets
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Wallet name |
| `description` | string | No | Description |
| `defaultCurrencyCode` | string | No | Default currency (e.g. `SGD`) |
| `startingBalance` | number | No | Initial balance (default: 0) |

Creator is automatically added as `owner` (from JWT).

### List Wallets

```
GET /api/wallets
```

Returns all wallets the authenticated user belongs to, including `startingBalance` and computed `currentBalance`.

### Edit Wallet

```
PUT /api/wallets/{walletId}
```

Owner only. Body fields (all optional): `name`, `description`, `defaultCurrencyCode`, `startingBalance`.

### Delete Wallet

```
DELETE /api/wallets/{walletId}
```

Owner only. Cascading delete removes all transactions, members, and recurring transactions.

### Get Wallet Members

```
GET /api/wallets/{walletId}/members
```

Requires wallet membership.

### Add Wallet Member

```
POST /api/wallets/{walletId}/members
```

**Body:** `{ "userId": 2, "role": "editor" }`

Requires owner or editor role. Only owners can assign `owner` role.

### Remove Wallet Member

```
DELETE /api/wallets/{walletId}/members/{userId}
```

Owner only. Cannot remove the last owner.

---

## Transactions

All transaction endpoints require wallet membership. User identity comes from JWT.

### Add Transaction

```
POST /api/wallets/{walletId}/transactions
```

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | string | Yes | `YYYY-MM-DD` |
| `description` | string | No | Description |
| `amount` | number | Yes | Positive number |
| `type` | string | No | `expense` (default) or `income` |
| `currencyCode` | string | Yes | e.g. `SGD`, `USD` |
| `categoryId` | integer | No | Category ID |
| `paymentMethod` | string | No | e.g. `Credit Card`, `Cash` |
| `notes` | string | No | Additional notes |

Requires owner or editor role.

### Edit Transaction

```
PUT /api/wallets/{walletId}/transactions/{transactionId}
```

All fields optional (partial update). Only the transaction creator or wallet owner can edit.

### Delete Transaction

```
DELETE /api/wallets/{walletId}/transactions/{transactionId}
```

Only the transaction creator or wallet owner can delete.

### List Transactions

```
GET /api/wallets/{walletId}/transactions
```

**Query Parameters (all optional):**

| Param | Type | Description |
|---|---|---|
| `from` | string | Start date (`YYYY-MM-DD`) |
| `to` | string | End date (`YYYY-MM-DD`) |
| `createdBy` | integer | Filter by creator user ID |
| `categoryId` | integer | Filter by category |
| `type` | string | Filter by `income` or `expense` |

---

## Categories

### List Categories

```
GET /api/categories?walletId={WALLET_ID}
```

Returns global (seeded) categories + custom ones for the specified wallet. Without `walletId`, returns only global categories.

### Create Custom Category

```
POST /api/categories
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Category name |
| `icon` | string | No | Icon identifier |
| `color` | string | No | Hex color (e.g. `#FF5733`) |
| `walletId` | integer | No | Wallet to scope this category to |
| `parentId` | integer | No | Parent category ID for subcategories |

### Edit Custom Category

```
PUT /api/categories/{categoryId}
```

Cannot edit default/seeded categories. Body: `name`, `icon`, `color` (all optional).

### Delete Custom Category

```
DELETE /api/categories/{categoryId}
```

Cannot delete default/seeded categories.

---

## Recurring Transactions

Recurring transactions auto-create actual transactions daily via cron.

### Create Recurring Transaction

```
POST /api/wallets/{walletId}/recurring
```

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | string | No | Description |
| `amount` | number | Yes | Positive number |
| `type` | string | No | `expense` (default) or `income` |
| `currencyCode` | string | Yes | Currency code |
| `categoryId` | integer | No | Category ID |
| `paymentMethod` | string | No | Payment method |
| `notes` | string | No | Notes |
| `frequency` | string | Yes | `daily`, `weekly`, `biweekly`, `monthly`, `yearly` |
| `startDate` | string | Yes | Start date (`YYYY-MM-DD`) |
| `endDate` | string | No | End date (omit for indefinite) |

Requires owner or editor role.

### List Recurring Transactions

```
GET /api/wallets/{walletId}/recurring
```

### Deactivate Recurring Transaction

```
DELETE /api/wallets/{walletId}/recurring/{recurringId}
```

Only the creator or wallet owner can deactivate.

---

## Reports

### Spending Report

```
GET /api/wallets/{walletId}/reports/spending
```

| Param | Type | Default | Description |
|---|---|---|---|
| `currency` | string | `SGD` | Target currency for conversion |
| `from` | string | — | Start date |
| `to` | string | — | End date |

**Summary includes:**
- `totalIncome` / `totalExpense` / `netCashFlow`
- `startingBalance` / `currentBalance`
- `monthlyCashFlow` — per-month income & expense breakdown
- `monthlyTotals` — per-month net amounts
- `categoryTotals` — expense totals by category
- `userTotals` — totals by user

---

## Export

### Export Transactions as CSV

```
GET /api/wallets/{walletId}/export/csv
```

| Param | Type | Description |
|---|---|---|
| `from` | string | Start date (optional) |
| `to` | string | End date (optional) |

Returns a downloadable CSV file with columns: Date, Type, Description, Amount, Currency, Category, Payment Method, Notes, Created By.

---

## Supported Currencies

| Code | Name | Symbol |
|---|---|---|
| SGD | Singapore Dollar | S$ |
| USD | US Dollar | $ |
| EUR | Euro | € |
| MYR | Malaysian Ringgit | RM |
| GBP | British Pound | £ |
| JPY | Japanese Yen | ¥ |

---

## Default Categories

| ID | Name |
|---|---|
| 1 | Food & Dining |
| 2 | Transport |
| 3 | Shopping |
| 4 | Entertainment |
| 5 | Bills & Utilities |
| 6 | Healthcare |
| 7 | Travel |
| 8 | Others |

Custom categories can be added per wallet via `POST /api/categories`.

---

## Wallet Roles

| Role | View | Add Transactions | Add Members | Remove Members | Edit/Delete Wallet |
|---|---|---|---|---|---|
| `owner` | Yes | Yes | Yes | Yes | Yes |
| `editor` | Yes | Yes | Yes | No | No |
| `viewer` | Yes | No | No | No | No |

---

## Error Responses

```json
{
  "success": false,
  "message": "Description of what went wrong"
}
```

| Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid parameters |
| `401` | Unauthorized — missing or invalid JWT |
| `403` | Forbidden — insufficient permissions |
| `404` | Not found — resource doesn't exist |
| `409` | Conflict — duplicate entry |
| `429` | Too many requests — OTP attempt limit |
| `500` | Server error |

---

## Cron Schedule

Daily at **08:00 UTC** via Cloudflare Cron Trigger:
1. Fetches exchange rates from exchangerate-api.com (saved as recommendations)
2. Processes due recurring transactions (creates actual transactions)
