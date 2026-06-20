# HEYRAH

**Wings of Style** — a premium e-commerce platform.

HEYRAH is built as a real commercial product: a React storefront, an Express API
that owns all business truth (prices, stock, sessions, payments), and PostgreSQL
as the single source of record.

## Stack (PERN)

| Layer     | Technology                                        |
| --------- | ------------------------------------------------- |
| Frontend  | React 19 + TypeScript + Vite + React Router       |
| Backend   | Node.js + Express 5 + TypeScript (ESM)            |
| Database  | PostgreSQL 16                                     |
| ORM       | Prisma                                            |
| Validation| Zod (env + request bodies, server-side authority) |
| Tests     | Vitest (unit/integration), Playwright (e2e)       |
| Deploy    | Docker Compose (postgres + api + web)             |

Architecture and layering rules live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md);
the canonical stack decision is [`docs/TECH_STACK.md`](docs/TECH_STACK.md).

## Current scope

This repository is under active development, phase by phase. Right now it
contains:

- Project documentation (`docs/` — requirements, architecture, schema, API contract, design system, ADRs)
- `web/` — Vite + React scaffold with a scaffold-verification page and an env-driven API client
- `api/` — Express app factory with request-id logging, hardened CORS, error envelope, and `GET /healthz` (real PostgreSQL roundtrip)
- `deploy/` — Docker Compose for the full stack
- `tests/e2e/` — Playwright smoke suite across the whole chain

Storefront features (catalog, cart, checkout, accounts, admin) land in the
phases that follow — see `docs/REQUIREMENTS.md` for the full picture.

## Prerequisites

- Node.js 22+
- PostgreSQL 16 (local install, portable binaries, or Docker)
- Docker Desktop (optional, for `deploy/docker-compose.yml`)

## Setup

```bash
# 1. Install dependencies (npm workspaces: web + api)
npm install

# 2. Configure environment — copy and adjust
cp .env.example api/.env
cp .env.example web/.env   # keep only VITE_API_URL for the web app

# 3. Point DATABASE_URL at your PostgreSQL and create the database, e.g.
#    postgresql://postgres@localhost:5432/heyrah_dev

# 4. Generate the Prisma client
npm exec --workspace api prisma generate
```

### Local PostgreSQL without Docker

This repository's development setup uses portable PostgreSQL binaries in
`local/postgres` (gitignored) with the data directory at `local/pgdata`:

```bash
local\postgres\bin\initdb.exe -D local\pgdata -E UTF8 -A trust -U postgres
local\postgres\bin\pg_ctl.exe -D local\pgdata -o "-p 5432" -l local\pg.log start
```

## Run

```bash
npm run dev:api   # Express on http://localhost:4000
npm run dev:web   # Vite on http://localhost:5173
```

Health check: `GET http://localhost:4000/healthz` → `{"status":"ok","database":"up",...}`
(503 + `degraded` when the database is unreachable.)

## Tests

```bash
npm run test        # Vitest: web (jsdom) + api (supertest) suites
npm run typecheck   # tsc --noEmit in both workspaces
npm run lint        # ESLint in both workspaces
npm run test:e2e    # Playwright smoke (boots api + web itself; start PostgreSQL first)
```

## Docker

```bash
cd deploy
docker compose up --build
# web → http://localhost:8080, api → http://localhost:4000
```

Docker was not available in the original development environment, so the
compose file is provided but unverified locally — verify on a machine with
Docker before relying on it.
