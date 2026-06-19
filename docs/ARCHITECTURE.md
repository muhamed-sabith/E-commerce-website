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
