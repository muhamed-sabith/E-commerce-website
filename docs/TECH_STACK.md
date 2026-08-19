# HEYRAH — Approved Technology Stack (v1)

**Status:** FINAL — this file is the canonical stack record.
**Supersedes:** `docs/adr/0001-technology-stack.md` (kept unmodified as the historical record of the earlier FastAPI/Next.js decision — ADRs are immutable history; this file is the live truth).

---

## The stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React + TypeScript + Vite + React Router** | SPA; storefront + admin in one app, two route trees |
| Backend | **Node.js + Express.js + TypeScript** | REST API under `/api/v1` |
| Database | **PostgreSQL** | `docs/DATABASE_SCHEMA.md` remains the relational source of truth |
| ORM | **Prisma** | models/migrations mirror the schema doc — no business redesign at the ORM layer |
| Validation | **Zod** | request/response schemas at every API boundary; unknown money fields in request bodies are rejected/ignored server-side |
| Testing | **Vitest** (frontend + backend — one runner, kept consistent) + **Playwright** (browser/E2E, responsive + keyboard flows) |
| Auth | **Secure server-side cookie sessions** — **no JWT in v1** (switching requires explicit approval later) | sessions support guests, users, admins, guest-cart identification, guest-cart merge on login, logout/revocation |
| Deployment | **Docker + Docker Compose** | `web` (built SPA served by `web/server/serve.mjs`, Node built-ins only), `api` (Express), `db` (PostgreSQL); `deploy/docker-compose.yml` local/demo, `deploy/docker-compose.prod.yml` production template; steps in `docs/PRODUCTION_RUNBOOK.md` |
| CI | **GitHub Actions** (`.github/workflows/ci.yml`) | install, Prisma `migrate deploy` on a Postgres service, typecheck, lint, web + API tests, build, audit report. No deployment |
| Currency | **INR (₹)** — single currency, store-wide constant |
| Payment | **No real payment gateway in v1** — no Razorpay/Stripe/PayPal, no SDK, no webhooks. Orders are created on the website with `payment_status = PENDING_PAYMENT`; a controlled test/demo payment flow may transition to `PAID`; real gateway is future scope behind the payment-service abstraction |

## Architecture in one line

```
React frontend  →  Express REST API  →  Prisma  →  PostgreSQL
```

Clean separation: `web/` (React + Vite) and `api/` (Express) are independent applications with independent dependencies and builds; they communicate only through the `/api/v1` JSON contract (`docs/API_CONTRACT.md`).

## Layering (backend)

```
routes → controllers → services → repositories/data access → Prisma → PostgreSQL
```

- Business logic lives in **services** — pricing, cart rules, inventory, checkout, order state, authorization. Route handlers stay thin.
- **The frontend is never the authority** for prices, totals, inventory, roles, or payment status. It displays; the server decides.

## Money rule (unchanged by the stack change)

Money is `NUMERIC`/`Decimal` in PostgreSQL, `Decimal` through Prisma, decimal-safe arithmetic in services (never float math), exact decimal strings on the wire, and **true numeric sorting on the price column** — the §7.1 law of REQUIREMENTS applies regardless of language or framework.

## Testing split

- **Vitest** — frontend unit tests + backend service/API integration tests (same runner both sides; one config style).
- **Playwright** — end-to-end: storefront flows, admin flows, mobile/tablet/desktop viewports, keyboard-only purchase path.
- Backend integration tests run against a real PostgreSQL test database.

## What this stack does NOT include (v1)

- No JWT, no refresh tokens.
- No payment SDK or provider integration.
- No server-side rendering framework (SEO is handled by the Express-served meta/prerender strategy — ARCHITECTURE §2).
- No additional state libraries beyond what the UI needs; no premature infrastructure.
