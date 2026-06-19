# HEYRAH — Architecture Document

**Status:** v1.1 — synchronized with final v1 decisions (cookie sessions, no real gateway, demo payment simulation)
**Depends on:** `docs/REQUIREMENTS.md`, `docs/DATABASE_SCHEMA.md`

---

## 1. System overview

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│  Next.js (TypeScript)       │      │  FastAPI (Python)            │
│  storefront + admin UI      │─────▶│  REST API /api/v1            │
│  SSR/pre-render for SEO     │      │  auth, catalog, cart,        │
│  design tokens (teal/gold)  │      │  checkout, admin services    │
└─────────────────────────────┘      └───────────┬──────────────────┘
        browser only ever sees                 ┌──┴──────────┐
        Next-rendered pages + safe JSON        │ PostgreSQL  │
                                               │ + migrations│
                                               └─────────────┘
```

Three deployable shapes via Docker Compose: `web` (Next.js), `api` (FastAPI + Uvicorn), `db` (PostgreSQL). Object storage for product images (local volume in dev, provider in production — decision later).

## 2. Frontend architecture

- **One Next.js app, two route trees:** `(storefront)/…` for customers, `(admin)/admin/…` for operators. Admin route tree is server-guarded by role, but that guard is UX — real enforcement lives in the API (§5).
- **Server components by default** for storefront pages (SEO: titles, meta, product structured data, SSR-able catalog), client components only where interactivity demands (cart controls, filter panel, gallery).
- **API access layer:** a typed client module wrapping `/api/v1`; components never hand-roll `fetch` URLs. Prices/stock/totals arrive from the API and are displayed as-is — the frontend performs no money math beyond formatting.
- **Design tokens as CSS variables:** `--color-teal-*`, `--color-gold-*`, spacing scale (4/8px), type scale — derived from the logo reference in a dedicated design-system doc (next phase). No raw hex scattered in components.
- **State:** server state via the API client + light caching; cart count / wishlist toggles are tiny client stores; nothing security-relevant lives in localStorage.

## 3. Backend architecture (FastAPI)

Layering, strict one direction: `routers → services → repositories/models → DB`.

- **routers/** — HTTP surface: request schemas (Pydantic), status codes, auth dependencies. Thin; no business rules here.
- **services/** — all business logic in exactly one place: pricing math, cart rules, inventory deduction, order state machine, search/filter/sort construction. The only module allowed to compute money.
- **repositories/** — SQLAlchemy queries; parameterized only (REQUIREMENTS §12.8); owns the index-conscious query shapes.
- **models/** — schema per DATABASE_SCHEMA.md; Alembic migrations track every change.
- **core/** — config from environment (no secrets in repo), logging with request ids, security middleware, error envelope renderer.

## 4. Cross-cutting rules

- **Authoritative backend:** every endpoint that touches price, total, stock, or role recomputes server-side. Client-supplied amounts are rejected at the schema layer (extra fields ignored/denied per §12.1).
- **Money:** `Decimal` end-to-end — Pydantic `condecimal`, DB `NUMERIC`, rounding half-up applied once, at the display-totaling boundary. The sorting path orders on the numeric column, never a cast-to-string comparison.
- **Stock:** deduction happens inside one transaction per order; the update is conditional (`stock_quantity >= qty`) with row locking; a failed condition rolls the whole order and writes a `stock_adjustments` audit row for the attempt.
- **Sessions:** httpOnly + SameSite cookie sessions issued by the API — **the v1 decision; JWT is not used** (switching would require explicit approval later). Every visitor gets a session: guests unauthenticated (their temporary cart keys off it), users authenticated. Role claims resolved server-side per request; session state lives server-side for instant revocation; Next.js proxies the cookie on server-rendered routes. Session identifier rotated at login, before the guest cart merge runs.
- **Authz dependency:** two guards — `require_user`, `require_admin` — injected at the router level, plus per-resource ownership checks inside services (object-level authz, §11.6).

## 5. Checkout flow (the critical path)

```
POST /api/v1/checkout                    (authenticated sessions only — guests get 401, login first)
  → load cart (user's persistent cart; guest cart already merged at login)
  → revalidate every line (active + stock)      ── fail → per-line reasons, HTTP 409
  → compute subtotal / discounts / shipping / total in one Decimal pass (INR)
  → BEGIN TX
      → SELECT products FOR UPDATE
      → conditional stock decrement per line     ── fail → ROLLBACK, HTTP 409
      → INSERT order + order_items snapshots + stock_adjustments('sale') rows
      → order.payment_status = PENDING_PAYMENT   (no gateway in v1)
    COMMIT
  → return order_number, totals snapshot, status
```

No partial orders: any line failure rolls back the entire transaction — order insert, snapshots, and every stock decrement together. Payment is never captured here; the order is created `PENDING_PAYMENT` and proceeds per §5.5.

Guest carts merge into the user cart on login (server union, duplicate lines qty-summed, quantities capped by stock, unavailable products dropped — one transaction).

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
- **Demo flow UX (frontend, Next.js):** after checkout success the client routes to `/payment/demo/{order-id}` — HEYRAH-branded demo payment page (order summary, INR total, mock method selector Demo Card/UPI/QR, prominent "Pay ₹X (Demo)", always-visible "DEMO / TEST MODE" indicator) → restrained processing sequence ("Securing your payment…" → "Processing…" → "Payment confirmed", reduced-motion safe) → deterministic success (order `PAID`, continue/view-order actions) or simulated failure (order stays valid + `PENDING_PAYMENT`, retry, no broken order). The page never renders fields shaped like real payment inputs — no card numbers, CVV, UPI PIN, banking passwords — only the mock selector.
- Audit: every transition through the abstraction writes to `order_status_history` (actor + mode), so "how did this get PAID?" is always answerable.

## 6. Search / filter / sort shape

Single catalog endpoint builds one SQL query from composed predicates: `WHERE` (search tokens + category set + price bounds + in-stock), `ORDER BY` numeric columns with deterministic tie-breakers `(created_at DESC, id DESC)`, then `LIMIT/OFFSET` pagination. All three concerns resolve before pagination — that ordering is the requirement, not a suggestion (§7.3).

## 7. Error + response conventions

- Error envelope: `{ "error": { "code", "message", "details?" } }` — stable machine codes (`stock_shortage`, `invalid_credentials`, …), human message safe to show, no stack traces or SQL in production responses (§12.7).
- Success envelope for lists: `{ "items": [...], "page", "page_size", "total_items", "total_pages" }`.
- IDs in URLs; timestamps ISO-8601 UTC; currency amounts serialized as strings of exact decimals (no float drift on the wire).

## 8. Observability & operations

- Structured logs: request id in/out headers, security events (§12.9), oversell attempts flagged.
- `GET /healthz` — DB roundtrip check, used by Docker healthcheck.
- Versioned migrations run on deploy; backup story required before any real data exists (§14 reliability).

## 9. Repository layout (planned)

```
/heyrah
├── AGENTS.md, docs/            ← current phase lives here
├── public/brand/               ← logo reference (locked)
├── web/                        ← Next.js app
├── api/                        ← FastAPI app
└── deploy/                     ← compose + env templates (docs phase only)
```

## 10. Testing strategy (mapped to REQUIREMENTS §15)

- pytest — service-layer unit tests (pricing, rounding) + API integration tests against a real test DB (sorting law, authz matrix, concurrency with real parallelism).
- Playwright — storefront flows at mobile/tablet/desktop viewports + keyboard-only path.
- CI gates every push; the (C)-tagged acceptance criteria are named test cases, not vibes.
