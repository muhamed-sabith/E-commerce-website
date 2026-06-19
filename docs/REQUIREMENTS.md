# HEYRAH — Requirements Specification

**Project:** HEYRAH — "Wings of Style" e-commerce platform
**Document version:** 0.2 (final v1 decisions locked)
**Status:** Approved baseline — synchronized with ARCHITECTURE, DATABASE_SCHEMA, and API_CONTRACT; no application code exists yet
**Governing rules:** `AGENTS.md` (permanent project rules)

---

## 1. Product Overview

HEYRAH is a production-minded e-commerce platform for a premium fashion/lifestyle brand. The storefront must feel like a premium international fashion house — clean composition, excellent spacing, product focus, smooth and restrained interactions — while remaining completely original.

**Brand anchors**

* Company/brand name: **HEYRAH** (never "HYRA", spelling is fixed)
* Official tagline: **"Wings of Style"** — used only where it improves brand presentation, never everywhere
* Primary visual identity: **Deep Teal Blue + Gold**, applied with restraint (neither color dominates the whole site)
* Logo reference: `public/brand/heyrah-logo-reference.jpg` — proportions and character must be preserved, never redrawn

**Purpose**

* Give customers a smooth, premium, accessible shopping experience: browse → search → filter → view → cart → checkout → order tracking.
* Give operators a simple, productive admin module: catalog, categories, inventory, orders, users, settings.
* Enforce commerce correctness at the backend as the single source of truth: prices, stock, discounts, totals, authorization.

**Personas**

| Persona | Description |
|---|---|
| Guest | Browses, searches, filters, views products; may build a temporary session cart; must sign in before checkout/order creation |
| Customer (USER) | Registered shopper with address book, orders, wishlist, profile |
| Administrator (ADMIN) | Operates catalog, inventory, orders, users, settings — separate authorization surface |

---

## 2. User Module

Each feature is specified as: **purpose / user action / expected system behavior / success state / error & edge cases.**

### 2.1 Homepage

* **Purpose:** brand-first entry point; communicates the HEYRAH identity and routes users into the catalog.
* **User action:** opens the site root.
* **Expected behavior:** hero presents brand (teal/gold surfaces, restrained gold accents), featured/new arrivals rail from real backend data, navigation is visible, search is reachable. No fake products, no filler sections that pretend to be finished.
* **Success state:** page renders fast; featured products come from the API; empty catalog shows a graceful "collection coming soon" state.
* **Errors/edges:** API failure → cached or clean error message, no broken layout; images fail → alt text + neutral placeholder; first-ever visit with zero products → empty state, not a spinner forever.

### 2.2 Navigation

* **Purpose:** predictable movement through the store at every screen size.
* **User action:** clicks header links, opens category menu, uses mobile hamburger.
* **Expected behavior:** sticky or standard header with logo (never restretched), category links, search, cart icon with live item count, account link. Mobile: accessible drawer/menu, touch targets ≥ 44px, focus order sane.
* **Success state:** every link reaches a real page; active section indicated subtly.
* **Errors/edges:** unknown route → branded 404 page with path back to catalog; cart count for guests reflects the temporary session cart (0 when empty), never stale; menu trap: drawer restores focus and closes on Escape.

### 2.3 Product browsing

* **Purpose:** let shoppers scan the collection.
* **User action:** scrolls catalog grid, pages or infinite-scrolls.
* **Expected behavior:** paginated grid (default page size 12–24, fixed and documented), product cards: image, name, price (currency-formatted), quick path to detail. Sort/filter/search controls present and functional.
* **Success state:** correct page of real products; totals shown ("showing X of Y"); pagination preserves applied sort + filters.
* **Errors/edges:** empty result → empty state with clear "reset filters" action; page beyond last → redirect to last valid page or show empty state, never an error; deleted product appears in stale page → card skipped, totals stay honest.

### 2.4 Categories

* **Purpose:** organize the catalog into a browsable hierarchy.
* **User action:** selects a category from nav or product page tags.
* **Expected behavior:** category listing page = catalog pre-filtered by that category. One level of subcategory supported in v1 (depth beyond one level is out of scope unless approved).
* **Success state:** only products assigned to that category are shown; breadcrumb reflects the position.
* **Errors/edges:** category with no products → empty state (not a 404, admin still assigns products); inactive category → hidden from customers; unknown category slug → 404.

### 2.5 Search

* **Purpose:** find products by words.
* **User action:** types query, submits (Enter or button).
* **Expected behavior:** server-side search over defined fields (see §5), results rendered in the catalog with current sort/filters preserved. Query reflected in the URL (shareable/bookmarkable).
* **Success state:** relevant matches, result count shown, empty query → full catalog.
* **Errors/edges:** see §5 (case, whitespace, partial, no results, invalid input).

### 2.6 Filtering

* **Purpose:** narrow the catalog by facets.
* **User action:** toggles category/price/availability filters.
* **Expected behavior:** filters apply server-side, combine with search + sorting per §6; state visible in UI and URL; "clear all" available.
* **Success state:** result set matches the exact intersection of active filters; counts honest.
* **Errors/edges:** contradictory filters (category X + price range excluding it) → empty state, filters remain applied and removable; client-supplied nonsense params (negative prices, arrays) → sanitized, default applied, no crash.

### 2.7 Numeric sorting

* **Purpose:** order the catalog predictably, above all by price.
* **User action:** picks sort option.
* **Expected behavior:** **true numeric ascending/descending price sorting** — prices stored and compared as numeric values (decimal), never as strings; full rules in §7.
* **Success state:** `25, 100, 250, 1000` for low→high (never `100, 1000, 25, 250`).
* **Errors/edges:** equal prices → deterministic tie-break (newest then id); invalid sort param → default sort applied; sorting across pages → stable order, no duplicates/omissions at page boundaries.

### 2.8 Product details

* **Purpose:** full decision-making information for one product.
* **User action:** opens a product.
* **Expected behavior:** gallery, name, price + discount display, description, specifications, category, stock/availability state, add-to-cart control, wishlist toggle (logged-in users). Size/color variant matrices are out of scope for v1 (§18).
* **Success state:** all shown data is real backend data; out-of-stock disables purchase path with clear labeling.
* **Errors/edges:** invalid/nonexistent ID → 404; archived/inactive product → hidden or "unavailable" (decision logged in open items §18); deep link after deletion → graceful; image load failures → placeholder + alt.

### 2.9 Wishlist

* **Purpose:** save products for later.
* **User action:** toggles heart on cards/detail page.
* **Expected behavior:** per-user stored server-side; guest toggle prompts sign-in first. Wishlist page lists saved items with live prices/stock (wishlist is not a reservation).
* **Success state:** add/remove persists across sessions; "added"/"removed" feedback.
* **Errors/edges:** product later inactive/out-of-stock → still listed but clearly flagged and non-purchasable; duplicate add is idempotent; wishlist cleared when account deleted.

### 2.10 Cart

* **Purpose:** collect intended purchases with trustworthy totals.
* **User action:** add product, change quantity, remove item.
* **Expected behavior:** server-validated cart per §8 — backend recomputes every price, discount, subtotal, total; never trusts client totals; quantity respects stock and max-quantity caps; cart persists for the logged-in user, session cart for guest with merge on login.
* **Success state:** correct totals to the cent; header count updates; empty cart shows empty state.
* **Errors/edges:** product goes out of stock while in cart → flagged, blocked from checkout with reason; price changes after add → revalidated at view/checkout, user sees "price updated"; stock falls below quantity → clamp/notify; removals mid-session → totals recompute server-side.

### 2.11 Checkout

* **Purpose:** convert cart into an order safely.
* **User action:** proceeds to checkout, selects/enters address, confirms.
* **Expected behavior:** full flow per §10 — re-validate cart server-side, compute authoritative totals, require shipping address, create order atomically with inventory deduction.
* **Success state:** order created with human-readable order number, status per §10, `PENDING_PAYMENT` (awaiting confirmation), stock correctly decremented; when demo payment mode is enabled (v1 dev/demo default), the user is taken straight to the dedicated demo payment screen (§10) and from there to the order confirmation page.
* **Errors/edges:** race — last item sold between cart-view and confirm → order rejected for that line with clear message, rest may proceed (per-line outcome, documented); server-side validation failure → order not created, cart preserved with reasons, retry offered; empty cart → checkout unreachable; guests reaching checkout → prompted to sign in, guest cart merges on login; simulated demo payment failure → order remains valid and `PENDING_PAYMENT`, retry offered on the demo page.

### 2.12 Address management

* **Purpose:** store shipping addresses.
* **User action:** add/edit/delete/default address.
* **Expected behavior:** per-user CRUD; validation of required fields (see §12 input validation); default flag; delete rules shown clearly (cannot delete the last default without reassigning).
* **Success state:** changes persist and prefill checkout.
* **Errors/edges:** invalid postal formats → inline field errors; delete of the default → prompt to choose new default; XSS via address strings → stored safely, rendered escaped.

### 2.13 Orders (customer view)

* **Purpose:** let the user see their own purchase history and status.
* **User action:** opens Orders, opens a single order.
* **Expected behavior:** list newest first; each order: number, date, items snapshot, totals snapshot, status, payment status, shipping address snapshot; strictly scoped to the authenticated user (server-enforced).
* **Success state:** accurate history even after products change or are deleted (snapshots, not live joins).
* **Errors/edges:** another user's order ID in URL → 404/403 handled server-side, no data leak; empty history → friendly empty state pointing to catalog.

### 2.14 Account / profile

* **Purpose:** manage identity and preferences.
* **User action:** view/edit name, email where allowed, change password, manage addresses/wishlist links.
* **Expected behavior:** email uniqueness enforced; password change requires current password; sensitive changes confirmed to the user.
* **Success state:** persisted changes with confirmation feedback.
* **Errors/edges:** duplicate email → clear error; password change with wrong current → rejection; account deletion → data handling rules per §10/§11 snapshots kept for order history integrity.

### 2.15 Authentication (customer)

* **Purpose:** identify users and unlock cart/checkout/wishlist/orders.
* **User action:** register, login, recover password (only if email infra approved — see §18).
* **Expected behavior:** per §11 — hashed storage, rate-limited login, generic failure messages, secure server-side cookie sessions; guest session cart merges into the user cart on login (stock-validated).
* **Success state:** redirect back to original destination after forced login (deep-link preserved).
* **Errors/edges:** unverified/nonexistent email → generic message (no enumeration); expired session mid-checkout → re-login then continue intact; duplicate registration → honest "email exists" flow.

### 2.16 Logout

* **Purpose:** end session cleanly.
* **User action:** clicks logout.
* **Expected behavior:** server invalidates the session server-side; client state cleared (cart cache, user info).
* **Success state:** landing on homepage or previous page, guest state.
* **Errors/edges:** back-button shows no stale protected data (cache policy); logout replay → idempotent, no error.

---

## 3. Admin Module

All admin surfaces require authenticated **ADMIN** role, enforced on **every request server-side** (UI hiding is not authorization).

### 3.1 Admin authentication

* Same pipeline as users but with a server-side role claim; shared login + role gate (decision tracked in §18). Admin sessions: shorter idle expiry recommended.

### 3.2 Dashboard

* **Purpose:** operational overview.
* Expected behavior: real counts only — orders (by status, today/total), revenue figures (numeric, from backend), low-stock list, out-of-stock list, recent orders. No fake charts.
* Success: loads with real data even on day one (zeros shown honestly). Edge: empty platform → all-zero states, not broken widgets.

### 3.3 Product CRUD

* Create/update products with all fields per §4; validation server + client; draft/inactive allowed before going live; image upload per §12.6.
* **Delete policy:** products referenced by orders must be **soft-deleted/archived** (order snapshots keep working); hard delete only if never ordered — enforced server-side.
* Edge: SKU duplicate → rejected; price ≤ 0 → rejected; validation failure preserves admin's form input.

### 3.4 Categories

* CRUD + assign/unassign products; slug rules; inactivate vs delete (delete blocked while products are assigned — reassign first).

### 3.5 Inventory

* Per-product stock view with filters (low/out of stock); adjustments are **audited** events (who, when, delta, reason), never raw table edits from the UI.

### 3.6 Stock adjustment

* Admin sets/adjusts quantity with reason (restock, correction, damaged). Server validates non-negative results; adjustment that would go negative → rejected with clear message.

### 3.7 Low-stock handling

* Configurable threshold (default: 5 units, decision §18). Low-stock products flagged in dashboard + inventory list.

### 3.8 Out-of-stock handling

* Stock 0 → storefront shows unavailable, purchase paths disabled server-side, admin list highlights. Backorders out of scope v1.

### 3.9 Orders (admin view)

* List with status filters, search by order number/customer; detail shows line snapshots + totals (immutable, numeric). Status transitions allowed on a defined ladder only (§10.4); historical prices/totals are never editable — corrections happen via new orders or explicitly approved actions (refunds out of scope v1).

### 3.10 Users

* Read-only customer list (email, name, order count, status active/blocked), plus block/unblock with reason. Admins cannot see or change customer passwords. Creating admin accounts: bootstrap/seed process only in v1 (§11.5).

### 3.11 Settings

* Store name/tagline (HEYRAH, "Wings of Style" — spelling locked), default low-stock threshold, currency formatting (the currency itself is fixed: INR — not a setting), default sorting option, page size. Brand colors/logo are **not** editable from settings (brand rules in AGENTS.md are permanent).

### 3.12 Admin authorization matrix

| Action | Guest | USER | ADMIN |
|---|---|---|---|
| Browse/search/filter/sort catalog | ✅ | ✅ | ✅ |
| Cart/checkout/wishlist/orders/profile | ❌ | ✅ (own data only) | as user |
| Any admin endpoint/page | ❌ | ❌ | ✅ |
| Other users' data (any kind) | ❌ | ❌ | only via defined admin views, audited |

A USER session hitting an admin endpoint receives 403 from the server, full stop — regardless of client UI.

---

## 4. Product Requirements

**Product fields (v1):**

| Field | Rules |
|---|---|
| id | backend-generated, immutable |
| name | required, 2–120 chars, trimmed |
| slug | derived from name, unique, stable |
| sku | required, unique, uppercase-normalized, documented pattern (e.g. `HEY-<CAT>-<5 digits>`) |
| price | required, numeric decimal in INR (₹), > 0, 2-decimal precision max |
| discount | optional; percent (0 < d < 100) **or** fixed amount (0 < amount < price); one discount type per product (decision §18); backend computes final price |
| final_price | computed server-side, never stored as a source of truth |
| category_id | required, active category |
| description | required, plain + safe-rendered (no raw HTML injection) |
| specifications | key/value pairs (material, care, fit…) |
| images | ≥ 1 required; first image is primary; ordered gallery |
| stock_quantity | required, integer ≥ 0, DB-enforced |
| low_stock_threshold | optional per product, else global default |
| status | `active` / `inactive` / `archived` |
| created_at / updated_at | audit timestamps; "newest" sort uses created_at |

**Availability semantics:** purchasable = `status = active` AND `stock_quantity > 0`. Inactive → hidden from customers. Archived → hidden everywhere except historical order snapshots.

---

## 5. Search Requirements

Search is server-side, over: product **name**, **category name**, **description** (weighted lower), and **SKU** (exact / starts-with).

| Rule | Behavior |
|---|---|
| Case | Case-insensitive entirely (`Hera` = `hera` = `HERA`) |
| Whitespace | Input trimmed; internal runs collapsed (`winter   coat` → `winter coat`) |
| Matching | Partial/substring match per token on name & category; description matches rank lower than name; multiple tokens = AND semantics in v1 |
| Empty query | Treated as no search: full catalog with current filters/sort |
| No results | Honest empty state: "No results for 'xyz'" + suggestions (clear search / browse categories). Never fakes results |
| Invalid input | Symbols-only (`???`, `%`), control chars, overly long input → sanitized (length cap, control chars stripped), no crash, no SQL reached raw (parameterized queries only — §12) |
| Injection attempts | `' OR 1=1`, `<script>`, SQL fragments are **search terms**, not operators — escaped, return no-results or literal matches only |
| Result ordering | Name matches rank above category/description matches; ties follow the selected sort (or default) |

---

## 6. Filter Requirements

Facets in v1: **category**, **price range**, **availability**. Ratings excluded from v1 (no reviews module — §18).

* **Category:** multi-select; selections within the facet combine with **OR**.
* **Price range:** min/max as numeric bounds, applied to **final price** (after discount), inclusive; min > max → client prevents, server rejects → filter ignored with visible notice; negative/non-numeric bounds → sanitized to open range.
* **Availability:** `in stock` toggle; low-stock is never a customer-facing filter.
* **Combination across facets:** **AND** (category ∈ {A,B} AND price ∈ [x,y] AND in-stock).
* Filters + search + sort must always compose server-side in a single query/ORM filter (§7.3); UI shows the active set; every state lives in the URL.

---

## 7. Sorting Requirements — CRITICAL

**7.1 Numeric price sorting (non-negotiable).** Prices are stored as numeric/decimal types. Sorting must cast/compare numerically — **prices must never be sorted lexicographically as strings.**

Example — prices `100, 25, 1000, 250`:

* Low → High must produce exactly `25, 100, 250, 1000`.
* The lexicographic result `100, 1000, 25, 250` is defined as a **defect**, not an outcome.

High → Low produces `1000, 250, 100, 25`.

**7.2 Other sorts.** `newest` (created_at desc), `oldest` (where appropriate, e.g. admin lists), `name A–Z / Z–A` (documented collation), `popularity` (order-count based) where the signal exists — v1 storefront ships price ×2 + newest + name; popularity is an open decision (§18). Rating sort is out of scope (no ratings in v1).

**7.3 Interaction rules.**

* Search + filter + sort all resolve **before** pagination; order must be deterministic (tie-breakers: created_at, then id).
* Sorting applies to the **filtered result set**, not the whole catalog, and pagination walks that exact sorted set (page 2 continues where page 1 ended; no duplicates/skips at boundaries).
* Changing sort preserves filters + search, resets page to 1; changing page preserves sort/filter/search.
* Unknown/garbage sort value → documented default (e.g. `newest`), never an error page.

---

## 8. Cart Requirements

* **Add:** server checks product exists, active, stock ≥ requested qty; adds/merges line (same product = one line, qty summed); per-line max qty = min(stock, hard cap 99). Guests get a **temporary session cart** (identified by the guest session, no login needed); logged-in users get a persistent cart; the guest cart merges into the user cart on login.
* **Remove:** any line; totals recomputed server-side.
* **Quantity change:** validated against stock at that moment; clamp with message, not silent truncation; qty 0 = remove.
* **Stock validation:** on add, on every cart view, and again (authoritative) at checkout.
* **Subtotal:** Σ(final_price × qty) computed on backend; **never** accept totals from the client.
* **Discounts:** per-product discount reflected in final_price line; cart-level coupon engine is out of scope v1 (§18); subtotal − discount shown explicitly.
* **Total:** subtotal (after product discounts) + shipping (v1: flat rate or free-above-threshold — decision §18). Rounding: compute in decimal, round for display half-up to 2 dp; total = Σ rounded lines so displayed parts always add to the displayed whole.
* **Availability changes while in cart:** flagged line ("price updated"/"no longer available"), blocked from checkout, user can remove; cart merge on login: server union, duplicate lines qty-summed then capped by stock.

---

## 9. Inventory Requirements

* `stock_quantity` integer ≥ 0 — the **database enforces non-negative** (CHECK constraint or equivalent invariant) on top of app validation.
* **Low-stock threshold:** per product, else global default (5, decision pending); surfaces in admin lists/dashboard honestly.
* **Out-of-stock:** 0 → not purchasable; checkout re-validates each line.
* **Negative-stock prevention:** every deduction happens inside a transaction with a conditional update (`WHERE stock_quantity >= qty`) and row-level locking/atomic decrement for multi-line orders; a failed condition rolls the whole order — no partial oversells.
* **Concurrency:** two users buying the last unit → exactly one order succeeds; the other receives a clean out-of-stock rejection and keeps the rest of their cart.
* **Inventory history (audit):** event per change — timestamp, actor (user/admin/system), delta, reason, resulting quantity. Read-only in admin v1.

---

## 10. Checkout and Order Requirements

* **Checkout validation:** server re-runs every cart check (§8) at confirm time; **authentication required — checkout is the login wall** (guests are prompted to sign in first; guest cart merges on login); valid shipping address required; cart non-empty and all lines valid.
* **Order creation:** one transaction — re-validate → compute final totals → check+deduct stock for every line → insert order + snapshot lines. On any failure: total rollback, cart state returned to the user with reasons.
* **Authoritative backend pricing:** order lines snapshot product name, unit price, discount, final price, qty, line total at purchase time. Client-supplied money is ignored everywhere.
* **Inventory deduction:** per §9, same transaction as the order.
* **Order statuses:** `pending → confirmed → shipped → delivered`, with `cancelled` reachable from pending/confirmed only; transitions restricted, audited (who/when), no skipping backwards (shipped → pending rejected).
* **Payment (v1): no payment gateway.** No Razorpay/Stripe/PayPal, no payment SDK, no webhook, no provider API in v1. Every order is created with `payment_status = PENDING_PAYMENT`. **Customers can never mark an arbitrary order as PAID** — outside the demo flow below, no customer endpoint for payment status exists at all; the schema keeps the semantics clean so a real gateway can be approved later without surgery.
* **Demo payment simulation (v1 UX — not real payment processing):** to demonstrate the complete e-commerce flow, v1 ships a clearly-labeled **demo payment page** (`/payment/demo/{order-id}`): HEYRAH branding, order number, ordered products, total amount in INR, payment summary, mock method selector (Demo Card / Demo UPI / Demo QR — simulations only), prominent "Pay ₹X (Demo)" action, a "DEMO / TEST MODE" indicator always visible, and a restrained processing sequence ("Securing your payment…" → "Processing…" → "Payment confirmed") honoring reduced-motion settings. Deterministic outcomes: simulated **success** transitions `PENDING_PAYMENT → PAID`; simulated **failure** ("Simulate Payment Failure") leaves the order fully valid and `PENDING_PAYMENT` with retry. The page never collects or stores card numbers, CVV, UPI PIN, banking passwords, or any real financial credential, and never pretends to contact a real provider.
* **Demo gating & audit:** the simulator is a development/demo tool only. It exists solely when the server runs with payment mode `demo` (environment configuration); **production configuration can disable it completely** — endpoints unmounted (404) and the demo route inert. In demo mode it is the *only* customer-reachable path from `PENDING_PAYMENT` to `PAID`, and every demo transition is audited. Outside demo mode, only the admin manual confirmation (`PAID`, audited) exists.
* **Future gateway compatibility:** the payment layer is an abstraction (`PaymentService` / provider interface — ARCHITECTURE) with `DemoPaymentProvider` as the v1 implementation; a future real provider implements the same interface without rewriting orders, checkout, order history, or admin order management.
* **Shipping information:** address snapshot stored on the order (survives later edits/deletions in the address book).
* **Order number:** human-readable, unique, documented format (e.g. `HEY-YYMMDD-####`).
* **Ordering channel:** orders are created directly on the HEYRAH website only. No WhatsApp ordering, no off-site ordering flows in v1.
* **Receipt:** order confirmation page shows everything; email receipts out of scope v1 (§18).

---

## 11. Authentication and Authorization

**11.1 Roles**

* `USER` — storefront customer. `ADMIN` — operator. Strict separation: USER never reaches admin data or endpoints; role lives server-side, never a client-editable flag.

**11.2 Registration & login**

* Fields: name, email (normalized lowercase, unique), password (min 10 chars, documented policy). Login failures return generic messages (no user enumeration: identical error for unknown email and wrong password); rate limiting + backoff on repeated failures.

**11.3 Password security**

* Hash with a strong adaptive algorithm (bcrypt or argon2id, cost documented), per-user salt; **plaintext never stored, logged, or emailed**; password change requires the current password; reset flow only if email infra is approved (else admin-side reset in v1 — §18).

**11.4 Sessions**

* Secure **server-side cookie sessions** — HttpOnly, Secure, SameSite cookies; **no JWT in v1** (a JWT move would require explicit approval later); no credentials in localStorage; absolute + idle expiry; logout invalidates server-side; sensitive operations (password/email change) re-verify the current password; session identifier rotated at login. Guests are identified by their own session (the same session mechanism, unauthenticated), which is what makes the temporary guest cart work.

**11.5 Admin bootstrap**

* First admin created via seed/bootstrap script (documented, credentials via environment) — there is never a public "register as admin" path.

**11.6 Protected routes & server-side authorization**

* Every protected endpoint checks auth **and** ownership/role server-side on each request. Client-side route guards are UX only. Matrix per §3.12. Object-level authorization on all user-scoped resources (cart, wishlist, addresses, orders) — not just login-level.

---

## 12. Security Requirements

* **12.1 Input validation:** all inputs validated server-side (type, length, range, pattern); client validation is convenience only; reject-and-log unexpected payloads; canonical rule: *never trust the client* — prices, totals, ids, roles included.
* **12.2 Authentication:** per §11 — hashed passwords, generic auth errors, rate limiting, session hardening.
* **12.3 Authorization:** per §11.6 — role + ownership checked at the backend on every request.
* **12.4 Password hashing:** per §11.3.
* **12.5 Secret management:** DB credentials, session keys, admin secrets in environment/secret store only; `.gitignore` protects env files; **no hardcoded secrets in the repo, ever**; rotation documented before production.
* **12.6 File upload security:** product images only from admin; server-side verification of real type (magic bytes, not extension), size cap, image re-encode/metadata strip, generated storage filename; brand assets under `public/` are static files; no executable serving.
* **12.7 API security:** least privilege per endpoint; consistent error shapes without stack traces or SQL fragments in production; rate limiting on auth + search endpoints; explicit CORS allowlist; no sensitive data in URLs.
* **12.8 Common web attacks (must not be possible):** SQL injection (parameterized queries/ORM only), XSS (context-aware escaping, CSP), CSRF (SameSite + tokens where cookie-based), clickjacking (frame-ancestors / X-Frame-Options), open redirects (post-login redirect restricted to in-app paths), broken object-level authorization (ownership checks per 11.6), mass assignment (explicit field allowlists on create/update).
* **12.9 Logging:** security events (login failures, authz denials, oversell attempts) logged with timestamp/actor — without PII or passwords in logs.

---

## 13. UI/UX Requirements

* **Storefront:** premium, product-first presentation — clean composition, excellent spacing, restrained motion, strong typography, smooth interactions. Inspired by the *qualities* of premium modern web experiences, **not** their layouts; HEYRAH stays completely original; no copyrighted assets or copied designs.
* **Colors:** deep teal for brand surfaces/premium sections; teal shades in primary interface; gold only for accents, logo treatment, premium highlights; light/neutral backgrounds for shopping areas; dark readable text; soft neutral borders. No all-gold or all-teal pages; gradients and shadows minimal.
* **Admin:** simple, clean, professional, efficient, easy to operate; brand applied subtly; optimized for operating the store, not for showing off.
* **Responsive:** desktop / tablet / mobile verified at real breakpoints; touch targets, no horizontal scroll, images sized per viewport.
* **Accessibility:** WCAG 2.1 AA intent — keyboard operable everywhere (visible focus, logical order), accessible names on all controls, dialog/focus management, contrast checked (especially gold-on-teal and gold-on-white), state never communicated by color alone (out-of-stock is also labeled textually), reduced motion respected.
* **States — all four, everywhere it matters:** loading (skeletons for grids, spinners for buttons — honest about waiting), empty (explained + actionable, never a blank void), error (clear message + recovery path), success (brief, calm feedback; toasts where appropriate, no celebration spam).
* **Typography:** one display/title voice + one workhorse body face, defined scale, consistent weights — premium, not noisy.
* **Spacing:** one spacing scale (4/8px system), consistent rhythm.
* **Visual hierarchy:** one focus per screen region; prices, CTAs, product imagery lead; "Wings of Style" appears only where it serves a brand moment.
* **Animations:** fast, purposeful, restrained (200–300ms, ease-out; nothing bouncy or looping; everything skippable under reduced motion).
* **Demo payment page:** premium, secure-looking, clearly-demo presentation — deep teal + gold accents, premium typography, generous spacing, clean hierarchy, smooth restrained transitions, responsive mobile layout, "DEMO / TEST MODE" indicator always visible. Professional enough for a client presentation while unmistakably a simulator.

---

## 14. Non-Functional Requirements

* **Performance:** catalog/list pages interactive quickly (target: LCP < 2.5s on mid-tier 4G for first load); API list/search/sort responses P95 < 300ms excluding cold start; optimized responsive images; pagination mandatory (no unbounded queries); DB indexes on search/sort/filter columns documented with the schema.
* **Scalability:** stateless API with server-side session storage; read-heavy design allows a caching layer later without refactoring.
* **Maintainability:** per AGENTS.md code quality — layered structure, reusable validation, reusable business logic, clear naming, no duplicated commerce rules (pricing math lives in exactly one place).
* **Accessibility:** per §13.
* **SEO:** meaningful titles/meta per product & category, canonical URLs, semantic headings, sitemap, product structured data where the stack allows; storefront pages ship with per-route meta and crawlable URLs (SPA serving strategy per ARCHITECTURE §2) — a JS-only blank page on crawl is a defect.
* **Reliability:** every money/stock mutation transactional; versioned migrations; documented backup strategy before production.
* **Local dev/demo self-sufficiency:** the entire flow — browse → cart → checkout → demo payment → confirmation — must run on localhost with no gateway account, no API key, no subscription, no external payment service, and no real money; the demo simulator is fully self-contained in the local HEYRAH development environment.
* **Observability (proportionate):** structured logs with request ids; health endpoint; error rate visible during dev/deploy; dashboards later, logs from day one.

---

## 15. Testing Requirements (automated, mandatory)

| Area | Minimum tests |
|---|---|
| Authentication | register ok/dup/invalid; login ok / wrong-pass / unknown-email (identical failure message); rate-limit; logout invalidation |
| Authorization | USER→admin endpoint = 403; USER→another user's order = 404/403; anonymous protected route = 401; ADMIN passes; customer cannot reach any payment-status mutation (no such customer endpoint) |
| Search | case-insensitivity, whitespace collapse, partial match, AND tokens, symbols-only input, injection attempts, no-results |
| Filtering | single facet, multi-value OR within facet, AND across facets, price bounds applied to final price, nonsense params |
| **Numeric sorting** | **the §7.1 example (`100,25,1000,250` → `25,100,250,1000`) as an explicit test case**, both directions, deterministic ties |
| Search + filter + sorting | combined matrix cases incl. pagination order stability at page boundaries |
| Cart | add/merge/qty caps, removal, revalidation on price change, revalidation on stock change, totals correct to the cent (rounding law: Σ rounded lines = total) |
| Inventory | deduction correctness, non-negative invariant, low-stock flag, audit events recorded |
| **Concurrency** | two parallel purchases of the last unit → exactly one success (real parallelism in the test, not mocked) |
| Orders | atomic creation with stock deduction, rollback on any line failure, snapshot immutability after later product edits, status ladder enforcement |
| Demo payment | demo success → `PAID` (audited, idempotent replay); simulated failure → order stays valid + `PENDING_PAYMENT`; demo endpoints unmounted when mode ≠ demo; no credential-shaped field exists anywhere in the flow; customer cannot reach PAID outside the demo/admin paths |
| Guest | guest cart add/view/update; merge-on-login correctness; guest cannot reach checkout/order creation (401) |
| Admin critical | product CRUD validation, SKU uniqueness, delete-blocked-when-ordered, stock adjustment rules |
| Responsive | key storefront pages at mobile/tablet/desktop viewports (browser-tested) |
| Critical business logic | every §17 rule tagged (C) has at least one automated test |

---

## 16. Edge Cases (must be handled and tested)

* Product becomes out of stock while sitting in cart → line flagged, checkout blocked for it, rest of cart usable.
* Price changes after add-to-cart → server revalidation, user informed of the new price before confirming.
* Two users purchase the last item simultaneously → exactly one order succeeds; the loser gets a clean rejection.
* Product deleted/archived while present in a historical order → order snapshots render fully; wishlist line shows unavailable.
* Invalid/nonexistent product ID in URL → 404, no information leak.
* Unauthorized admin request (USER token on admin route) → 403 server-side regardless of client UI.
* Empty search (only whitespace/symbols) → defined behavior: no search applied or honest no-results, no crash.
* No matching products for a filter/search combination → empty state with reset affordance.
* Extremely large quantity → hard cap (99) + stock limit, tested.
* Invalid price from client (negative, string, NaN) → rejected with clear error; the DB type makes impossible values unrepresentable.
* Negative stock attempted (admin sets −5, oversell race) → rejected by app + DB invariant; audited attempt logged.
* Cart holding stale IDs after bulk delete → server purges invalid lines with a message.
* Session expiry mid-checkout → re-auth, cart survives.
* Guest builds a cart, then logs in → guest cart merges into the user cart; duplicate lines qty-summed then stock-capped; unavailable products dropped with a visible flag; merge is atomic.
* Duplicate registration across email casing (`A@x.com` vs `a@x.com`) → normalized uniqueness rejects the dupe.
* Deep link to an inactive product from an old wishlist → unavailable state, not an error.

---

## 17. Acceptance Criteria (module-level, testable)

**CRITICAL rules are tagged (C).**

* **Catalog:** given seeded products with prices [25, 100, 250, 1000], when the user sorts price low→high, the visible order is [25, 100, 250, 1000]. (C)
* **Catalog:** given filters {category: Dresses, price: [50, 300], in-stock} with search "linen", every result matches all three conditions simultaneously, sorted per selection, consistently across pages. (C)
* **Search:** "WING" matches "Wings Coat" case-insensitively; `' OR 1=1` returns no results and no error.
* **Cart:** displayed totals equal backend-computed totals; tampering with any client-side total changes nothing server-side. (C)
* **Guest cart:** a guest's session cart merges into their user cart on login with stock-validated quantities; checkout remains unreachable for guests (401). (C)
* **Checkout:** confirming an order deducts stock for every line atomically; failure of any line rolls back all. (C)
* **Inventory:** stock never goes below 0, even under the parallel purchase tests. (C)
* **Orders:** a historical order renders identical totals after the product is repriced, renamed, or archived. (C)
* **Authz:** USER-role token receives 403 on every admin API surface; anonymous requests to user routes receive 401. (C)
* **Admin:** a product with stock 0 cannot be purchased even by a direct API call with a valid session. (C)
* **UI:** loading, empty, error, and success states exist and are reachable for catalog, cart, checkout, and admin lists; storefront pages usable at 375px width; a keyboard-only flow reaches login → purchase confirmation.
* **Brand:** gold is an accent only; logo proportions match the reference; the tagline appears only at planned brand moments.

---

## 18. Out of Scope (v1 — unless specifically approved later)

* Product reviews & ratings (and rating-based sort/filter).
* Promotions engine, coupon codes, cart-level discounts.
* Real payment gateway integration — none in v1 (no Razorpay/Stripe/PayPal, no SDK, no webhooks, no provider API). Orders stay `PENDING_PAYMENT` until confirmed — via the clearly-labeled demo payment simulator (demo environments only) or an admin manually. A real gateway requires explicit written approval later; the payment abstraction keeps the door open without v1 commitment.
* Real financial credential collection — the demo payment flow must never create fields for card numbers, CVV, UPI PIN, or banking passwords (not even labeled "demo"); only a mock method selector exists.
* Guest checkout — guests may keep a temporary session cart, but checkout/order creation always requires sign-in.
* Product variants (size/color matrices) beyond simple options — v1 is single-SKU products.
* Email/SMS notifications, order-confirmation emails, password-reset emails (requires mail infrastructure).
* Returns, refunds, exchanges workflows.
* Multi-currency, multi-language/internationalization.
* Recommendation/personalization systems.
* Loyalty programs, gift cards, bundles.
* Warehouse locations, shipping-rate provider APIs, shipment tracking integration.
* Public API for third parties, mobile apps, PWA/offline mode.
* Analytics dashboards beyond the operational admin dashboard.

---

## Requirements summary

HEYRAH v1 is a two-surface commerce platform: a premium, accessible, teal-and-gold storefront (browse, search, filter, truly numeric sorting, detail, wishlist, cart, authenticated checkout, own-order history) and a deliberately simple admin (catalog + categories CRUD with unique SKUs, audited inventory with a hard non-negative invariant, a restricted order-status ladder, read-mostly users, and settings that cannot alter the brand). One iron law runs through everything: **the backend is the sole source of truth for prices, totals, stock, and roles** — the client never computes or asserts money.

## Critical business rules

1. Prices are numeric decimals everywhere; string-collation sorting is a defect.
2. Client-supplied prices, totals, and roles are ignored; the server recomputes.
3. Stock is never negative; deduction is atomic and concurrency-safe.
4. Out-of-stock / inactive products are unpurchasable at the API level.
5. USER/ADMIN separation is enforced per-request on the server.
6. Orders snapshot their line prices — history is immutable.
7. Every critical rule above carries an automated test.

## Critical risks

* **Payments deferred to manual confirmation** — payment-status semantics must stay clean so a real gateway can bolt on later without schema surgery; the demo simulator must stay visually and architecturally separate from that future path (one interface, two implementations — never a half-real gateway).
* **Demo mode leaking into production** — mitigated by configuration gating: demo endpoints unmounted and route inert unless payment mode = `demo`; deployment checklist must verify the setting before launch.
* **Concurrency oversell** is the classic e-commerce failure; treated as mandatory-tested, not nice-to-have.
* **Guest cart merge edge cases** — duplicate lines, over-stock merges, and unavailable products during login merge are specified and must be tested (§16).
* **Brand overuse** — gold-heavy screens or logo distortion would break the identity rules; mitigated by the UI checks in §17.
* **Scope creep** — §18 exists to keep v1 shippable; anything added needs written approval.

## Approved v1 decisions (locked)

| Decision | Outcome |
|---|---|
| Tech stack | PERN: React + TypeScript + Vite + React Router frontend, Node.js + Express.js + TypeScript backend, PostgreSQL, Prisma ORM, Zod validation, Docker deploy — canonical record: `docs/TECH_STACK.md` |
| Currency | Single currency: **INR (₹)** |
| Sessions | Secure server-side cookie sessions; **no JWT in v1** (would need explicit approval) |
| Guest cart | Temporary session cart allowed; checkout/order creation requires login; merge on login |
| Guest checkout | Not allowed in v1 |
| Payment | No gateway in v1; orders created `PENDING_PAYMENT`; `PAID` via admin manual confirmation, or via the clearly-labeled demo payment simulator in demo environments only (audited); production can disable demo mode completely; customers can never set PAID outside these paths |
| Ordering channel | HEYRAH website only — no WhatsApp/off-site ordering |
| Cart-level coupons | Out of v1 (confirmed via §18) |

## Open decisions requiring approval

| # | Decision | Recommendation |
|---|---|---|
| 1 | Discount model per product | fixed amount OR percent, one type per product |
| 2 | Low-stock default threshold | 5 units |
| 3 | Shipping v1 | flat rate + free-above-threshold (amounts from business) |
| 4 | Admin login surface | shared login + role gate |
| 5 | Popularity sort | defer until real order data exists |
| 6 | Hosting/infrastructure provider | decide before deployment phase |
| 7 | Email infrastructure (receipts, password reset) | defer; admin-side reset workaround in v1 |

## Recommended next phase

**Implementation phase (on explicit start):** scaffold `api/` (Express + TypeScript + Prisma) and `web/` (React + TypeScript + Vite) per ARCHITECTURE §9 and TECH_STACK.md, then feature phases with the §15 test matrix as the gate. Documentation discipline unchanged — architecture docs are updated alongside code from the first commit.
