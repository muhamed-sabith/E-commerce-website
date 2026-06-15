# ADR 0001 — Technology Stack

**Date (recorded):** Jun 21, 2026 · **Status:** Accepted
**Deciders:** project owner · **Relates to:** REQUIREMENTS §7/§9/§14, ARCHITECTURE §1

## Context

The requirements impose specific pressures: true numeric money semantics, DB-enforced non-negative stock, transactional checkout with row locking, deterministic search+filter+sort+pagination in one query, server-rendered storefront for SEO, an admin surface optimized for density, and a test matrix where concurrency oversell must be provably impossible. The stack must make the critical rules *easy and default*, not bolted on.

## Decision

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js (TypeScript), App Router** | SSR/prerender for SEO (§14), route trees for storefront vs admin, first-class image optimization |
| API backend | **FastAPI (Python 3.12)** | Pydantic schemas enforce "client never asserts money"; typed Decimal service layer; simple dependency-based authz guards |
| Database | **PostgreSQL 16** | NUMERIC money, CHECK constraints, row-level locking (`SELECT … FOR UPDATE`), partial indexes for catalog queries — the §9/§17 rules live in the DB, not in app hope |
| ORM/migrations | **SQLAlchemy 2.0 + Alembic** | explicit transaction control for checkout; versioned schema |
| Deploy | **Docker Compose** (web, api, db) → single host; health checks per ARCHITECTURE §8 |
| Testing | **pytest** (unit + API integration + concurrency) · **Playwright** (responsive + keyboard-only flows) |

## Alternatives considered

- **Django + templates** — solid admin but weaker fit for a premium SSR/React storefront.
- **Node/Express + Prisma** — fine, but JS money types (float unless decimal libs) fight §7; Python Decimal is the straight path.
- **Laravel + Blade** — quick admin, heavier to keep money/stock invariants explicit.
- **Next.js API routes only (no separate service)** — blurs the "one pricing module" boundary and complicates admin authz isolation.

## Consequences

- Two runtimes (Node + Python) — accepted trade for correctness on money paths.
- Session auth via httpOnly cookies requires the Next server to proxy auth state (documented in ARCHITECTURE §4).
- Deployment target must support Docker; hosting choice deferred to deploy phase (open decision §18.1 follow-up).
