# HEYRAH Authentication

Phase 6 — identity, sessions, and account management. This document is the
operator-facing summary; the normative sources are `REQUIREMENTS.md` §11 and
`API_CONTRACT.md` §1/§7.

## Overview

- **Cookie sessions, no JWT** (v1 decision; switching requires explicit
  approval). The session state lives server-side in PostgreSQL
  (`sessions` table) for instant revocation.
- **Every visitor gets a session** — guests hold one unauthenticated (the
  future guest cart keys off it); users are authenticated on it; admins are
  role-gated server-side.
- The web app never sees the session cookie value (httpOnly) and stores
  nothing auth-related in localStorage.

## Passwords

- Algorithm: **bcrypt, cost 12**, per-user salt (embedded in the hash).
  Implementation: `api/src/lib/password.ts` (bcryptjs — pure JS, no native
  build step).
- Policy: minimum **10 characters**, maximum 128. Stated in the UI before
  typing; enforced again at the API boundary with Zod.
- Plaintext never stored, logged, or returned. API responses expose only
  `{ id, name, email, role }`.
- Password change re-verifies the current password
  (`PATCH /api/v1/account/password`).
- Login failures are **generic**: unknown email and wrong password return
  the identical `401 invalid_credentials` envelope. A dummy bcrypt
  comparison burns the same time on the unknown-email path so response
  timing does not reveal account existence.

## Sessions

Storage row (`sessions`): id = hex(sha256(token)) — a database leak yields
no usable cookies — plus `user_id` (null = guest), `expires_at` (absolute
ceiling), `last_seen_at` (idle window), `rotated_from` (rotation audit
chain, the future guest-cart merge key).

| Setting | Env var | Default | Meaning |
|---|---|---|---|
| Absolute TTL | `SESSION_ABSOLUTE_TTL_HOURS` | `168` (7 days) | Hard ceiling; the cookie max-age matches |
| Idle TTL | `SESSION_IDLE_TTL_HOURS` | `24` | Dead after this much inactivity |
| Secret | `SESSION_SECRET` | — | 32+ chars, required at boot |

Cookie flags (`api/src/config/session.ts`): `HttpOnly`, `Secure` in
production, `SameSite=Strict`, `Path=/`.

Lifecycle:

- **Register / login** rotate the session identifier; the previous token is
  deleted server-side and its hash recorded in `rotated_from` (§11.4).
- **Logout** deletes the row — the cookie value is dead on arrival.
- **Blocked users** (`users.is_blocked`) cannot log in (`403
  account_blocked`) and their live sessions stop resolving immediately.
- Expired sessions (either window) are swept lazily on first contact.

## CSRF

Double-submit token per API_CONTRACT §7: the token rides in a JS-readable
`heyrah_csrf` cookie **and** must be echoed in the `X-CSRF-Token` header on
every mutating request. A cross-site attacker cannot read the cookie, so
cannot echo it; `SameSite=Strict` already keeps the session cookie home —
the token is defense in depth. Bootstrap: `GET /api/v1/auth/csrf` mints the
guest session (if absent) + token; the SPA calls it once at load and the
auth client (`web/src/api/auth.ts`) attaches the header automatically.

## Rate limiting

Auth credential endpoints (register, login) are limited to
`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` per IP — defaults
10 / 60 000 ms (API_CONTRACT §9). The limiter is process-local (sufficient
for single-node v1; a multi-node deployment swaps the store, not the
contract). Exceeded requests get `429 rate_limited` with a `Retry-After`
header. Local/e2e `.env` may raise `RATE_LIMIT_MAX` for test headroom;
production keeps the documented default.

## Authorization

- Role is stored server-side (`users.role`, CHECK `('USER','ADMIN')`) and
  read fresh on every request — never accepted from the client.
- `requireUser` guards `/api/v1/account/*`; `requireAdmin` (mounted from the
  admin phase onward) rejects non-admins with `403 access_denied`.
- Client-side route guards (`ProtectedRoute`) are UX only.
- Registration always creates `USER`; the client cannot set `role` or
  `isBlocked` (mass-assignment protection — Zod allowlists the input).

## Admin bootstrap

v1 has no admin signup. Create/promote admins from the server shell:

```bash
cd api
ADMIN_EMAIL=admin@heyrah.test \
ADMIN_PASSWORD="at-least-ten-characters" \
ADMIN_NAME="HEYRAH Admin" \
npm run bootstrap:admin
```

Idempotent: re-running with the same email promotes/updates that row
(`upsert`, role forced to `ADMIN`).

## API surface

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/register` | guest | 201 + session; 409 `email_taken` |
| POST | `/api/v1/auth/login` | guest | 200 + rotated session |
| POST | `/api/v1/auth/logout` | any | revokes server-side |
| GET | `/api/v1/auth/me` | any | `{ user: null }` for guests |
| GET | `/api/v1/auth/csrf` | any | session + CSRF bootstrap |
| PATCH | `/api/v1/account/password` | user | re-verifies current password |
| PATCH | `/api/v1/account/profile` | user | name updates |

Errors use the shared envelope `{ error: { code, message } }` — codes:
`validation_failed`, `invalid_credentials`, `account_blocked`,
`email_taken`, `wrong_password`, `authentication_required`, `access_denied`,
`csrf_failed`, `rate_limited`.

## Local setup

```bash
cd api
npx prisma migrate deploy   # applies catalog + auth migrations
npm run seed                # deterministic catalog fixture
npm run dev                 # :4000
```

`web/` runs on :5173 with `credentials: "include"` — same-site in dev, so
`SameSite=Strict` cookies flow without extra configuration.

## Tests

- `api/tests/auth.test.ts` — 18 integration tests against real PostgreSQL
  (registration, login, rotation, revocation, expiry sweep, blocking,
  CSRF, rate limit, account endpoints). Run: `npm run test:db`.
- `web/src/App.test.tsx` — 10 UI tests (guest/authenticated header, login
  failure/success, register, duplicate email, protected redirect, password
  change success/failure).
- `tests/e2e/auth.spec.ts` — 6 browser tests (register→reload, wrong/right
  password, protected redirect + return, password rotation, keyboard-only,
  mobile viewport).
