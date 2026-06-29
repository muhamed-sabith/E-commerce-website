# HEYRAH — Project Status

- **Project:** HEYRAH — Women's Fashion E-commerce
- **Approved stack:** PERN + TypeScript (PostgreSQL, Express, React + Vite, Node.js; Prisma, Vitest, Playwright)

## Phase 1 — Requirements & brand foundation
- Project foundation, brand guidelines, logo reference (`public/brand/`)
- `docs/REQUIREMENTS.md`: user/admin modules, commerce rules, acceptance criteria
- MIT license, `.gitignore`

## Phase 2 — Architecture, schema, API contract
- `docs/ARCHITECTURE.md`: layers, data flow, deployment shape
- `docs/DATABASE_SCHEMA.md`: products, users, orders, stock, carts; ERD; money as numeric with DB checks
- `docs/API_CONTRACT.md`: catalog, cart, checkout, admin endpoints; error envelope, pagination, money as strings
- Demo payment simulation spec; final consistency pass across docs

## Phase 3 — Stack decision & environment
- ADR 0001 (tech stack), ADR 0002 (dev environment, dependency map)
- PERN stack approved; docs synchronized; `docs/TECH_STACK.md`
- `.editorconfig`

## Phase 4 — Scaffold & tooling
- npm workspaces: `web` (React/Vite) + `api` (Express/Prisma/Vitest)
- Root tsconfig, env template, lockfile
- Playwright e2e smoke, Docker deploy, README

## Phase 5 — Catalog
- Prisma catalog models + migration with DB-level integrity; deterministic seed (6 categories, 24 products)
- Catalog API: search, category/price/availability filters, true numeric price sort, pagination
- Storefront: catalog grid, filters in URL state, product detail, teal/gold design tokens
- Verified: API catalog tests + Playwright smoke (sort ascending, search, filter, out-of-stock, inactive 404)

## Phase 6 — Authentication & account
- Server-side cookie sessions (hashed tokens in Postgres, rotation on login, absolute + idle expiry)
- Register, login, logout, `/auth/me`, CSRF double-submit, rate limiting, generic login failures
- Account: change password, update profile; USER/ADMIN separation server-side; admin bootstrap script
- Storefront sign-in, registration, account pages; `docs/AUTHENTICATION.md`
- Verified: API auth tests + 6 Playwright auth e2e (reload persistence, protected redirect, keyboard, mobile)

## Phase 7 — Cart
- Backend: `carts` / `cart_items` migration (user XOR session CHECK, qty 1–99 CHECK, unique session token)
- Cart API: `GET /cart`, `POST/PATCH/DELETE /cart/items`; prices, discounts, stock, totals recomputed server-side; ownership + CSRF enforced
- Guest cart keyed by session; guest → user merge on login/register in one transaction (sum duplicates, cap to stock, drop unavailable) with `merge_report`
- Frontend: typed cart API, server-derived cart state, Cart page (quantity stepper, remove, totals, empty/loading/error states), add-to-bag on product detail + catalog cards, header bag count, merge notice
- Feminine refinement: ivory/blush/rose tokens, serif display, softer cards, pill controls
- Fixes found in testing: stale-session recovery via `/auth/csrf`, login rotation race, catalog duplicate price, 375px catalog overflow
- Verified: API 74/74, web Vitest 24/24, Playwright 20/20; typecheck, lint, build clean

## Phase 8 — Wishlist + Address Management
- Migration `wishlist_addresses`: `wishlists` (composite PK user+product, no price snapshot), `addresses` (schema §2.8 fields); partial unique index = one default per user; country-code + non-blank CHECKs
- Wishlist API (USER-only): `GET /wishlist`, `POST /wishlist/items`, `DELETE /wishlist/items/:id`; idempotent add; live price/final price/availability/purchasable; hidden products 404 on add, flagged `unavailable` if saved earlier
- Address API (USER-only): `GET/POST /addresses`, `PATCH/DELETE /addresses/:id`, `POST /addresses/:id/default`; strict Zod (no mass assignment), phone/postal/ISO country rules (IN PIN = 6 digits)
- Default rules: first address auto-default; set-default clears previous in one transaction (user row lock); deleting the default with others requires `new_default_id` (`409 default_reassignment_required`); deleting the only address allowed
- Foreign ids → 404 on every route; CSRF on mutations; `Cache-Control: private, no-store`
- Frontend: Wishlist page, Save toggle on product detail + catalog cards (guest → sign-in), header Wishlist link, address book at `/account/addresses` (form with inline validation, default badge, delete dialog with replacement choice), account page links
- Fixes found in testing: Phase 7 bag image path (`/assets/`), signed-in header wrapping at 1280/1440px, header labels breaking at 375px, Arial fallback on account buttons
- Verified: API 115/115, web Vitest 46/46, Playwright 33/33; typecheck (api, web, root), lint, build clean; migrations up to date on dev + test

## Current next phase
**Phase 8 — checkout (planned next)** — guest + user checkout flow with server-side totals

## Remaining issues / notes
- Phase 8 work is not yet committed or pushed
- Seed product images don't load; branded placeholders show everywhere
- Address form offers 8 countries (API accepts any ISO alpha-2); postal format strict only for India
- Mobile header is tall at 375px (~340px) — no collapsible menu yet
- Auth rate limit (30/min locally) can fail back-to-back full e2e runs within 60s
- Local Postgres must be started detached (`Start-Process pg_ctl …`) or it crash-loops
- Accessibility verified by automation + keyboard e2e only; no screen-reader pass yet
- Guest-merge keys off the pre-rotation cookie, not the `rotated_from` audit chain
