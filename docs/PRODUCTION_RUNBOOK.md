# HEYRAH — Production Runbook

Operational steps to deploy and run HEYRAH. Provider-neutral: no hosting provider, domain, or storage provider has been chosen yet. Secrets never go in this file or in git.

## 1. Shape of a deployment

```
client ──TLS──▶ reverse proxy / load balancer (yours) ──▶ web (node web/server/serve.mjs :8080)
                                                             │  /api/*, /assets/products/*, /sitemap.xml, /robots.txt
                                                             ▼
                                                          api (node api/dist/server.js :4000) ──▶ PostgreSQL 16
                                                             └── UPLOAD_DIR (local disk volume)
```

- The browser only ever talks to **one https origin** (the storefront). Cookies are `HttpOnly`, `SameSite=Strict` and `Secure` in production.
- The API is not exposed publicly; only the web server reaches it.
- `deploy/docker-compose.prod.yml` is a provider-neutral template of this shape (values from `deploy/.env.production`, created from `deploy/.env.production.example`). `deploy/docker-compose.yml` is the **local/demo** stack only.
- **Docker runtime was not executed in the development environment**; the compose files and Dockerfiles have only been statically reviewed. Run them once in a staging environment before relying on them.

## 2. Environment variables

The API validates its environment at boot and **refuses to start** in `NODE_ENV=production` if anything below is unsafe (`api/src/config/env.ts`; covered by `api/tests/launch.test.ts`).

### API (required in production)

| Variable | Rule in production |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL URL **with a password** |
| `SESSION_SECRET` | ≥ 32 random chars; template/placeholder values (`replace-me`, `change-me`, `example`, repeated chars) are rejected. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `API_ALLOWED_ORIGIN` | `https://` origin of the storefront, no path; not localhost. CORS allows exactly this origin |
| `PUBLIC_SITE_URL` | Same origin as `API_ALLOWED_ORIGIN` (canonical URLs, sitemap, robots.txt) |
| `TRUST_PROXY_HOPS` | Number of proxies in front of the API. Web server only: `1`. TLS proxy + web server: `2`. Never "true" |
| `PAYMENT_MODE` | `manual`. `demo` is refused unless `ALLOW_DEMO_PAYMENT_IN_PRODUCTION=I_UNDERSTAND_NO_REAL_PAYMENTS` (public demo sites only) |

### API (optional, defaults shown)

| Variable | Default | Notes |
|---|---|---|
| `PORT` | 4000 | |
| `SESSION_ABSOLUTE_TTL_HOURS` | 168 | Hard ceiling for every session (cookie lifetime matches) |
| `SESSION_IDLE_TTL_HOURS` | 24 | Customers |
| `ADMIN_SESSION_IDLE_TTL_MINUTES` | 60 | Admins; must not exceed the customer idle window |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 10 / 60000 | Login + register per IP; > 100 is refused in production |
| `CATALOG_RATE_LIMIT_MAX` | 300 | Public catalog reads per IP per minute |
| `SHIPPING_FLAT_RATE` / `SHIPPING_FREE_THRESHOLD` | 99.00 / 2999.00 | **Placeholders.** Defaults until an admin saves Settings (see §8) |
| `UPLOAD_DIR` | `uploads` | Must be writable; checked at startup |
| `UPLOAD_MAX_BYTES` | 5000000 | Per image |
| `LOG_FORMAT` | `json` in production | `pretty` for local reading |

### Web server (`web/server/serve.mjs`)

| Variable | Notes |
|---|---|
| `PORT` | Default 8080 |
| `API_ORIGIN` | Internal URL of the API, e.g. `http://api:4000` |
| `TRUST_UPSTREAM_PROXY` | `1` only when a TLS proxy sits in front (keeps its `X-Forwarded-For` / `-Proto`). Unset = this server is the edge and discards client-sent forwarding headers |

### Web build-time

| Variable | Notes |
|---|---|
| `VITE_API_URL` | `""` (empty) in production — same-origin `/api` through the web server |
| `VITE_SITE_URL` | Must equal `PUBLIC_SITE_URL` (canonical links during client navigation) |

## 3. Database

1. Provision PostgreSQL 16 with a dedicated user and password; restrict network access to the API.
2. Apply migrations — **always `migrate deploy`, never `migrate dev` or `migrate reset`** (those can drop data):
   ```
   cd api && npx prisma migrate deploy
   ```
   The API container does this on start; it is idempotent (already-applied migrations are skipped).
3. **Do not run `npm run seed` in production.** The seed truncates orders, stock history and policy pages and replaces the catalog with demo data.
4. Create the first admin from a trusted shell (never via the API):
   ```
   ADMIN_EMAIL=… ADMIN_PASSWORD=… ADMIN_NAME=… npm run bootstrap:admin --workspace api
   ```
   In production the password must be 14+ characters and not a template value. Unset the variables afterwards.
5. **Backups are the operator's responsibility** (not configured by this project): schedule PostgreSQL backups (e.g. `pg_dump` or the provider's snapshots), keep them off-host, and test a restore before launch. Back up `UPLOAD_DIR` too — product images live there.

Database guarantees that must stay intact (enforced by migrations, not by code alone): non-negative stock, price/discount checks, immutable order money + snapshots, append-only `order_items`, `order_status_history`, `stock_adjustments`, `admin_audit_log`.

## 4. Build and start (without Docker)

```
npm ci
cd api && npx prisma generate && npx prisma migrate deploy && cd ..
VITE_API_URL= VITE_SITE_URL=https://<your-domain> npm run build
NODE_ENV=production node api/dist/server.js            # with the API env from §2
API_ORIGIN=http://127.0.0.1:4000 node web/server/serve.mjs
```

Run both under a process manager that restarts on failure and sends `SIGTERM` to stop.

## 5. Startup, health, shutdown

- **Startup order (API):** env validated (exit 1 with a list of problems — values are never printed) → upload directory created/checked (exit 1 if not writable) → database reachable (10 attempts, 2 s apart; exit 1 if never) → listen. Migrations are not run by the server itself.
- **Health:** `GET /healthz` on the API → `200 {status:"ok", database:"up"}` or `503 {status:"degraded"}` (real `SELECT 1`, 2 s bound, `Cache-Control: no-store`). `GET /healthz-web` on the web server → `200 ok` (process only; the web server degrades to a generic page if the API is down).
- **Shutdown:** `SIGTERM`/`SIGINT` → stop accepting connections, finish in-flight requests (10 s grace), disconnect the database, exit 0. Give the process ≥ 15 s before a hard kill.

## 6. Logs

- One JSON object per line on stdout/stderr: `time`, `level`, `msg`, plus fields. Access log: `requestId`, `method`, `path` (no query string), `status`, `ms`.
- Every response has an `X-Request-Id`; error responses (5xx) include it in the body so a customer report can be matched to a log line.
- Redaction is automatic: password/secret/token/cookie/csrf/session/card/upi/pin keys become `***`, credentials inside connection strings and cookies are masked, and PostgreSQL "Failing row contains (…)" details are removed.
- Production error responses never contain stack traces, SQL, or driver text. Database outages return `503 service_unavailable`.

## 7. Payments

- v1 has **no payment gateway**. Orders start `PENDING_PAYMENT`; an admin confirms payment in admin → Orders (audited).
- Production must run `PAYMENT_MODE=manual`: the demo simulator routes do not exist in that mode (404). The API refuses `demo` in production unless explicitly acknowledged for a public demo.
- No card, UPI PIN, or bank credential is ever collected or stored.

## 8. Business configuration before launch

| Item | Where | Status |
|---|---|---|
| Shipping amounts | admin → Settings (overrides the env defaults) | **Pending business decision** — ₹99 / ₹2,999 are placeholders |
| Privacy, terms, returns, shipping policy, contact | admin → Pages → publish each | **Pending business text.** Unpublished pages say so, are `noindex`, not linked, not in the sitemap. The system supplies no wording |
| Product photography | admin → Products → product → Images (JPEG/PNG/WebP, ≥ 200 px, ≤ 5 MB; re-encoded to WebP, metadata stripped). Remove the "Photography coming soon" placeholder images once real ones are uploaded | **Pending assets** |
| Unpaid-order stock | Stock stays held until an admin cancels the order (cancellation restores it exactly once) | Automatic expiry is **a business decision not yet made** |

## 9. Image storage limitation

Images are stored on the API host's local disk (`UPLOAD_DIR`), served read-only at `/assets/products/*` with `nosniff` and a deny-all CSP. This is correct for **one API instance**. Running several instances requires shared/object storage — the `ImageStorage` interface (`api/src/lib/storage.ts`) is the seam, but **no provider is implemented** until one is chosen. Rate limiters are also in-process (per instance).

## 10. Release and rollback

1. Run CI (`.github/workflows/ci.yml`) and the Playwright suite locally (`npm run test:e2e`) on the release commit.
2. Back up the database and `UPLOAD_DIR`.
3. Deploy the new images/build; the API applies new migrations on start.
4. Check `/healthz`, `/healthz-web`, the homepage, a product page, sign-in, and admin → Orders.
5. **Rollback:** redeploy the previous build. Prisma migrations are forward-only; if a release added a migration, the old code must still work with the new schema (all migrations so far are additive) — otherwise restore the pre-deploy backup. Never "roll back" with `migrate reset`.

## 11. Admin and security checklist (first login)

- [ ] `NODE_ENV=production`, `PAYMENT_MODE=manual`, https origins, real `SESSION_SECRET`, DB password — the API won't start otherwise.
- [ ] TLS terminates in front of the web server; HTTP redirects to HTTPS at the proxy.
- [ ] `TRUST_PROXY_HOPS` matches the real number of proxies (wrong values break per-client rate limiting).
- [ ] Bootstrap the admin, sign in, change nothing else via the shell; unset `ADMIN_PASSWORD`.
- [ ] Confirm admin sessions expire after 60 idle minutes.
- [ ] Set final shipping amounts in Settings.
- [ ] Publish the five policy/contact pages with the business's own text.
- [ ] Replace placeholder product images.
- [ ] Verify `https://<domain>/robots.txt` and `/sitemap.xml` show the real domain.
- [ ] Database + upload backups scheduled and a restore tested.
- [ ] A human screen-reader pass (NVDA / VoiceOver) on browse → bag → checkout → order.
