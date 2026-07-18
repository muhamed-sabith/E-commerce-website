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

## Phase 9 — Checkout, Orders & Demo Payment — COMPLETE
- Migration `orders_inventory`: `orders`, `order_items`, `order_status_history`, `stock_adjustments`; CHECKs (status/payment enums, money arithmetic, `HEY-YYMMDD-####`); row triggers make order money/snapshots and all audit rows immutable; FKs RESTRICT. Seed clears these with TRUNCATE
- Checkout (USER-only, CSRF): `POST /checkout/preview` (live totals, per-line problems, address choice), `POST /checkout` `{address_id}` only — one transaction: user row lock (no duplicate orders), product `FOR UPDATE` in id order, conditional stock decrement + `sale` adjustment, snapshots, `∅→pending` audit, purchased cart lines removed. Shipping ₹99 flat, free ≥ ₹2,999 (env)
- Orders: `GET /orders`, `GET /orders/:id` (own only, 404 otherwise); status ladder `transitionOrderStatus` (service only, no customer route)
- Payment: `PaymentService` → `PaymentProvider` (`DemoPaymentProvider`, `ManualPaymentProvider`); `PAYMENT_MODE` default `manual`, `api/.env` = `demo`, compose = `manual`; demo `confirm`/`fail` routes registered only in demo mode; confirm idempotent, fail keeps `PENDING_PAYMENT`, cancelled not payable
- Frontend: bag Checkout (guest → sign-in/register → back to checkout), `/checkout`, `/payment/demo/:orderId` (DEMO / TEST MODE band, dialog sheet: Securing → Connecting → method → Securing → Processing → Payment confirmed; failure + Try again; reduced-motion safe), `/orders`, `/orders/:id` (confirmation + history), account Orders link
- Verified: API 149/149 (incl. real two-user last-unit race), web Vitest 70/70, Playwright 43/43 (twice); typecheck (api, web, root), lint, build clean; no overflow at 1440/1280/1024/820/375

## Phase 10 — Admin Module — COMPLETE
- Migration `admin_module`: `store_settings` (single row, value CHECKs), `admin_audit_log` (append-only trigger), `users.blocked_reason/blocked_at` (block-reason CHECK), `orders(created_at)` index
- `/api/v1/admin/*` behind one gate (session → ADMIN role from DB → CSRF), `private, no-store`, strict Zod everywhere: dashboard (SQL aggregates), products (create inactive, PATCH without stock, archive-if-ordered-or-stocked else delete), images (magic bytes → sharp re-encode to WebP, metadata stripped, generated names, 5 MB cap, served with nosniff + deny-all CSP), categories (delete blocked until reassigned, one transaction), inventory (all/low/out), audited stock adjustments (row lock + conditional update), orders (search/filter/detail), ladder transitions, cancellation with exactly-once `cancel_restore`, manual `PAID` via `PaymentService.confirmManually`, customer block (revokes sessions) / unblock, settings (drive checkout shipping, catalog default sort + page size, low-stock flags)
- Web: `/admin` shell (teal sidebar, collapsible mobile menu, skip link, focus to page heading), dashboard, product list/create/edit with image manager and stock panel, categories, inventory, orders + detail with confirm dialogs, customers, settings; storefront header "Admin" link for admins
- Fixes found in testing: route-change focus landing before the page loaded, badges stretching in grid cells, stacked-row labels on mobile, Playwright races on the shared dev DB (suite now runs one file at a time)
- Verified: API 215/215 (64 admin: authz matrix on 24 endpoints, malicious uploads, parallel cancels/payments/adjustments), web Vitest 95/95, Playwright 60/60 (twice); typecheck (api, web, root), lint, build clean; no overflow at 1440/1280/1024/820/375

## Current next phase
**Phase 11 — Storefront polish, SEO, and launch hardening** (homepage, mobile navigation drawer, real product imagery, per-route meta, security headers/CSP, rate limits, deployment checklist) — to be specified

## Remaining issues / notes
- Phases 9 and 10 are not yet committed or pushed
- Shipping amounts (₹99 / ₹2,999) are placeholders pending a business decision; now editable in admin Settings
- No automatic release of stock held by unpaid orders; an admin must cancel them
- Refunds for cancelled paid orders are offline (flagged in the order history note)
- Seed product images (SVG paths) don't exist; storefront shows placeholders, admin shows "File unavailable" until real images are uploaded
- Uploaded images live on the API's local disk (`api/uploads`, gitignored); a volume or object storage is needed before multi-instance deployment
- Admin sessions use the same idle expiry as customers (shorter admin expiry recommended in §3.1, not built)
- Address form offers 8 countries (API accepts any ISO alpha-2); postal format strict only for India
- Mobile header is tall at 375px (~340px) — no collapsible menu yet
- Auth rate limit (30/min locally) can fail back-to-back full e2e runs within 60s
- Local Postgres must be started detached (`Start-Process pg_ctl …`) or it crash-loops
- Accessibility verified by automation + keyboard e2e only; no screen-reader pass yet
- Guest-merge keys off the pre-rotation cookie, not the `rotated_from` audit chain
