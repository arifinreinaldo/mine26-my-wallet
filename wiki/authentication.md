# Authentication

## Overview
Passwordless OTP-based authentication. Users register with name/email/username, verify via OTP sent to ntfy.sh push notification, and receive a JWT for subsequent requests.

## Rules

1. **OTP delivery** — Sent via HTTP POST to `https://ntfy.sh/my-wallet-{username}`. Client must subscribe to this ntfy topic to receive codes.
2. **OTP format** — 6-digit numeric code, stored in `otp_codes` table.
3. **OTP expiry** — 5 minutes from creation (`expires_at` column).
4. **OTP max attempts** — 5 failed attempts per OTP code. On 6th attempt, returns HTTP 429 "Too many failed attempts". Enforced in `auth.js` by checking `attempts >= 5` BEFORE incrementing.
5. **OTP resend cooldown** — 60 seconds between resends. Checked via `created_at` of most recent OTP for that username/purpose.
6. **OTP invalidation on resend** — When a new OTP is sent, all previous unused OTPs for that username/purpose are marked `used = TRUE`. Only the newest OTP is valid.
7. **JWT payload** — `{ userId, username, iat, exp }`. Signed with HMAC-SHA256 via Web Crypto API.
8. **JWT expiry** — 7 days from issuance. No refresh token mechanism.
9. **JWT verification** — Router middleware verifies JWT on all non-auth routes. Returns 401 if missing, invalid, or expired.
10. **User identity source** — ALWAYS from JWT payload (`user.userId`), NEVER from request body or URL params. This is a critical security invariant. See [Common Bug Patterns](common-bug-patterns.md).
11. **Registration flow** — `register` → OTP sent → `verify-registration` (marks user `verified = TRUE`, returns JWT).
12. **Login flow** — `login` (requires `verified = TRUE`) → OTP sent → `verify-login` (returns JWT).
13. **Username uniqueness** — Checked at registration. `check-username` endpoint available for real-time validation.

## Edge Cases

1. User registers but never verifies → user exists with `verified = FALSE`. They cannot log in. They can re-register (same username) which sends a new OTP.
2. Multiple OTPs requested rapidly → only the newest is valid (older ones invalidated).
3. OTP attempt counter: checked as `attempts >= 5` before incrementing, so the 6th submission triggers lockout (not the 5th).
4. Expired OTP returns "OTP has expired" (not "invalid"), giving the user a clear signal to request a new one.

## Common Mistakes
- Trusting `body.userId` for authorization instead of `user.userId` from JWT. See [Common Bug Patterns #2](common-bug-patterns.md).
- Forgetting to check `verified = TRUE` before allowing login.

## Related Pages
- [API Patterns](api-patterns.md) — JWT middleware in router
- [Common Bug Patterns](common-bug-patterns.md) — user identity source
