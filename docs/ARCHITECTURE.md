# HEYRAH — Architecture Document

**Status:** draft — documents phase, no implementation exists yet
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
- **Sessions:** httpOnly + SameSite cookie session issued by the API; role claims resolved server-side per request; Next.js proxies the cookie on server-rendered routes. (JWT alternative documented in stack ADR; session chosen for revocability.)
- **Authz dependency:** two guards — `require_user`, `require_admin` — injected at the router level, plus per-resource ownership checks inside services (object-level authz, §11.6).

## 5. Checkout flow (the critical path)

```
POST /api/v1/checkout
  → load cart (session or user)
  → revalidate every line (active + stock)      ── fail → per-line reasons, HTTP 409
  → compute subtotal / discounts / shipping / total in one Decimal pass
  → BEGIN TX
      → SELECT products FOR UPDATE
      → conditional stock decrement per line     ── fail → ROLLBACK, HTTP 409
      → INSERT order + order_items snapshots + stock_adjustments('sale') rows
    COMMIT
  → return order_number, totals snapshot, status
```

Guest carts merge into the user cart on login (server union, qty capped by stock).

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
