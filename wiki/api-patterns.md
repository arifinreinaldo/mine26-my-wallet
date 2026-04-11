# API Patterns

## Overview
Conventions for the custom router, handler signatures, response formats, and middleware that all endpoints follow.

## Rules

### Handler Signature
1. **All handlers receive 6 parameters** in this exact order:
```javascript
async function handleSomething(sql, params, url, body, env, user) { ... }
```
| Param | Type | Source |
|-------|------|--------|
| `sql` | Function | `neon(env.DATABASE_URL)` — tagged template for queries |
| `params` | Object | URL path params (e.g., `{ walletId: '5' }`) — always strings |
| `url` | URL | Full request URL. Use `url.searchParams` for query params |
| `body` | Object | Parsed JSON body (or `{}` for GET/DELETE) |
| `env` | Object | Cloudflare Worker env (secrets) |
| `user` | Object | JWT payload `{ userId, username, iat, exp }` |

### Response Format
2. **Standard response** — Return `{ status: <number>, body: <object> }`:
```javascript
return { status: 200, body: { success: true, data: result } };
return { status: 400, body: { success: false, message: 'Validation error' } };
```

3. **CSV response** — Return `{ csv: <string>, filename: <string> }`:
```javascript
return { csv: csvString, filename: 'export.csv' };
```
`index.js` detects `result.csv` and sets `Content-Type: text/csv`.

4. **Error responses** — Always include `success: false` with either `message` or `error` field.

### Router (router.js)
5. **Path matching** — Uses `:param` placeholders. Exact segment count required. Case-sensitive.
6. **Public routes** — `/api/auth/*` paths skip JWT verification.
7. **Protected routes** — All other paths require valid `Authorization: Bearer <token>`. Router calls `verifyJwt()` and passes decoded payload as `user` param.
8. **404 handling** — Unmatched routes return `{ status: 404, body: { success: false, message: 'Not found' } }`.

### Query Patterns
9. **Parameterized queries** — Always use tagged template literals:
```javascript
// CORRECT — parameterized (SQL injection safe)
const result = await sql`SELECT * FROM users WHERE id = ${userId}`;

// WRONG — string interpolation (SQL injection vulnerable)
const result = await sql(`SELECT * FROM users WHERE id = ${userId}`);
```

10. **Query results** — `sql` returns an array of row objects. Destructure for single results:
```javascript
const [user] = await sql`SELECT * FROM users WHERE id = ${userId}`;
if (!user) return { status: 404, body: { success: false, message: 'Not found' } };
```

### Adding New Endpoints
11. **Checklist for new endpoints:**
    - [ ] Add route in `router.js` with correct HTTP method
    - [ ] Handler follows 6-param signature
    - [ ] If wallet-scoped: call `checkWalletAccess()` first
    - [ ] Use `user.userId` for identity (never `body.userId`)
    - [ ] If querying transactions: include `WHERE deleted_at IS NULL`
    - [ ] If currency involved: resolve code to ID, handle invalid
    - [ ] If paginated: fetch `limit + 1`, detect `hasMore`, slice results
    - [ ] Return `{ status, body }` format
    - [ ] Add to Postman collection for testing

## Edge Cases

1. `params` values are always strings (from URL). Parse to int when needed: `parseInt(params.walletId, 10)`.
2. `body` is `{}` for GET requests (not `null` or `undefined`).
3. `url.searchParams.get('key')` returns `null` if param is missing (not `undefined`).

## Related Pages
- [Authentication](authentication.md) — JWT middleware details
- [Wallets](wallets.md) — checkWalletAccess() pattern
- [Common Bug Patterns](common-bug-patterns.md) — response format mistakes
