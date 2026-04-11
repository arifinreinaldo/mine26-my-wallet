# Mobile API Specification

**Base URL:** `https://spending-tracker-api.arifin-reinaldo.workers.dev`

**Content-Type:** `application/json` for all POST/PUT requests

**Auth:** All endpoints except `/api/auth/*` require `Authorization: Bearer <jwt>` header

**Response format:** All responses are JSON with `{ success: boolean, ... }`. Errors include `message` field.

**HTTP Status Codes:**
- `200` — Success
- `400` — Validation error
- `401` — Missing/invalid/expired token
- `403` — Forbidden (wrong role or not a member)
- `404` — Resource not found
- `429` — OTP rate limit (too many failed attempts)

---

## 1. Authentication

OTP-based, passwordless. Client must subscribe to ntfy.sh topic `my-wallet-{username}` to receive OTP codes.

### 1.1 Check Username Availability

```
GET /api/auth/check-username?username={username}
```

**Response:**
```json
{ "success": true, "available": true }
```

### 1.2 Register

```
POST /api/auth/register
```

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "username": "johndoe"
}
```

**Response:**
```json
{ "success": true, "message": "OTP sent to ntfy topic" }
```

**Flow:** OTP is sent to `ntfy.sh/my-wallet-{username}`. User must verify within 5 minutes.

### 1.3 Verify Registration

```
POST /api/auth/verify-registration
```

**Body:**
```json
{ "username": "johndoe", "otp": "123456" }
```

**Response:**
```json
{ "success": true, "token": "eyJhbG..." }
```

**Token:** JWT, 7-day expiry. Payload: `{ userId, username, iat, exp }`. Store securely on device.

### 1.4 Login

```
POST /api/auth/login
```

**Body:**
```json
{ "username": "johndoe" }
```

**Response:**
```json
{ "success": true, "message": "OTP sent" }
```

### 1.5 Verify Login

```
POST /api/auth/verify-login
```

**Body:**
```json
{ "username": "johndoe", "otp": "123456" }
```

**Response:**
```json
{ "success": true, "token": "eyJhbG..." }
```

### 1.6 Resend OTP

```
POST /api/auth/resend-otp
```

**Body:**
```json
{ "username": "johndoe", "purpose": "login" }
```

**Constraints:**
- `purpose`: `"login"` or `"register"`
- 60-second cooldown between resends
- OTP expires in 5 minutes
- Max 5 failed attempts per OTP (then 429)

**Response:**
```json
{ "success": true, "message": "New OTP sent" }
```

---

## 2. User Profile

### 2.1 Get My Profile

```
GET /api/users/me
```

**Response:**
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

### 2.2 Search User (for adding wallet members)

```
GET /api/users/search?username={username}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 2,
    "name": "Jane Doe",
    "username": "janedoe"
  }
}
```

---

## 3. Wallets

### 3.1 List My Wallets

```
GET /api/wallets
```

**Response:**
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

**Notes:**
- `currentBalance` = `startingBalance` + sum(income) - sum(expense), converted to default currency
- `myRole`: `"owner"`, `"editor"`, or `"viewer"`

### 3.2 Create Wallet

```
POST /api/wallets
```

**Body:**
```json
{
  "name": "Personal Wallet",
  "description": "My daily expenses",
  "defaultCurrencyCode": "SGD",
  "startingBalance": 0
}
```

**Response:**
```json
{
  "success": true,
  "wallet": {
    "id": 1,
    "name": "Personal Wallet"
  }
}
```

**Notes:** Creator is automatically added as `owner`.

### 3.3 Edit Wallet

```
PUT /api/wallets/:walletId
```

**Body:** (all fields optional)
```json
{
  "name": "Updated Name",
  "description": "Updated desc",
  "startingBalance": 100
}
```

**Required role:** `owner`

### 3.4 Delete Wallet

```
DELETE /api/wallets/:walletId
```

**Required role:** `owner`

### 3.5 Get Wallet Members

```
GET /api/wallets/:walletId/members
```

**Response:**
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

### 3.6 Add Wallet Member

```
POST /api/wallets/:walletId/members
```

**Body:**
```json
{
  "userId": 2,
  "role": "editor"
}
```

**Roles:** `"owner"`, `"editor"`, `"viewer"`

**Constraints:**
- Only owners can assign `"owner"` role
- Editors can add members as `"editor"` or `"viewer"`

### 3.7 Remove Wallet Member

```
DELETE /api/wallets/:walletId/members/:userId
```

**Required role:** `owner`

**Constraint:** Cannot remove the last owner.

---

## 4. Transactions

### 4.1 Create Transaction

```
POST /api/wallets/:walletId/transactions
```

**Body:**
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

**Required fields:** `date`, `amount`, `currencyCode`

**Optional fields:** `description`, `type` (defaults to `"expense"`), `categoryId`, `paymentMethod`, `notes`

**Type:** `"income"` or `"expense"`

**Supported currencies:** `SGD`, `USD`, `EUR`, `MYR`, `GBP`, `JPY`, `IDR`, `PHP`

**Required role:** `owner` or `editor`

**Response:**
```json
{
  "success": true,
  "transactionId": 4,
  "type": "expense",
  "createdBy": { "id": 1, "name": "John Doe" },
  "createdAt": "2026-04-11T12:13:59.412Z"
}
```

### 4.2 List Transactions

```
GET /api/wallets/:walletId/transactions
```

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 50 | Items per page (max 200) |
| `from` | date | — | Filter: start date (YYYY-MM-DD) |
| `to` | date | — | Filter: end date (YYYY-MM-DD) |
| `type` | string | — | Filter: `"income"` or `"expense"` |
| `categoryId` | int | — | Filter: category ID |
| `createdBy` | int | — | Filter: user ID |
| `q` | string | — | Search: description or notes (case-insensitive) |

**Response:**
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

### 4.3 Edit Transaction

```
PUT /api/wallets/:walletId/transactions/:transactionId
```

**Body:** (all fields optional — only provided fields are updated)
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

**Required role:** `owner`, or `editor` who created the transaction

**Response:**
```json
{ "success": true, "message": "Transaction updated", "transactionId": 4 }
```

### 4.4 Delete Transaction (soft delete)

```
DELETE /api/wallets/:walletId/transactions/:transactionId
```

**Required role:** `owner`, or `editor` who created the transaction

**Response:**
```json
{ "success": true, "message": "Transaction deleted" }
```

**Note:** Soft delete — sets `deleted_at`, not permanently removed. Hard-deleted after 90 days by cron.

---

## 5. Dashboard

Single-call summary optimized for the home screen.

```
GET /api/wallets/:walletId/dashboard
```

**Response:**
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

---

## 6. Categories

### 6.1 List Categories

```
GET /api/categories?walletId={walletId}
```

**Notes:**
- Without `walletId`: returns only global (seeded) categories
- With `walletId`: returns global + custom categories for that wallet

**Response:**
```json
{
  "success": true,
  "categories": [
    { "id": 1, "name": "Food & Dining", "icon": null, "color": null, "isCustom": false, "parentId": null },
    { "id": 2, "name": "Transport", "icon": null, "color": null, "isCustom": false, "parentId": null },
    { "id": 13, "name": "My Category", "icon": "🛒", "color": "#FF0000", "isCustom": true, "parentId": null }
  ]
}
```

**Global categories (seeded):** Food & Dining, Transport, Shopping, Entertainment, Bills & Utilities, Healthcare, Travel, Others, Grocery, Gifts, Accommodation, Gunpla

### 6.2 Create Custom Category

```
POST /api/categories
```

**Body:**
```json
{
  "name": "My Category",
  "icon": "🛒",
  "color": "#FF0000",
  "walletId": 1,
  "parentId": null
}
```

**Required:** `name`. All others optional.

**Required role:** `owner` or `editor` (if wallet-scoped)

### 6.3 Edit Custom Category

```
PUT /api/categories/:categoryId
```

**Body:** (all optional)
```json
{ "name": "Renamed", "icon": "🏠", "color": "#00FF00" }
```

**Note:** Cannot edit global/seeded categories.

### 6.4 Delete Custom Category

```
DELETE /api/categories/:categoryId
```

**Note:** Cannot delete global/seeded categories. Transactions keep their `categoryId` reference.

---

## 7. Exchange Rates

Two-stage workflow: fetch recommendations → apply to activate.

### 7.1 Fetch Rate Recommendations

```
POST /api/rates/fetch
```

**Body:** empty `{}`

**Note:** Fetches from exchangerate-api.com. Skips if already fetched today. Cron does this daily at 08:00 UTC.

### 7.2 List Recommendations

```
GET /api/rates/recommendations
```

**Response:**
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

### 7.3 Apply Recommendation

```
POST /api/rates/apply
```

**Body:**
```json
{ "recommendationId": 37 }
```

### 7.4 Add Manual Rate

```
POST /api/rates/manual
```

**Body:**
```json
{
  "fromCurrency": "SGD",
  "toCurrency": "USD",
  "rate": 0.74,
  "effectiveDate": "2026-04-11",
  "notes": "Manual rate"
}
```

### 7.5 Get Current Rate

```
GET /api/rates/current?from=SGD&to=USD
```

**Response:**
```json
{
  "success": true,
  "pair": "SGD/USD",
  "currentRate": 0.74,
  "recommendedRate": null,
  "difference": null,
  "percentChange": null
}
```

---

## 8. Recurring Transactions

### 8.1 Create Recurring

```
POST /api/wallets/:walletId/recurring
```

**Body:**
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

**Frequencies:** `"daily"`, `"weekly"`, `"biweekly"`, `"monthly"`, `"yearly"`

**Required:** `description`, `amount`, `currencyCode`, `frequency`, `startDate`

**Response:**
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

### 8.2 List Recurring

```
GET /api/wallets/:walletId/recurring
```

**Response:**
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

### 8.3 Delete Recurring (deactivate)

```
DELETE /api/wallets/:walletId/recurring/:recurringId
```

**Note:** Sets `isActive = false`. Does NOT delete previously created transactions.

---

## 9. Reports

### 9.1 Spending Report

```
GET /api/wallets/:walletId/reports/spending
```

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `currency` | string | `"SGD"` | Target currency for conversion |
| `from` | date | — | Start date (YYYY-MM-DD) |
| `to` | date | — | End date (YYYY-MM-DD) |
| `page` | int | 1 | Page number |
| `limit` | int | 50 | Items per page (max 200) |

**Response:**
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

---

## 10. CSV Export / Import

### 10.1 Export CSV

```
GET /api/wallets/:walletId/export/csv
```

**Query params:** `from`, `to` (optional date filters)

**Response:** `Content-Type: text/csv` with `Content-Disposition: attachment; filename="{walletName}_transactions.csv"`

**Columns:** Date, Type, Description, Amount, Currency, Category, Payment Method, Notes, Created By

**Limit:** Max 10,000 rows.

### 10.2 Import Transactions

```
POST /api/wallets/:walletId/import
```

**Body:**
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

**Notes:**
- Max 1,000 transactions per batch
- `categoryName` — matched case-insensitively. Unknown names auto-create custom categories.
- Negative amounts are converted to absolute value
- Type defaults to `"expense"` if missing

**Response:**
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

---

## 11. Offline Sync

For offline-first mobile clients. Uses client-generated UUIDs and last-write-wins conflict resolution.

### 11.1 Push Sync (client → server)

```
POST /api/wallets/:walletId/sync
```

**Body:**
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
      "data": {
        "description": "Updated description",
        "amount": 10.00
      }
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

**Response:**
```json
{
  "success": true,
  "results": [
    { "clientId": "...", "status": "created", "serverId": 5 },
    { "clientId": "...", "status": "updated", "serverId": 6 },
    { "clientId": "...", "status": "deleted", "serverId": 7 },
    { "clientId": "...", "status": "conflict", "error": "Server version is newer" }
  ],
  "errors": []
}
```

**Status values:** `"created"`, `"updated"`, `"deleted"`, `"already_deleted"`, `"conflict"`, `"error"`

### 11.2 Pull Sync (server → client)

```
GET /api/wallets/:walletId/sync
```

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `since` | timestamp | — | Omit for full sync, provide for incremental |
| `limit` | int | 500 | Max results (capped at 1000) |

**Response:**
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
    }
  ],
  "hasMore": false,
  "syncTimestamp": "2026-04-11T12:15:46.074Z"
}
```

**Sync protocol:**
1. First sync: `GET /sync` (no `since`) → store `syncTimestamp`
2. Subsequent syncs: `GET /sync?since={syncTimestamp}` → store new `syncTimestamp`
3. Only store `syncTimestamp` when `hasMore: false`
4. If `hasMore: true`, keep pulling with same `since` until `hasMore: false`
5. `deletedAt` is populated for soft-deleted records — remove from local DB
6. If gap since last sync > 90 days, do a full sync (hard-deleted records may be missed)

---

## 12. Role Permissions Summary

| Action | owner | editor | viewer |
|--------|-------|--------|--------|
| View wallet/transactions/reports | Yes | Yes | Yes |
| Add/edit/delete transactions | Yes | Yes | No |
| Add members (editor/viewer) | Yes | Yes | No |
| Add members (owner) | Yes | No | No |
| Remove members | Yes | No | No |
| Edit/delete wallet | Yes | No | No |
| Create/edit/delete categories | Yes | Yes | No |

---

## 13. Error Response Examples

**Validation error:**
```json
{ "success": false, "message": "date, amount, and currencyCode are required" }
```

**Auth error:**
```json
{ "success": false, "message": "Invalid or expired token" }
```

**Permission error:**
```json
{ "success": false, "message": "Viewers cannot edit transactions" }
```

**Not found:**
```json
{ "success": false, "message": "Wallet not found" }
```

**Rate limit:**
```json
{ "success": false, "message": "Too many failed OTP attempts. Request a new code." }
```
