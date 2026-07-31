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

## Phase 11 — Storefront polish, SEO & launch hardening — COMPLETE
- Storefront: info strip (configured shipping rule via new `GET /store`), compact sticky header with official monogram, mobile drawer (`<dialog>`), footer of real links, `/help` (actual behaviour; unpublished policies marked as such), new homepage (brand opening, New in, Shop by category with live counts, under-₹1,000 edit, "How HEYRAH works", provisional brand note), portrait product cards, catalog chips + collapsible filters + scoped category landings, PDP with sticky info, reassurance lines and "More from" rail, 404 page. Reference site used for patterns only (strip, category discovery, merchandising rails, trust/about, footer IA); no layout, copy, assets or Compare/Quick view copied
- Images: root cause = seed rows pointed at `products/*.svg` that never existed; seed now generates labelled placeholder plates (WebP, `uploads/products/seed/`) served by the existing `/assets/products` route
- SEO: `api/services/seo.service.ts` (meta, canonical, robots, JSON-LD Product/Offer/BreadcrumbList/Organization from verified rows only — no itemCondition, ratings or reviews), `/sitemap.xml`, `/robots.txt`; production web server `web/server/serve.mjs` injects head tags + `<noscript>` summary, returns 404 for unknown pages, `X-Robots-Tag` on private routes, 301 canonical redirects, document CSP, proxies `/api` + assets; client `lib/head.ts` keeps tags in sync on navigation
- Hardening: API security headers, catalog read rate limit (300/min/IP), `trust proxy` in production, admin idle timeout 60 min (customers 24 h), multer 2.4.0 (8 DoS advisories fixed), Docker files rebuilt for the workspace (non-root, healthchecks, `migrate deploy` on start), nginx removed, code-split private/admin routes (entry JS 312 kB / 97 kB gzip)
- Policy + contact pages: migration `store_pages`; `/privacy`, `/terms`, `/returns`, `/shipping-policy`, `/contact` render text published in admin → Pages (plain text, audited); unpublished = honest pending state, noindex, no footer link, not in sitemap. No policy text was written by the system
- Touch targets: header search field + button, bag pill, catalog chips raised to 44px (header height unchanged)
- Verified: API 236/236, web Vitest 109/109 (incl. 11 web-server tests), Playwright 99/99 (incl. 41 storefront: axe-core WCAG 2.1 A/AA on 11 pages + open drawer = 0 violations, 44px targets at 1440/1280/1024/375, no overflow at 1440/1280/1024/820/768/430/390/375); typecheck (api, web, root), lint, build clean; `serve.mjs` run manually against the built bundle + real API

## Current next phase
**Launch readiness** (business inputs + infrastructure, not more features): real product photography, the business publishing its privacy/terms/returns/shipping/contact text in admin → Pages, final shipping amounts, hosting + TLS + secrets, a Docker run of the compose stack, and a manual screen-reader pass

## Remaining issues / notes (not launch-ready until the first five are resolved)
- Docker compose stack NOT RUN (Docker unavailable in this environment); Dockerfiles and compose are written but unverified
- No real product photography; seed placeholders are clearly labelled "Photography coming soon"
- Policy/contact pages are built but **empty until the business publishes its own text** (admin → Pages); legal wording must come from the business, not the system
- `npm audit`: 3 high (deepmerge-ts via `prisma` CLI dev tooling, pinned by @prisma/config 6.19.3 — fixed only in a Prisma major) and 2 moderate (vitest/@vitest/mocker — fixed only in vitest 5, breaking). Both dev-only; runtime deps clean apart from `prisma` being in the api devDependencies tree
- No manual screen-reader pass (automated axe + keyboard e2e only)
- Body content is client-rendered: non-JS crawlers get injected meta + `<noscript>` summary only
- Rate limiters are in-process (single API instance); uploads on local disk/volume (single server only)
- Shipping ₹99 / ₹2,999 still placeholders (editable in admin Settings); no automatic release of stock held by unpaid orders; refunds offline
- Phase 11 work is not yet committed
- Local dev: Postgres must be started detached (`Start-Process pg_ctl …`); `api/.env` sets `CATALOG_RATE_LIMIT_MAX=5000` for the e2e suite; Playwright runs one file at a time (shared dev DB)
- Address form offers 8 countries (API accepts any ISO alpha-2); guest-merge keys off the pre-rotation cookie
