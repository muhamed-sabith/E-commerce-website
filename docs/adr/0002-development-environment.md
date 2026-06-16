# ADR 0002 — Development Environment & Dependency Map

**Date (recorded):** Jun 21, 2026 · **Status:** Accepted
**Depends on:** ADR 0001

## Local environment

- Python 3.12 + `venv`, Node 20 LTS + npm — versions pinned in `.nvmrc` / `runtime.txt` equivalents once scaffolding exists.
- PostgreSQL 16 via Docker; `docker compose up db` for dev. No production data locally, ever.
- `.env` files for config — gitignored from day one (REQUIREMENTS §12.5); a committed `.env.example` carries names only, never values.
- Test database is separate (`heyrah_test`), reset per CI run.

## Dependency map (roles, not versions — versions land with the scaffold)

| Layer | Dependency | Role |
|---|---|---|
| api | fastapi, uvicorn | HTTP surface |
| api | pydantic | request/response validation, Decimal enforcement |
| api | sqlalchemy, alembic | persistence + migrations |
| api | psycopg[binary] | PG driver |
| api | passlib[argon2] or bcrypt | password hashing per §11.3 |
| api | pytest, httpx, pytest-asyncio | unit + API integration + concurrency tests |
| web | next, react, typescript | storefront/admin |
| web | eslint, prettier | style gates in CI |
| tooling | docker compose | local + deploy shape |
| e2e | playwright | responsive + keyboard-only flows |

## Conventions locked for scaffolding

- Repo layout per ARCHITECTURE §9: `/web`, `/api`, `/docs`, `public/brand` untouched as brand-locked asset path.
- CI (added in the hardening phase, not now): lint → unit → integration (test DB) → build, on every push.
- One `.editorconfig` for shared spacing/EOL sanity; gitattributes already normalizes.

## Non-decisions

Hosting provider, CDN, and mail infra stay open (REQUIREMENTS §18) — nothing here blocks documentation or scaffolding phases.
