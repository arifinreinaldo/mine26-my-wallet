# Spending Tracker API Documentation

**Base URL:** `https://spending-tracker-api.arifin-reinaldo.workers.dev`

**Content-Type:** `application/json` for all POST/PUT requests

**Auth:** All endpoints except `/api/auth/*` require `Authorization: Bearer <jwt>` header

**Response format:** All responses are JSON with `{ success: boolean, ... }`. Errors include `message` field.

---

## Authentication

OTP-based, passwordless. Client must subscribe to ntfy.sh topic `my-wallet-{username}` to receive OTP codes.

### Check Username Availability

```
GET /api/auth/check-username?username={username}
```

**Success (200):**
```json
{ "success": true, "available": true }
```

**Error — missing param (400):**
```json
{ "success": false, "message": "username query parameter is required" }
```

---

### Register

```
POST /api/auth/register
```

**Request:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "username": "johndoe"
}
```

**Success (200):**
```json
{ "success": true, "message": "OTP sent to ntfy topic" }
```

**Error — duplicate email (400):**
```json
{ "success": false, "message": "Email already registered" }
```

**Error — missing fields (400):**
```json
{ "success": false, "message": "name, email, and username are required" }
```

---

### Verify Registration

```
POST /api/auth/verify-registration
```

**Request:**
```json
{ "username": "johndoe", "otp": "123456" }
```

**Success (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "username": "johndoe", "name": "John Doe" }
}
```

**Error — wrong code (400):**
```json
{ "success": false, "message": "Invalid OTP" }
```

**Error — expired (400):**
```json
{ "success": false, "message": "OTP has expired" }
```

**Error — too many attempts (429):**
```json
{ "success": false, "message": "Too many failed OTP attempts. Request a new code." }
```

---

### Login

```
POST /api/auth/login
```

**Request:**
```json
{ "username": "johndoe" }
```

**Success (200):**
```json
{ "success": true, "message": "OTP sent" }
```

**Error — user not found (400):**
```json
{ "success": false, "message": "User not found" }
```

**Error — not verified (400):**
```json
{ "success": false, "message": "Account not verified. Please register first." }
```

---

### Verify Login

```
POST /api/auth/verify-login
```

**Request:**
```json
{ "username": "johndoe", "otp": "123456" }
```

**Success (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "username": "johndoe", "name": "John Doe" }
}
```

**Errors:** Same as verify-registration (wrong code, expired, too many attempts).

---

### Resend OTP

```
POST /api/auth/resend-otp
```

**Request:**
```json
{ "username": "johndoe", "purpose": "login" }
```

`purpose`: `"login"` or `"register"`

**Success (200):**
```json
{ "success": true, "message": "New OTP sent" }
```

**Error — cooldown (429):**
```json
{ "success": false, "message": "Please wait before requesting a new OTP" }
```

> OTP codes expire in 5 minutes. Max 5 failed attempts before lockout (429). 60-second cooldown between resends.

---

## Users

### Get My Profile

```
GET /api/users/me
```

**Success (200):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "username": "johndoe",
    "createdAt": "2026-04-05T12:57:05.648Z",
    "wallets": [
      {
        "id": 1,
        "name": "Personal Wallet",
        "description": "My daily expenses",
        "role": "owner",
        "joinedAt": "2026-04-05T12:58:41.674Z"
      }
    ]
  }
}
```

**Error — invalid token (401):**
```json
{ "success": false, "message": "Invalid or expired token" }
```

---

### Search User

```
GET /api/users/search?username={username}
```

**Success (200):**
```json
{
  "success": true,
  "user": { "id": 2, "name": "Jane Doe", "username": "janedoe" }
}
```

**Error — not found (400):**
```json
{ "success": false, "message": "User not found" }
```

---

## Wallets

### Create Wallet

```
POST /api/wallets
```

**Request:**
```json
{
  "name": "Personal Wallet",
  "description": "My daily expenses",
  "defaultCurrencyCode": "SGD",
  "startingBalance": 0
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Wallet name |
| `description` | string | No | Description |
| `defaultCurrencyCode` | string | No | Default currency (e.g. `SGD`) |
| `startingBalance` | number | No | Initial balance (default: 0) |

Creator is automatically added as `owner`.

**Success (200):**
```json
{
  "success": true,
  "wallet": { "id": 1, "name": "Personal Wallet" }
}
```

**Error — missing name (400):**
```json
{ "success": false, "message": "name is required" }
```

---

### List Wallets

```
GET /api/wallets
```

Returns all wallets the authenticated user belongs to, including computed `currentBalance`.

**Success (200):**
```json
{
  "success": true,
  "wallets": [
    {
      "id": 1,
      "name": "Personal Wallet",
      "description": "My daily expenses",
      "defaultCurrency": "SGD",
      "startingBalance": 0,
      "currentBalance": 4914.50,
      "myRole": "owner",
      "createdByName": "John Doe",
      "memberCount": 1,
      "createdAt": "2026-04-05T12:58:41.664Z"
    }
  ]
}
```

---

### Edit Wallet

```
PUT /api/wallets/{walletId}
```

**Request:** (all fields optional)
```json
{
  "name": "Updated Name",
  "description": "Updated desc",
  "defaultCurrencyCode": "USD",
  "startingBalance": 100
}
```

**Success (200):**
```json
{ "success": true, "message": "Wallet updated" }
```

**Error — not owner (403):**
```json
{ "success": false, "message": "Only owners can edit wallets" }
```

**Error — not found (404):**
```json
{ "success": false, "message": "Wallet not found" }
```

---

### Delete Wallet

```
DELETE /api/wallets/{walletId}
```

Owner only. Cascading delete removes all transactions, members, and recurring transactions.

**Success (200):**
```json
{ "success": true, "message": "Wallet deleted" }
```

**Error — not owner (403):**
```json
{ "success": false, "message": "Only owners can delete wallets" }
```

---

### Get Wallet Members

```
GET /api/wallets/{walletId}/members
```

**Success (200):**
```json
{
  "success": true,
  "walletId": 1,
  "members": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "role": "owner",
      "joinedAt": "2026-04-05T12:58:41.674Z"
    }
  ]
}
```

**Error — not a member (403):**
```json
{ "success": false, "message": "You are not a member of this wallet" }
```

---

### Add Wallet Member

```
POST /api/wallets/{walletId}/members
```

**Request:**
```json
{ "userId": 2, "role": "editor" }
```

Roles: `"owner"`, `"editor"`, `"viewer"`. Only owners can assign `owner` role.

**Success (200):**
```json
{ "success": true, "message": "Member added" }
```

**Error — already a member (400):**
```json
{ "success": false, "message": "User is already a member of this wallet" }
```

**Error — editor assigning owner (403):**
```json
{ "success": false, "message": "Only owners can assign owner role" }
```

---

### Remove Wallet Member

```
DELETE /api/wallets/{walletId}/members/{userId}
```

Owner only. Cannot remove the last owner.

**Success (200):**
```json
{ "success": true, "message": "Member removed" }
```

**Error — last owner (400):**
```json
{ "success": false, "message": "Cannot remove the last owner" }
```

---

## Transactions

All transaction endpoints require wallet membership. User identity comes from JWT.

### Add Transaction

```
POST /api/wallets/{walletId}/transactions
```

**Request:**
```json
{
  "date": "2026-04-11",
  "description": "Grocery shopping",
  "amount": 85.50,
  "currencyCode": "SGD",
  "type": "expense",
  "categoryId": 1,
  "paymentMethod": "Credit Card",
  "notes": "Weekly groceries"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | string | Yes | `YYYY-MM-DD` |
| `amount` | number | Yes | Positive number |
| `currencyCode` | string | Yes | e.g. `SGD`, `USD`, `IDR`, `PHP` |
| `description` | string | No | Description |
| `type` | string | No | `"expense"` (default) or `"income"` |
| `categoryId` | integer | No | Category ID |
| `paymentMethod` | string | No | e.g. `Credit Card`, `Cash` |
| `notes` | string | No | Additional notes |

Requires `owner` or `editor` role.

**Success (200):**
```json
{
  "success": true,
  "transactionId": 4,
  "type": "expense",
  "createdBy": { "id": 1, "name": "John Doe" },
  "createdAt": "2026-04-11T12:13:59.412Z"
}
```

**Error — missing fields (400):**
```json
{ "success": false, "message": "date, amount, and currencyCode are required" }
```

**Error — invalid currency (400):**
```json
{ "success": false, "message": "Invalid currency code" }
```

**Error — viewer (403):**
```json
{ "success": false, "message": "Viewers cannot add transactions" }
```

---

### Edit Transaction

```
PUT /api/wallets/{walletId}/transactions/{transactionId}
```

**Request:** (all fields optional — only provided fields are updated)
```json
{
  "description": "Updated description",
  "amount": 99.99,
  "type": "expense",
  "currencyCode": "SGD",
  "categoryId": 2,
  "paymentMethod": "Cash",
  "notes": "Updated note",
  "date": "2026-04-12"
}
```

Only the transaction creator or wallet owner can edit.

**Success (200):**
```json
{ "success": true, "message": "Transaction updated", "transactionId": 4 }
```

**Error — not found / deleted (404):**
```json
{ "success": false, "message": "Transaction not found or was deleted" }
```

**Error — not creator (403):**
```json
{ "success": false, "message": "You can only edit your own transactions" }
```

---

### Delete Transaction (soft delete)

```
DELETE /api/wallets/{walletId}/transactions/{transactionId}
```

Only the transaction creator or wallet owner can delete. Soft-deleted (not permanently removed). Hard-deleted after 90 days by cron.

**Success (200):**
```json
{ "success": true, "message": "Transaction deleted" }
```

**Error — not found (404):**
```json
{ "success": false, "message": "Transaction not found" }
```

**Error — not creator (403):**
```json
{ "success": false, "message": "You can only delete your own transactions" }
```

---

### List Transactions

```
GET /api/wallets/{walletId}/transactions
```

**Query Parameters (all optional):**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | Page number |
| `limit` | int | 50 | Items per page (max 200) |
| `from` | string | — | Start date (`YYYY-MM-DD`) |
| `to` | string | — | End date (`YYYY-MM-DD`) |
| `type` | string | — | `"income"` or `"expense"` |
| `categoryId` | int | — | Filter by category ID |
| `createdBy` | int | — | Filter by user ID |
| `q` | string | — | Search description/notes (case-insensitive) |

**Success (200):**
```json
{
  "success": true,
  "walletId": 1,
  "page": 1,
  "limit": 50,
  "hasMore": false,
  "transactions": [
    {
      "id": 4,
      "date": "2026-04-11T00:00:00.000Z",
      "description": "Grocery shopping",
      "amount": 85.50,
      "type": "expense",
      "currency": "SGD",
      "currencySymbol": "S$",
      "category": "Food & Dining",
      "categoryId": 1,
      "paymentMethod": "Credit Card",
      "notes": "Weekly groceries",
      "createdBy": { "id": 1, "name": "John Doe" },
      "createdAt": "2026-04-11T12:13:59.412Z"
    }
  ]
}
```

---

## Dashboard

Single-call wallet summary optimized for the home screen.

```
GET /api/wallets/{walletId}/dashboard
```

**Success (200):**
```json
{
  "success": true,
  "walletId": 1,
  "defaultCurrency": "SGD",
  "defaultCurrencySymbol": "S$",
  "today": {
    "spending": 85.50
  },
  "thisWeek": {
    "spending": 85.50
  },
  "thisMonth": {
    "spending": 85.50,
    "income": 5000.00,
    "net": 4914.50
  },
  "topCategories": [
    {
      "categoryId": 1,
      "name": "Food & Dining",
      "icon": null,
      "total": 85.50
    }
  ],
  "recentTransactions": [
    {
      "id": 4,
      "date": "2026-04-11T00:00:00.000Z",
      "description": "Grocery shopping",
      "amount": 85.50,
      "convertedAmount": 85.50,
      "type": "expense",
      "currency": "SGD",
      "currencySymbol": "S$",
      "category": "Food & Dining",
      "paymentMethod": null,
      "createdBy": { "id": 1, "name": "John Doe" },
      "createdAt": "2026-04-11T12:13:59.412Z"
    }
  ],
  "currentBalance": 4914.50
}
```

**Notes:**
- All amounts converted to wallet's default currency
- Time windows use UTC
- `topCategories`: top 5 expense categories this month
- `recentTransactions`: last 10 transactions

**Error — not a member (403):**
```json
{ "success": false, "message": "You are not a member of this wallet" }
```

---

## Categories

### List Categories

```
GET /api/categories?walletId={walletId}
```

Without `walletId`: returns only global (seeded) categories. With `walletId`: returns global + custom categories for that wallet.

**Success (200):**
```json
{
  "success": true,
  "categories": [
    { "id": 1, "name": "Food & Dining", "icon": null, "color": null, "isCustom": false, "parentId": null },
    { "id": 2, "name": "Transport", "icon": null, "color": null, "isCustom": false, "parentId": null },
    { "id": 13, "name": "My Custom", "icon": "🛒", "color": "#FF0000", "isCustom": true, "parentId": null }
  ]
}
```

---

### Create Custom Category

```
POST /api/categories
```

**Request:**
```json
{
  "name": "My Category",
  "icon": "🛒",
  "color": "#FF0000",
  "walletId": 1,
  "parentId": null
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Category name |
| `icon` | string | No | Icon/emoji |
| `color` | string | No | Hex color (e.g. `#FF5733`) |
| `walletId` | integer | No | Wallet to scope this category to |
| `parentId` | integer | No | Parent category ID for subcategories |

Requires `owner` or `editor` role (if wallet-scoped).

**Success (200):**
```json
{
  "success": true,
  "category": { "id": 13, "name": "My Category", "icon": "🛒", "color": "#FF0000" }
}
```

**Error — missing name (400):**
```json
{ "success": false, "message": "name is required" }
```

---

### Edit Custom Category

```
PUT /api/categories/{categoryId}
```

**Request:** (all optional)
```json
{ "name": "Renamed", "icon": "🏠", "color": "#00FF00" }
```

**Success (200):**
```json
{
  "success": true,
  "category": { "id": 13, "name": "Renamed", "icon": "🏠", "color": "#00FF00" }
}
```

**Error — global category (403):**
```json
{ "success": false, "message": "Cannot edit default categories" }
```

---

### Delete Custom Category

```
DELETE /api/categories/{categoryId}
```

**Success (200):**
```json
{ "success": true, "message": "Category deleted" }
```

**Error — global category (403):**
```json
{ "success": false, "message": "Cannot delete default categories" }
```

---

## Exchange Rates

Two-stage workflow: fetch recommendations → apply to activate.

### Fetch Latest Rates

```
POST /api/rates/fetch
```

**Request:** empty `{}`

Fetches rates from exchangerate-api.com. Skips if already fetched today. Cron does this daily at 08:00 UTC.

**Success (200):**
```json
{ "success": true, "message": "Rates fetched", "count": 6 }
```

**Already fetched (200):**
```json
{ "success": true, "message": "Rates already fetched today", "count": 6 }
```

---

### Get Pending Recommendations

```
GET /api/rates/recommendations
```

**Success (200):**
```json
{
  "success": true,
  "recommendations": [
    {
      "id": 37,
      "pair": "SGD/IDR",
      "recommendedRate": 13414.2446,
      "currentRate": null,
      "currentDate": null,
      "difference": 13414.2446,
      "percentChange": null,
      "source": "exchangerate-api.com",
      "fetchedAt": "2026-04-11T08:01:03.290Z"
    }
  ]
}
```

---

### Get Current Rate

```
GET /api/rates/current?from=SGD&to=USD
```

**Success — rate exists (200):**
```json
{
  "success": true,
  "pair": "SGD/USD",
  "currentRate": 0.74,
  "recommendedRate": 0.7412,
  "difference": 0.0012,
  "percentChange": 0.16
}
```

**Success — no rate (200):**
```json
{
  "success": true,
  "pair": "SGD/USD",
  "currentRate": null,
  "recommendedRate": null,
  "difference": null,
  "percentChange": null
}
```

---

### Apply a Recommendation

```
POST /api/rates/apply
```

**Request:**
```json
{ "recommendationId": 37, "notes": "optional" }
```

**Success (200):**
```json
{ "success": true, "message": "Rate applied" }
```

**Error — not found (404):**
```json
{ "success": false, "message": "Recommendation not found" }
```

---

### Add Manual Rate

```
POST /api/rates/manual
```

**Request:**
```json
{
  "fromCurrency": "SGD",
  "toCurrency": "USD",
  "rate": 0.74,
  "effectiveDate": "2026-04-11",
  "notes": "Manual rate"
}
```

**Success (200):**
```json
{ "success": true, "message": "Rate added" }
```

**Error — invalid currency (400):**
```json
{ "success": false, "message": "Invalid currency code" }
```

**Error — missing fields (400):**
```json
{ "success": false, "message": "fromCurrency, toCurrency, and rate are required" }
```

---

## Recurring Transactions

Recurring transactions auto-create actual transactions daily via cron at 08:00 UTC.

### Create Recurring Transaction

```
POST /api/wallets/{walletId}/recurring
```

**Request:**
```json
{
  "description": "Monthly rent",
  "amount": 2000,
  "currencyCode": "SGD",
  "type": "expense",
  "frequency": "monthly",
  "startDate": "2026-04-01",
  "endDate": null,
  "categoryId": 5,
  "paymentMethod": "Bank Transfer",
  "notes": "Condo rent"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | string | No | Description |
| `amount` | number | Yes | Positive number |
| `currencyCode` | string | Yes | Currency code |
| `frequency` | string | Yes | `daily`, `weekly`, `biweekly`, `monthly`, `yearly` |
| `startDate` | string | Yes | `YYYY-MM-DD` |
| `type` | string | No | `"expense"` (default) or `"income"` |
| `categoryId` | integer | No | Category ID |
| `paymentMethod` | string | No | Payment method |
| `notes` | string | No | Notes |
| `endDate` | string | No | End date (omit for indefinite) |

Requires `owner` or `editor` role.

**Success (200):**
```json
{
  "success": true,
  "recurringTransaction": {
    "id": 1,
    "nextDueDate": "2026-04-01T00:00:00.000Z",
    "createdAt": "2026-04-11T12:15:02.023Z"
  }
}
```

**Error — invalid frequency (400):**
```json
{ "success": false, "message": "frequency must be one of: daily, weekly, biweekly, monthly, yearly" }
```

---

### List Recurring Transactions

```
GET /api/wallets/{walletId}/recurring
```

**Success (200):**
```json
{
  "success": true,
  "walletId": 1,
  "recurringTransactions": [
    {
      "id": 1,
      "description": "Monthly rent",
      "amount": 2000,
      "type": "expense",
      "currency": "SGD",
      "category": "Bills & Utilities",
      "frequency": "monthly",
      "paymentMethod": null,
      "notes": null,
      "startDate": "2026-04-01T00:00:00.000Z",
      "endDate": null,
      "nextDueDate": "2026-04-01T00:00:00.000Z",
      "isActive": true,
      "createdBy": { "id": 1, "name": "John Doe" },
      "createdAt": "2026-04-11T12:15:02.023Z"
    }
  ]
}
```

---

### Deactivate Recurring Transaction

```
DELETE /api/wallets/{walletId}/recurring/{recurringId}
```

Sets `isActive = false`. Does NOT delete previously created transactions.

**Success (200):**
```json
{ "success": true, "message": "Recurring transaction deactivated" }
```

**Error — not found (404):**
```json
{ "success": false, "message": "Recurring transaction not found" }
```

---

## Reports

### Spending Report

```
GET /api/wallets/{walletId}/reports/spending
```

| Param | Type | Default | Description |
|---|---|---|---|
| `currency` | string | `"SGD"` | Target currency for conversion |
| `from` | string | — | Start date (`YYYY-MM-DD`) |
| `to` | string | — | End date (`YYYY-MM-DD`) |
| `page` | int | 1 | Page number |
| `limit` | int | 50 | Items per page (max 200) |

**Success (200):**
```json
{
  "success": true,
  "walletId": 1,
  "targetCurrency": "SGD",
  "page": 1,
  "limit": 50,
  "hasMore": false,
  "transactions": [
    {
      "id": 3,
      "date": "2026-04-11T00:00:00.000Z",
      "description": "Salary",
      "originalAmount": 5000,
      "originalCurrency": "SGD",
      "type": "income",
      "convertedAmount": 5000,
      "exchangeRate": 1,
      "category": null,
      "paymentMethod": null,
      "createdBy": { "id": 1, "name": "John Doe" }
    },
    {
      "id": 4,
      "date": "2026-04-11T00:00:00.000Z",
      "description": "Grocery shopping",
      "originalAmount": 85.50,
      "originalCurrency": "SGD",
      "type": "expense",
      "convertedAmount": 85.50,
      "exchangeRate": 1,
      "category": "Food & Dining",
      "paymentMethod": null,
      "createdBy": { "id": 1, "name": "John Doe" }
    }
  ],
  "summary": {
    "totalTransactions": 2,
    "totalIncome": 5000,
    "totalExpense": 85.50,
    "netCashFlow": 4914.50,
    "startingBalance": 0,
    "currentBalance": 4914.50,
    "monthlyTotals": { "2026-04": 4914.50 },
    "monthlyCashFlow": {
      "2026-04": { "income": 5000, "expense": 85.50 }
    },
    "categoryTotals": { "Food & Dining": 85.50 },
    "userTotals": { "John Doe": 5085.50 }
  }
}
```

**Error — invalid currency (400):**
```json
{ "success": false, "message": "Invalid target currency" }
```

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

**Success:** Returns `Content-Type: text/csv` with `Content-Disposition: attachment; filename="{walletName}_transactions.csv"`

```csv
Date,Type,Description,Amount,Currency,Category,Payment Method,Notes,Created By
Sat Apr 11 2026 00:00:00 GMT+0000 (Coordinated Universal Time),expense,Grocery shopping,85.50,SGD,Food & Dining,,,John Doe
Sat Apr 11 2026 00:00:00 GMT+0000 (Coordinated Universal Time),income,Salary,5000.00,SGD,,,,John Doe
```

Max 10,000 rows.

---

## Import

### Import Transactions

```
POST /api/wallets/{walletId}/import
```

**Request:**
```json
{
  "transactions": [
    {
      "date": "2026-04-11",
      "description": "Imported expense",
      "amount": 50.00,
      "currencyCode": "SGD",
      "type": "expense",
      "categoryName": "Food & Dining",
      "paymentMethod": "Cash",
      "notes": ""
    }
  ]
}
```

- Max 1,000 transactions per batch
- `categoryName` matched case-insensitively; unknown names auto-create custom categories
- Negative amounts converted to absolute value
- Type defaults to `"expense"` if missing

**Success (200):**
```json
{
  "success": true,
  "imported": 1,
  "skipped": 0,
  "total": 1,
  "categoriesCreated": [],
  "errors": []
}
```

**Partial success (200) — some rows fail:**
```json
{
  "success": true,
  "imported": 8,
  "skipped": 2,
  "total": 10,
  "categoriesCreated": ["New Category"],
  "errors": [
    { "row": 3, "error": "Invalid currency code: XYZ" },
    { "row": 7, "error": "date, amount, and currencyCode are required" }
  ]
}
```

---

## Offline Sync

For offline-first mobile clients. Uses client-generated UUIDs and last-write-wins conflict resolution.

### Push Sync (Upload Changes)

```
POST /api/wallets/{walletId}/sync
```

**Request:**
```json
{
  "changes": [
    {
      "clientId": "550e8400-e29b-41d4-a716-446655440000",
      "operation": "create",
      "clientUpdatedAt": "2026-04-11T12:00:00Z",
      "data": {
        "date": "2026-04-11",
        "description": "Coffee",
        "amount": 5.50,
        "currencyCode": "SGD",
        "type": "expense",
        "categoryId": 1
      }
    },
    {
      "clientId": "550e8400-e29b-41d4-a716-446655440001",
      "operation": "update",
      "clientUpdatedAt": "2026-04-11T12:01:00Z",
      "data": { "description": "Updated", "amount": 10.00 }
    },
    {
      "clientId": "550e8400-e29b-41d4-a716-446655440002",
      "operation": "delete",
      "clientUpdatedAt": "2026-04-11T12:02:00Z"
    }
  ]
}
```

**Constraints:**
- Max 500 changes per push
- `clientId`: must be valid UUID
- `operation`: `"create"`, `"update"`, or `"delete"`
- `clientUpdatedAt`: must not be >5 minutes in the future (clock drift protection)
- Last-write-wins: update only applies if `clientUpdatedAt > server.updated_at`

**Success (200):**
```json
{
  "success": true,
  "results": [
    { "clientId": "550e8400-...-440000", "status": "created", "serverId": 5 },
    { "clientId": "550e8400-...-440001", "status": "updated", "serverId": 6 },
    { "clientId": "550e8400-...-440002", "status": "deleted", "serverId": 7 }
  ],
  "errors": []
}
```

**Conflict example (200) — server has newer version:**
```json
{
  "success": true,
  "results": [
    { "clientId": "...", "status": "conflict", "error": "Server version is newer", "serverId": 6 }
  ],
  "errors": []
}
```

**Resurrect deleted (200) — cannot un-delete:**
```json
{
  "success": true,
  "results": [
    { "clientId": "...", "status": "conflict", "error": "Transaction was deleted", "serverId": 5 }
  ],
  "errors": []
}
```

**Validation error (200) — bad UUID format:**
```json
{
  "success": true,
  "results": [],
  "errors": [
    { "clientId": "bad-id", "error": "invalid input syntax for type uuid: \"bad-id\"" }
  ]
}
```

Possible status values: `"created"`, `"updated"`, `"deleted"`, `"already_deleted"`, `"conflict"`, `"error"`

Requires `owner` or `editor` role.

---

### Pull Sync (Download Changes)

```
GET /api/wallets/{walletId}/sync
```

| Param | Type | Default | Description |
|---|---|---|---|
| `since` | timestamp | — | Omit for full sync, provide for incremental |
| `limit` | int | 500 | Max results (capped at 1000) |

**Success — full sync (200):**
```json
{
  "success": true,
  "walletId": 1,
  "changes": [
    {
      "serverId": 3,
      "clientId": "fd26e4ab-8eeb-4ecf-8c2d-79f83cd500d2",
      "date": "2026-04-11T00:00:00.000Z",
      "description": "Salary",
      "amount": 5000,
      "type": "income",
      "currencyCode": "SGD",
      "categoryId": null,
      "category": null,
      "paymentMethod": null,
      "notes": null,
      "createdBy": { "id": 1, "name": "John Doe" },
      "createdAt": "2026-04-11T12:13:56.735Z",
      "updatedAt": "2026-04-11T12:13:56.735Z",
      "deletedAt": null
    },
    {
      "serverId": 2,
      "clientId": "df1ebd2a-785a-49bc-914d-858042318903",
      "date": "2026-04-11T00:00:00.000Z",
      "description": "Deleted item",
      "amount": 99.99,
      "type": "expense",
      "currencyCode": "SGD",
      "categoryId": 1,
      "category": "Food & Dining",
      "paymentMethod": null,
      "notes": null,
      "createdBy": { "id": 1, "name": "John Doe" },
      "createdAt": "2026-04-11T12:13:22.313Z",
      "updatedAt": "2026-04-11T12:13:39.411Z",
      "deletedAt": "2026-04-11T12:13:39.411Z"
    }
  ],
  "hasMore": false,
  "syncTimestamp": "2026-04-11T12:15:46.074Z"
}
```

**Notes:**
- `deletedAt` populated for soft-deleted records — client should remove from local DB
- `syncTimestamp` only returned when `hasMore: false` — store for next pull
- If `hasMore: true`, keep pulling with same `since` until `hasMore: false`
- If gap since last sync > 90 days, do a full sync (hard-deleted records may be missed)

### Sync Flow (Client Side)

1. App opens → `GET /sync?since={lastSync}` (pull server changes)
2. Merge into local database (handle `deletedAt` records)
3. Collect unsynced local changes
4. `POST /sync` with batch (push)
5. Mark successful items as synced
6. Store `syncTimestamp` for next pull

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
| IDR | Indonesian Rupiah | Rp |
| PHP | Philippine Peso | ₱ |

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
| 9 | Grocery |
| 10 | Gifts |
| 11 | Accommodation |
| 12 | Gunpla |

Custom categories can be added per wallet via `POST /api/categories`.

---

## Wallet Roles

| Role | View | Add Transactions | Add Members | Remove Members | Edit/Delete Wallet |
|---|---|---|---|---|---|
| `owner` | Yes | Yes | Yes (any role) | Yes | Yes |
| `editor` | Yes | Yes | Yes (editor/viewer only) | No | No |
| `viewer` | Yes | No | No | No | No |

---

## Common Error Responses

**Missing auth header (401):**
```json
{ "success": false, "message": "Missing or invalid Authorization header" }
```

**Invalid/expired token (401):**
```json
{ "success": false, "message": "Invalid or expired token" }
```

**Not a wallet member (403):**
```json
{ "success": false, "message": "You are not a member of this wallet" }
```

**Wallet not found (404):**
```json
{ "success": false, "message": "Wallet not found" }
```

**Route not found (404):**
```json
{ "error": "Not Found" }
```

**Server error (500):**
```json
{ "error": "Internal Server Error" }
```

| Status | Meaning |
|---|---|
| `200` | Success |
| `400` | Bad request — missing or invalid parameters |
| `401` | Unauthorized — missing or invalid JWT |
| `403` | Forbidden — insufficient permissions |
| `404` | Not found — resource doesn't exist |
| `429` | Too many requests — OTP attempt limit |
| `500` | Server error |

---

## Cron Schedule

Daily at **08:00 UTC** via Cloudflare Cron Trigger:
1. Fetches exchange rates from exchangerate-api.com (saved as recommendations)
2. Processes due recurring transactions (creates actual transactions)
3. Hard-deletes soft-deleted transactions older than 90 days
