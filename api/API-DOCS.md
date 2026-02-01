# Spending Tracker API Documentation

**Base URL:** `https://spending-tracker-api.arifin-reinaldo.workers.dev`

All responses return JSON with a `success` field. Errors include an `error` or `message` field.

---

## Exchange Rates

### Fetch Latest Rates

Fetches exchange rates from exchangerate-api.com and saves them as recommendations (not yet applied).

```
POST /api/rates/fetch
```

**Request:** No body required.

**Response:**
```json
{
  "success": true,
  "message": "Fetched 5 rate recommendations",
  "rates": [
    { "pair": "USD/SGD", "rate": 1.3425, "source": "exchangerate-api.com" },
    { "pair": "USD/EUR", "rate": 0.9215, "source": "exchangerate-api.com" }
  ]
}
```

---

### Get Pending Recommendations

Returns all unapplied rate recommendations with comparison to current active rates.

```
GET /api/rates/recommendations
```

**Response:**
```json
{
  "success": true,
  "recommendations": [
    {
      "id": 1,
      "pair": "USD/SGD",
      "recommendedRate": 1.3425,
      "currentRate": 1.3400,
      "currentDate": "2025-01-31",
      "difference": 0.0025,
      "percentChange": 0.19,
      "source": "exchangerate-api.com",
      "fetchedAt": "2025-02-01T08:00:00Z"
    }
  ]
}
```

---

### Get Current Rate

Returns the current active rate and latest recommendation for a currency pair.

```
GET /api/rates/current?from={FROM}&to={TO}
```

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `from` | string | Yes | Source currency code (e.g. `USD`) |
| `to` | string | Yes | Target currency code (e.g. `SGD`) |

**Example:**
```
GET /api/rates/current?from=USD&to=SGD
```

**Response:**
```json
{
  "success": true,
  "pair": "USD/SGD",
  "currentRate": 1.3400,
  "currentDate": "2025-01-31",
  "recommendedRate": 1.3425,
  "difference": 0.0025,
  "percentChange": 0.19
}
```

---

### Apply a Recommendation

Applies a pending recommendation as the active exchange rate for today.

```
POST /api/rates/apply
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `recommendationId` | integer | Yes | ID of the recommendation to apply |
| `notes` | string | No | Optional note |

**Example:**
```json
{
  "recommendationId": 1,
  "notes": "Accepted daily rate"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Rate applied successfully",
  "rate": 1.3425
}
```

**Errors:**
- `404` — Recommendation not found or already applied

---

### Add Manual Rate

Manually set an exchange rate for today.

```
POST /api/rates/manual
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `fromCurrency` | string | Yes | Source currency code (e.g. `USD`) |
| `toCurrency` | string | Yes | Target currency code (e.g. `SGD`) |
| `rate` | number | Yes | Exchange rate value |
| `notes` | string | No | Optional note (e.g. "Bank rate") |

**Example:**
```json
{
  "fromCurrency": "USD",
  "toCurrency": "SGD",
  "rate": 1.335,
  "notes": "Bank rate"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Manual rate added successfully",
  "newRate": 1.335,
  "previousRate": 1.3400
}
```

**Errors:**
- `400` — Invalid currency codes

---

## Wallets

### Create Wallet

Creates a new wallet. The creating user is automatically added as `owner`.

```
POST /api/wallets
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Wallet name |
| `description` | string | No | Wallet description |
| `defaultCurrencyCode` | string | No | Default currency (e.g. `SGD`) |
| `userId` | integer | Yes | ID of the user creating the wallet |

**Example:**
```json
{
  "name": "Personal Wallet",
  "description": "Daily expenses",
  "defaultCurrencyCode": "SGD",
  "userId": 1
}
```

**Response:**
```json
{
  "success": true,
  "wallet": {
    "id": 1,
    "name": "Personal Wallet",
    "createdAt": "2025-02-01T08:00:00Z"
  }
}
```

**Errors:**
- `400` — Missing `name` or `userId`

---

### List Wallets

Returns all wallets a user belongs to.

```
GET /api/wallets?userId={USER_ID}
```

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `userId` | integer | Yes | User ID |

**Example:**
```
GET /api/wallets?userId=1
```

**Response:**
```json
{
  "success": true,
  "wallets": [
    {
      "id": 1,
      "name": "Personal Wallet",
      "description": "Daily expenses",
      "defaultCurrency": "SGD",
      "myRole": "owner",
      "createdByName": "Reinaldo",
      "memberCount": 2,
      "createdAt": "2025-02-01T08:00:00Z"
    }
  ]
}
```

---

### Get Wallet Members

Returns all members of a wallet with their roles.

```
GET /api/wallets/{walletId}/members
```

**Response:**
```json
{
  "success": true,
  "walletId": 1,
  "members": [
    {
      "id": 1,
      "name": "Reinaldo",
      "email": "reinaldo@email.com",
      "role": "owner",
      "joinedAt": "2025-02-01T08:00:00Z"
    },
    {
      "id": 2,
      "name": "Jane",
      "email": "jane@email.com",
      "role": "editor",
      "joinedAt": "2025-02-01T09:00:00Z"
    }
  ]
}
```

---

### Add Wallet Member

Add a user to a wallet with a specific role.

```
POST /api/wallets/{walletId}/members
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | integer | Yes | User ID to add |
| `role` | string | No | `owner`, `editor` (default), or `viewer` |

**Example:**
```json
{
  "userId": 2,
  "role": "editor"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Jane added as editor"
}
```

**Errors:**
- `400` — Missing `userId`
- `404` — User not found
- `409` — User is already a member

---

### Remove Wallet Member

Remove a user from a wallet.

```
DELETE /api/wallets/{walletId}/members/{userId}
```

**Example:**
```
DELETE /api/wallets/1/members/2
```

**Response:**
```json
{
  "success": true,
  "message": "Member removed"
}
```

**Errors:**
- `404` — Member not found in this wallet

---

## Transactions

### Add Transaction

Add a transaction to a wallet. Records which user created it.

```
POST /api/wallets/{walletId}/transactions
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | string | Yes | Date in `YYYY-MM-DD` format |
| `description` | string | No | Transaction description |
| `amount` | number | Yes | Transaction amount |
| `currencyCode` | string | Yes | Currency code (e.g. `SGD`, `USD`) |
| `categoryId` | integer | No | Category ID |
| `paymentMethod` | string | No | e.g. `Credit Card`, `Cash`, `Debit` |
| `notes` | string | No | Additional notes |
| `userId` | integer | Yes | ID of the user adding this transaction |

**Example:**
```json
{
  "date": "2025-02-01",
  "description": "Team lunch",
  "amount": 45.00,
  "currencyCode": "SGD",
  "categoryId": 1,
  "paymentMethod": "Credit Card",
  "userId": 1
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": 42,
  "createdBy": {
    "id": 1,
    "name": "Reinaldo"
  },
  "createdAt": "2025-02-01T08:30:00Z"
}
```

**Errors:**
- `400` — Missing `userId` or invalid currency code
- `403` — User is not a member of this wallet, or user is a `viewer`

---

### List Transactions

List all transactions for a wallet. Each transaction shows who created it.

```
GET /api/wallets/{walletId}/transactions
```

**Query Parameters (all optional):**

| Param | Type | Description |
|---|---|---|
| `from` | string | Start date (`YYYY-MM-DD`) |
| `to` | string | End date (`YYYY-MM-DD`) |
| `createdBy` | integer | Filter by user ID who created the transaction |

**Examples:**
```
GET /api/wallets/1/transactions
GET /api/wallets/1/transactions?from=2025-01-01&to=2025-01-31
GET /api/wallets/1/transactions?createdBy=2
```

**Response:**
```json
{
  "success": true,
  "walletId": 1,
  "transactions": [
    {
      "id": 42,
      "date": "2025-02-01",
      "description": "Team lunch",
      "amount": 45.00,
      "currency": "SGD",
      "currencySymbol": "S$",
      "category": "Food & Dining",
      "paymentMethod": "Credit Card",
      "notes": null,
      "createdBy": {
        "id": 1,
        "name": "Reinaldo"
      },
      "createdAt": "2025-02-01T08:30:00Z"
    }
  ]
}
```

---

## Reports

### Spending Report

Get a spending report for a wallet with all amounts converted to a target currency. Includes aggregation by month, category, and user.

```
GET /api/wallets/{walletId}/reports/spending
```

**Query Parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `currency` | string | No | `SGD` | Target currency for conversion |
| `from` | string | No | — | Start date (`YYYY-MM-DD`) |
| `to` | string | No | — | End date (`YYYY-MM-DD`) |

**Example:**
```
GET /api/wallets/1/reports/spending?currency=SGD&from=2025-01-01&to=2025-12-31
```

**Response:**
```json
{
  "success": true,
  "walletId": 1,
  "targetCurrency": "SGD",
  "transactions": [
    {
      "id": 42,
      "date": "2025-02-01",
      "description": "Team lunch",
      "originalAmount": 45.00,
      "originalCurrency": "SGD",
      "convertedAmount": 45.00,
      "exchangeRate": 1.0,
      "category": "Food & Dining",
      "paymentMethod": "Credit Card",
      "createdBy": {
        "id": 1,
        "name": "Reinaldo"
      }
    }
  ],
  "summary": {
    "totalTransactions": 1,
    "totalAmount": 45.00,
    "monthlyTotals": {
      "2025-02": 45.00
    },
    "categoryTotals": {
      "Food & Dining": 45.00
    },
    "userTotals": {
      "Reinaldo": 45.00
    }
  }
}
```

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

## Categories

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

---

## Wallet Roles

| Role | View Transactions | Add/Edit Transactions | Manage Members | Delete Wallet |
|---|---|---|---|---|
| `owner` | Yes | Yes | Yes | Yes |
| `editor` | Yes | Yes | No | No |
| `viewer` | Yes | No | No | No |

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "message": "Description of what went wrong"
}
```

| Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid parameters |
| `403` | Forbidden — user lacks permission |
| `404` | Not found — resource doesn't exist |
| `409` | Conflict — duplicate (e.g. user already a member) |
| `500` | Server error |

---

## Cron Schedule

Exchange rates are automatically fetched daily at **08:00 UTC** via Cloudflare Cron Trigger. Fetched rates are saved as recommendations and must be applied manually or via the `/api/rates/apply` endpoint.
