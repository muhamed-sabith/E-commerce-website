# HEYRAH — Architecture Document

**Status:** v2.0 — PERN stack (React + Express + Prisma + PostgreSQL); all v1 commerce decisions unchanged
**Depends on:** `docs/REQUIREMENTS.md`, `docs/DATABASE_SCHEMA.md`, `docs/TECH_STACK.md`
**Supersedes:** the v1.1 FastAPI/Next.js architecture (that text remains in git history and the ADRs)

---

## 1. System overview

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│  React SPA (TypeScript)     │      │  Express API (Node.js + TS)  │
│  storefront + admin UI      │─────▶│  REST /api/v1                │
│  Vite build, React Router   │      │  auth, catalog, cart,        │
│  design tokens (teal/gold)  │      │  checkout, admin services    │
└─────────────────────────────┘      └───────────┬──────────────────┘
        browser gets built assets               ┌──┴──────────┐
        + safe JSON from /api/v1                │ PostgreSQL  │
                                                │ via Prisma  │
                                                └─────────────┘
```

Three deployable shapes via Docker Compose: `web` (Vite build served by a static/Node server), `api` (Express), `db` (PostgreSQL). The SPA and API are **independent applications** — separate package.json, separate builds, communicating only through the `/api/v1` JSON contract. Object storage for product images (local volume in dev, provider in production — decision later).

## 2. Frontend architecture (React + TypeScript + Vite)

- **One SPA, two route trees:** `(storefront)/…` for customers, `(admin)/admin/…` for operators. React Router owns navigation, nested layouts, and protected-route redirects. Client route guards are **UX only** — real enforcement lives in the API (§4).
- **API access layer:** a typed client module wrapping `/api/v1`; components never hand-roll `fetch` URLs. Prices/stock/totals arrive from the API and are displayed as-is — **the frontend performs no money math beyond formatting and is never the authority for prices, totals, inventory, roles, or payment status.**
- **Design tokens as CSS variables:** `--color-teal-*`, `--color-gold-*`, spacing scale (4/8px), type scale — defined in `docs/DESIGN_SYSTEM.md`. No raw hex scattered in components.
- **Client UI state:** lightweight local state (cart badge count, drawer open/closed, filter panel); server data stays server data — fetched per view, never mirrored into global stores that can go stale.
- **SEO note (SPA trade-off, documented):** catalog/detail pages are delivered as built assets; meta/structured-data strategy is handled at the serving layer (per-route meta injection + shareable URLs) — the constraint from REQUIREMENTS §14 (no blank-page-on-crawl) is a checklist item for the implementation phase, not a framework guarantee anymore.
- **As implemented (Phase 11) — serving layer.** Production serves the SPA through `web/server/serve.mjs` (Node `http`, no dependencies), not nginx. Per HTML request it calls `GET /api/v1/seo/meta?path=` (`api/src/services/seo.service.ts`, real rows only) and injects `<title>`, description, robots, canonical, Open Graph/Twitter tags and JSON-LD (`Product` + `Offer` with live INR price and availability only — no condition, rating or review fields — `BreadcrumbList`, `Organization`/`WebSite`) between `<!--seo:start-->`/`<!--seo:end-->` in `index.html`, plus a `<noscript>` block with the page heading, a text summary and real links. Unknown/retired products and categories return **HTTP 404**; private routes get `X-Robots-Tag: noindex, nofollow`. Catalog search/filter/sort/page variants canonicalize to `/products` (or the category) with `noindex, follow`. Non-canonical paths (trailing slash, `//`, upper-case catalog paths) 301 to the canonical. If the API is unreachable the generic shell is served (1.5 s timeout). The same server proxies `/api/*`, `/assets/products/*`, `/sitemap.xml`, `/robots.txt` to the API so the browser uses one origin, and sets the document CSP (`script-src 'self'`, `frame-ancestors 'none'`, …). On SPA navigation `src/lib/head.ts` keeps title/description/canonical/robots in sync. **Limitation:** body content is still client-rendered; crawlers that don't run JavaScript see the injected head + `<noscript>` summary, not the full product grid. In dev (Vite) there is no injection — the SEO surfaces are exercised through the API, the server's tests, and a manual run of `serve.mjs` against the built bundle.
- **Code splitting (Phase 11):** home, catalog and product detail are in the entry chunk; cart, checkout, payment, orders, account, help and the whole admin module are `React.lazy` chunks. Hashed bundles live under `/static/` (Vite `assetsDir`) so they never collide with `/assets/products/*`.

## 3. Backend architecture (Node.js + Express + TypeScript)

Layering, strict one direction:

```
routes → controllers → services → repositories/data access → Prisma → PostgreSQL
```

- **routes/** — mount paths + middleware chains (session, rate limit, guards). Thin; no business rules in route handlers.
- **controllers/** — HTTP concerns only: validate input with **Zod** schemas, call services, map results/errors to the HTTP envelope (§7). No business logic here.
- **services/** — all business logic in exactly one place: pricing math, cart rules, inventory deduction, order state machine, guest-cart merge, search/filter/sort construction. The only layer allowed to compute money.
- **repositories/** — Prisma queries encapsulated (index-conscious shapes, no ad-hoc client calls from services); parameterized by construction.
- **prisma/** — `schema.prisma` mirrors `docs/DATABASE_SCHEMA.md` (entities, constraints, enums — no business redesign); Prisma Migrations track every change.
- **core/** — config from environment (no secrets in repo), session store, logging with request ids, security middleware (helmet-style headers, CORS allowlist, CSRF defense), error envelope renderer.

**Money rule:** `NUMERIC` in PostgreSQL → `Decimal` through Prisma → decimal-safe arithmetic in services (a decimal math utility, never float math), exact decimal strings on the wire. The sorting path orders on the numeric column, never a cast-to-string comparison (§7.1 law stands).

## 4. Cross-cutting rules

- **Authoritative backend:** every endpoint that touches price, total, stock, or role recomputes server-side. Zod schemas strip/reject unknown money fields in request bodies (§12.1).
- **Stock:** deduction happens inside one transaction per order — `prisma.$transaction` with `SELECT … FOR UPDATE` row locks (raw SQL inside the transaction where locking must be explicit); a failed condition rolls the whole order and writes a `stock_adjustments` audit row for the attempt.
- **Sessions:** httpOnly + Secure + SameSite cookie sessions issued by the API — **the v1 decision; JWT is not used** (switching requires explicit approval later). Every visitor gets a session: guests unauthenticated (their temporary cart keys off it), users authenticated, admins role-gated. Session state lives server-side (Postgres-backed store) for instant revocation; session identifier rotated at login, before the guest cart merge runs. The SPA sends credentials (`credentials: "include"`) and never stores auth state in localStorage.
- **Authz guards:** `requireUser`, `requireAdmin` middleware at the route level, plus per-resource ownership checks inside services (object-level authz, §11.6).
- **CORS + cookies:** the API allowlists the web origin; the SPA and API share a site boundary so cookies flow without third-party cookie problems.

## 5. Checkout flow (the critical path)

```
POST /api/v1/checkout                    (authenticated sessions only — guests get 401, login first)
  → load cart (user's persistent cart; guest cart already merged at login)
  → Zod validation of the (nearly empty) request body
  → revalidate every line (active + stock)      ── fail → per-line reasons, HTTP 409
  → compute subtotal / discounts / shipping / total in one decimal-safe pass (INR)
  → prisma.$transaction:
      → SELECT products FOR UPDATE per line
      → conditional stock decrement per line     ── fail → ROLLBACK, HTTP 409
      → INSERT order + order_items snapshots + stock_adjustments('sale') rows
      → order.payment_status = PENDING_PAYMENT   (no gateway in v1)
  → return order_number, totals snapshot, status
```

No partial orders: any line failure rolls back the entire transaction — order insert, snapshots, and every stock decrement together. Payment is never captured here; the order is created `PENDING_PAYMENT` and proceeds per §5.5.

**As implemented (Phase 9, `services/checkout.service.ts`):** the request body is `{address_id}` only (strict Zod — money/status/owner fields are rejected). Inside one `prisma.$transaction`: (1) `SELECT … FOR UPDATE` on the user row serializes one user's checkouts (double-click / two tabs → one order, the rest see `cart_empty`); (2) cart + owned address re-read; (3) product rows locked `FOR UPDATE` in ascending id order (no deadlocks between concurrent buyers); (4) status/stock re-checked — failures return `409 stock_shortage` or `cart_stale` with per-line `details`; (5) conditional `UPDATE … WHERE stock_quantity >= qty` per line + `stock_adjustments('sale')` row; (6) order number `HEY-YYMMDD-####` from a per-day advisory lock (India time); (7) order + `order_items` snapshots + shipping snapshot + `order_status_history (∅ → pending)`; (8) purchased cart lines deleted. Two buyers racing for the last unit: exactly one order, stock 0, the other gets `stock_shortage` and keeps their (now flagged) bag — verified with parallel requests against real PostgreSQL. Shipping v1: flat `SHIPPING_FLAT_RATE` (default ₹99), free when the discounted total ≥ `SHIPPING_FREE_THRESHOLD` (default ₹2,999).

**Status ladder** (`services/order.service.ts`, single definition): `pending → confirmed → shipped → delivered`, `pending|confirmed → cancelled`; illegal moves → `409 illegal_transition`; every move audited. No customer route changes order status — the ladder function is for admin order management.

**Cancellation restock (Phase 10, `transitionOrderStatus`).** One transaction: lock the order row (`FOR UPDATE`) → re-check the ladder → lock the ordered products in ascending id order (same order as checkout, so the two can't deadlock) → `stock_quantity + qty` per product with one `stock_adjustments('cancel_restore')` row each → set `cancelled` + `cancelled_at` → history row (note includes the units returned; a paid order's note flags the offline refund). A second cancel waits on the row lock, then sees `cancelled` and is refused by the ladder, so stock is restored exactly once — verified with four parallel cancels against real PostgreSQL.

## 5.6 Admin module (Phase 10)

- **Routing.** `routes/admin.routes.ts` mounts `/api/v1/admin` with a single `ensureSession → requireAdmin → csrfProtect` chain, so no admin route can be added without the gate. The role comes from the `users` row resolved for the session on each request.
- **Services.** `admin-catalog.service.ts` (products, images, categories), `admin-ops.service.ts` (dashboard, inventory, stock adjustments, orders, users), `settings.service.ts`. Read models live in `repositories/admin.repository.ts` (aggregates and filters in SQL, always paged). Order moves reuse `transitionOrderStatus`; payment uses `PaymentService.confirmManually` — the same service that owns demo payments, so `payment_status` still has one writer.
- **Audit.** Order/payment moves → `order_status_history` (actor ADMIN + id); stock → `stock_adjustments`; everything else (catalog, images, categories, users, settings) → `admin_audit_log`, written in the same transaction as the change.
- **Stock.** Adjustments lock the product row, apply a conditional `UPDATE … WHERE stock_quantity + delta >= 0`, and write the audit row in the same transaction. The products PATCH schema has no stock field.
- **Images** (`lib/images.ts`). multer memory storage (nothing hits disk before validation) → magic-byte sniff (JPEG/PNG/WebP) → sharp decode must agree, ≤ 40 MP, ≥ 200 px → auto-orient, fit ≤ 2000 px, re-encode WebP q85 (EXIF/GPS/ICC/XMP and trailing bytes dropped) → write `UPLOAD_DIR/products/<id>/<uuid>.webp` with `wx`. Served by Express at `/assets/products` (static, no index, no dotfiles, `nosniff`, `CSP: default-src 'none'; sandbox`); Vite proxies `/assets` in dev and `web/server/serve.mjs` in production. Files are removed only for paths matching the generated pattern, after the DB change commits.
- **Settings.** One `store_settings` row; absent row = documented defaults (5 units, env shipping ₹99 / ₹2,999, newest, 12). Read per request (single-row lookup) by checkout totals, the catalog controller, inventory, and dashboard — no cache to go stale.
- **Blocking** deletes every session of the user in the same transaction; `ensureSession` already ignores blocked users and login refuses them.
- **Web.** `web/src/admin/*`: `AdminLayout` (own shell; the role check there is UX only), pages per route, `ui.tsx` shared states/badges/dialog/pagination, `api/admin.ts` typed client (multipart through the shared `apiRequest`).

## 5.8 Production hardening (Phase 12)

- **Config gate.** `config/env.ts` validates shape (Zod) and, for `NODE_ENV=production`, deployment rules (`productionProblems`): https + non-localhost origin-only `API_ALLOWED_ORIGIN`/`PUBLIC_SITE_URL` that are the same origin, non-placeholder `SESSION_SECRET`, password in `DATABASE_URL`, explicit `TRUST_PROXY_HOPS` (0–5, never `true`), `PAYMENT_MODE=demo` refused unless `ALLOW_DEMO_PAYMENT_IN_PRODUCTION=I_UNDERSTAND_NO_REAL_PAYMENTS`, admin idle ≤ customer idle, auth limit ≤ 100. Problems are listed by name, values never echoed; the process exits 1.
- **Startup/shutdown (`server.ts`).** Upload root created + writability checked → DB `SELECT 1` with 10 × 2 s retries → listen (header/request/keep-alive timeouts set). SIGTERM/SIGINT: `server.close`, idle sockets closed, Prisma disconnected, 10 s forced-exit guard. Migrations are a deploy step (`prisma migrate deploy` in the image CMD), never run by the server.
- **Errors.** Envelope unchanged; additions: malformed JSON → `400 validation_failed`, body > 100 kB → `413 payload_too_large`, Prisma connection/pool errors → `503 service_unavailable` + `Retry-After`; 500s carry `requestId`; Zod `details` are `{path, message, code}` only (no echoed input).
- **Logging (`lib/logger.ts`).** JSON lines in production, recursive key-based redaction + free-text scrubbing (connection-string passwords, session/CSRF cookies, Postgres row dumps). Access log omits query strings. `X-Request-Id` reused from the web server when it is a safe token.
- **Storage (`lib/storage.ts`).** `ImageStorage` interface (`put`/`remove`), `LocalDiskStorage` implementation; only generated keys are resolvable, inside the root. Future shared storage replaces the implementation, not the API.
- **Web server.** gzip for HTML/JS/CSS/JSON/SVG (cached per file), `.map` never served, security headers on every response including 301/405/health, request-id generation/forwarding, client `X-Forwarded-For` discarded unless `TRUST_UPSTREAM_PROXY=1`, graceful SIGTERM.

## 5.7 Launch hardening (Phase 11)

- **Headers.** API: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/payment/usb off), COOP, a deny-all CSP on JSON responses, HSTS when `NODE_ENV=production`; product images keep `default-src 'none'; sandbox`. Web server: document CSP + the same frame/referrer/permissions headers. `trust proxy` = 1 in production so rate limits key on the client IP behind the web server.
- **Rate limits.** Auth 10/min/IP (unchanged); public catalog reads (`/products`, `/categories`) `CATALOG_RATE_LIMIT_MAX` per minute per IP (default 300). Both are in-process (single instance).
- **Admin idle timeout.** `resolveSession` reads the session's user role and applies `ADMIN_SESSION_IDLE_TTL_MINUTES` (default 60) to ADMIN sessions; customers keep `SESSION_IDLE_TTL_HOURS` (24). The absolute 7-day ceiling applies to both.
- **Seed artwork.** The seeded image rows used to point at `products/*.svg` files that never existed (every image 404'd). `api/prisma/seed-artwork.ts` now renders two labelled placeholder plates per product (product name, category, "Photography coming soon" — clearly not photographs) through sharp into `UPLOAD_DIR/products/seed/<sku>-<n>.webp`, the same tree and static route as admin uploads. Generation is skipped when the file exists (`SEED_ARTWORK_REFRESH=1` forces it).
- **Policy pages.** `store_pages` + `services/store-pages.service.ts`: five fixed slugs, text written by the business in admin → Pages, rendered by `web/src/pages/PolicyPage.tsx` as escaped paragraphs. Unpublished → honest "not published yet" page, `noindex`, no footer link, not in the sitemap.
- **Upload storage.** Local disk under `UPLOAD_DIR` (a named volume in compose). Fine for local, demo and **single-server** deployments; **multiple API instances need shared/object storage** — not built.
- **Docker.** Root build context (npm workspaces share one lockfile); api image runs `prisma migrate deploy` then the server, as `node`, with a `/healthz` healthcheck; web image runs `serve.mjs` as `node` with `/healthz-web`; compose wires `API_ORIGIN=http://api:4000`, `PAYMENT_MODE=manual`, `PUBLIC_SITE_URL`, binds Postgres to localhost. Not executed here (Docker unavailable).

Guest carts merge into the user cart on login (server union, duplicate lines qty-summed, quantities capped by stock, unavailable products dropped — one transaction, §3 services).

## 5.5 Payment abstraction (v1: demo simulation only)

```
Checkout → Order Service → PaymentService (abstraction) → PaymentProvider interface
                                                            ├── DemoPaymentProvider   (v1 — demo environments only)
                                                            └── RealPaymentProvider   (future — same interface, not built)
```

- **PaymentService** is the single module behind payment-status transitions; it exposes `confirm(order) → PAID` and `fail(order) → stay PENDING_PAYMENT` semantics to its callers.
- **DemoPaymentProvider** (v1): deterministic simulate-success / simulate-fail. It never contacts any external service, never processes money, never stores credentials. It is the only customer-reachable `PENDING_PAYMENT → PAID` path — and only in demo mode.
- **Future RealPaymentProvider** implements the identical interface; orders, checkout, order history, and admin order management are untouched when it arrives.
- **Mode gating:** payment mode comes from environment configuration (`PAYMENT_MODE=demo|manual`):
  - `demo` → demo endpoints mounted, demo payment page active (`/payment/demo/{order-id}`), demo transitions audited;
  - `manual` → demo endpoints **unmounted (404)**, demo route inert; only admin manual confirmation exists;
  - production deploys with `PAYMENT_MODE=manual` — the deployment checklist verifies it.
- **Demo flow UX (frontend, React):** after checkout success React Router navigates to `/payment/demo/{order-id}` — HEYRAH-branded demo payment page (order summary, INR total, mock method selector Demo Card/UPI/QR, prominent "Pay ₹X (Demo)", always-visible "DEMO / TEST MODE" indicator) → restrained processing sequence ("Securing your payment…" → "Processing…" → "Payment confirmed", reduced-motion safe) → deterministic success (order `PAID`, continue/view-order actions) or simulated failure (order stays valid + `PENDING_PAYMENT`, retry, no broken order). The page never renders fields shaped like real payment inputs — no card numbers, CVV, UPI PIN, banking passwords — only the mock selector.
- Audit: every transition through the abstraction writes to `order_status_history` (actor + mode), so "how did this get PAID?" is always answerable.
- **As implemented (Phase 9, `services/payment.service.ts`):** `PaymentProvider` (`mode`, `instructionsFor(order)`) with `DemoPaymentProvider` and `ManualPaymentProvider`; `PaymentService.recordAttempt` is the only code that sets `payment_status`. It locks the caller's own order, refuses cancelled orders (`409 not_payable`), treats a repeated success on a PAID order as a no-op (idempotent — parallel confirms record exactly one PAID row), refuses a failure report after PAID (`409 already_paid`), and records failures as `PENDING_PAYMENT → PENDING_PAYMENT` with a note. Payment rows in `order_status_history` use the uppercase payment values. `PAYMENT_MODE` defaults to `manual`; `api/.env` sets `demo` locally; `deploy/docker-compose.yml` sets `manual`. The demo routes are only registered when the service is in demo mode. A real provider adds a new `PaymentProvider` (provider order in `instructionsFor`, verified callback → `recordAttempt`) without touching cart, checkout, orders, or history.
- **Demo sheet (web, `pages/DemoPaymentPage.tsx`):** "Pay ₹X (Demo)" → pressed state → native `<dialog>` sheet rises over a dimmed page (docks to the bottom edge on mobile) → "Securing your payment…" → "Connecting securely…" → Demo Card / UPI / QR choice → "Securing your payment…" → "Processing…" → drawn check "Payment confirmed" → success page. Steps are announced in a polite live region; reduced-motion users get the same steps (shorter, no movement). Failure shows "Payment unsuccessful" with Try again (back to the method choice). Modelled on hosted gateway sheets (branded header band with amount, short status steps) — no provider SDK, no credential fields.

## 6. Search / filter / sort shape

Single catalog endpoint builds one Prisma query from composed predicates: `WHERE` (search tokens + category set + price bounds + in-stock), `orderBy` on numeric columns with deterministic tie-breakers `(created_at desc, id desc)`, then `skip/take` pagination. All three concerns resolve before pagination — that ordering is the requirement, not a suggestion (§7.3).

## 7. Error + response conventions

- Error envelope: `{ "error": { "code", "message", "details?" } }` — stable machine codes (`stock_shortage`, `invalid_credentials`, `authentication_required`, …), human message safe to show, no stack traces or SQL in production responses (§12.7). Zod validation failures map to `validation_failed` with field details.
- Success envelope for lists: `{ "items": [...], "page", "page_size", "total_items", "total_pages" }`.
- IDs in URLs; timestamps ISO-8601 UTC; currency amounts serialized as strings of exact decimals (no float drift on the wire).

## 8. Observability & operations

- Structured logs: request id in/out headers, security events (§12.9), oversell attempts flagged.
- `GET /healthz` — Prisma DB roundtrip check, used by Docker healthcheck.
- Prisma Migrations run on deploy; backup story required before any real data exists (§14 reliability).

## 9. Repository layout (planned)

```
/heyrah
├── AGENTS.md, docs/            ← current phase lives here
├── public/brand/               ← logo reference (locked)
├── web/                        ← React + Vite SPA (storefront + admin)
├── api/                        ← Express + TypeScript API (Prisma inside)
└── deploy/                     ← compose + env templates
```

## 10. Testing strategy (mapped to REQUIREMENTS §15)

- **Vitest** — frontend unit tests + backend service-layer tests (pricing, rounding, cart rules) + API integration tests against a real PostgreSQL test DB (sorting law, authz matrix, guest-cart merge, concurrency with real parallelism). One runner across the repo, consistent style.
- **Playwright** — end-to-end: storefront flows, admin flows, mobile/tablet/desktop viewports, keyboard-only purchase path, demo payment journey.
- CI gates every push; the (C)-tagged acceptance criteria are named test cases, not vibes.
