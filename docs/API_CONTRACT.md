# HEYRAH — API Contract Draft

**Status:** v0.4 draft — guest cart, demo payment model, conventions; framework-neutral (Express implements it; contract unchanged by the stack change)
**Depends on:** `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`
**Implemented so far:** §1 auth/account, §2 catalog, §3 cart, wishlist, addresses, checkout, orders, demo payment, §4 admin (Phase 10).

Base: `/api/v1` — JSON over HTTPS. Auth: cookie sessions. **Every visitor, including guests, is issued a session cookie automatically** — guests hold it unauthenticated (their temporary cart keys off it), protected endpoints require an authenticated session. Role checks are server-side on every endpoint below; the "Auth" column describes intent, never a client-side promise.

---

## 1. Auth & account

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | none | name, email, password → creates USER, starts session, merges any guest session cart (see §3) |
| POST | `/auth/login` | none | email + password; generic failures; rate-limited; merges any guest session cart (see §3) |
| POST | `/auth/logout` | user | invalidates session server-side |
| GET | `/auth/me` | user | current identity: name, email, role |
| PATCH | `/account/password` | user | requires current password |
| PATCH | `/account/profile` | user | name (email change policy: out of v1 scope) |

## 2. Catalog (public)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/products` | none | list + search + filter + sort + pagination — the critical trio (§5 below) |
| GET | `/products/{slug}` | none | detail: fields, images, specs, availability state |
| GET | `/categories` | none | active categories for nav |
| GET | `/categories/{slug}` | none | category landing (meta + product list params) |

`GET /products` query surface: `q`, `category` (repeatable), `min_price`, `max_price`, `in_stock`, `sort`, `page`, `page_size`.

## 3. Cart — guest and customer

The cart surface is identical for guests and logged-in users; only the storage differs (guest: temporary session cart; user: persistent cart).

**Guest cart access (temporary session cart):**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/cart` | guest or user | server-recomputed cart: lines, availability flags, totals |
| POST | `/cart/items` | guest or user | add {product_id, qty≤99}; merges duplicate lines, stock-checked at add |
| PATCH | `/cart/items/{id}` | guest or user | quantity change (validated against stock; qty 0 = remove) |
| DELETE | `/cart/items/{id}` | guest or user | remove line |

**Session identification:** the guest needs no login — the API issues an unauthenticated session cookie on first interaction, and the guest cart is stored server-side keyed by that session (`carts.session_token`). The browser never owns cart truth; every `GET /cart` response is recomputed by the server.

**Guest → user merge on login:** `POST /auth/login` and `/auth/register` merge the guest session cart into the persistent user cart **in one transaction**:

1. lines unioned; duplicate products qty-summed;
2. summed quantities capped by current stock;
3. inactive/archived/no-longer-existing products dropped;
4. the response includes a `merge_report` {merged: […], capped: […], dropped: […]}, and the client surfaces it.

Stock is validated during the merge — a merge can never oversell.

**Customer-only resources (USER session):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/wishlist` | saved products with live price/stock state |
| POST | `/wishlist/items` | idempotent add |
| DELETE | `/wishlist/items/{id}` | remove |
| GET | `/addresses` | address book |
| POST | `/addresses` | create; first address becomes default |
| PATCH | `/addresses/{id}` | edit |
| DELETE | `/addresses/{id}` | delete; default-reassignment rules enforced |
| POST | `/addresses/{id}/default` | set default |

**Wishlist + address book (implemented, Phase 8):**

- Wishlist item id = the saved product's id (composite key user + product). `POST /wishlist/items` accepts only `{product_id}`; unknown/inactive/archived products → `404 unknown_resource`; repeat adds are idempotent. Every response is the full list `{items:[…]}` with **live** `price`, `finalPrice`, `availability` (`in_stock` / `out_of_stock` / `unavailable`) and `purchasable` — no price snapshot. Unavailable items stay listed with an empty `slug` (no public page).
- Address bodies: `receiver_name, phone, line1, line2?, city, state, postal_code, country_code` — strict (unknown keys such as `user_id`, `is_default` → `400`). Text trimmed and whitespace-collapsed; control characters rejected; phone 7–15 digits (`+ - ( )` and spaces allowed); `country_code` ISO alpha-2 (uppercased); postal code 3–16 letters/digits/space/`-`, **6 digits when `country_code = IN`**.
- Default rules: first address becomes default; exactly one default whenever any address exists (also a partial unique index); `POST /addresses/{id}/default` clears the previous default in the same transaction. `DELETE` of a non-default or the only address succeeds; deleting the default while others exist requires `?new_default_id=` (another owned address) — otherwise `409 default_reassignment_required`.
- Foreign ids on any wishlist/address route → `404 unknown_resource` (no existence leak). Responses are `Cache-Control: private, no-store`.

**Checkout, orders, demo payment (implemented, Phase 9):**

- `POST /checkout/preview` body `{address_id?}` (strict). Returns `lines` (each with `problem` or null), `problems`, `canPlaceOrder`, `address` (chosen, else default), `addresses`, `itemCount`, `subtotal`, `discountTotal`, `shippingTotal`, `grandTotal`, `shipping {flatRate, freeThreshold}`. Empty bag → `409 cart_empty`; foreign address → 404. Read-only.
- `POST /checkout` body `{address_id}` (strict — any money, status, or owner field → 400). `201 {order: {id, orderNumber, status, paymentStatus, grandTotal}, payment: {mode, demo_payment_url?}}`. Failures: `409 stock_shortage` / `cart_stale` with `details: [{line_id, product_id, name, reason, requested, available}]`, `409 cart_empty`, `404` foreign address. All-or-nothing (ARCHITECTURE §5).
- `GET /orders?page=&page_size=` → list envelope of `{id, orderNumber, placedAt, status, paymentStatus, grandTotal, itemCount}`, newest first. `GET /orders/{id}` → `{order}` with snapshot `items` (`unitPrice`, per-unit `discount`, `finalPrice`, `quantity`, `lineTotal`, `sku`), `shipping` snapshot, totals, `timeline`, and `payment {mode, canPay, demo_payment_url?}`.
- Demo endpoints accept `{method?: "demo_card"|"demo_upi"|"demo_qr"}` only. `confirm` is idempotent on PAID; `fail` on PAID → `409 already_paid`; cancelled orders → `409 not_payable`. Foreign/unknown order ids → 404 everywhere. In manual mode the demo routes are not registered (404).
| POST | `/checkout/preview` | **authenticated only** — authoritative totals + shipping + per-line validation, pre-order |
| POST | `/checkout` | **authenticated only — the authoritative order creation endpoint.** Re-validates every line, deducts stock atomically (any failure rolls back the entire order — no partial orders), snapshots line prices, creates the order with `payment_status = PENDING_PAYMENT` |
| GET | `/orders` | own orders, newest first |
| GET | `/orders/{id}` | own order detail with line snapshots |

Guests calling `/checkout/*` or any customer resource receive `401 authentication_required` — login is the checkout wall, and the guest cart merges on the way through.

**Payment behavior (v1 — no payment gateway):**

- Every newly created order has `payment_status = PENDING_PAYMENT`. There is no SDK, no webhook, no provider API, nothing to integrate.
- The checkout response includes `payment: {mode, demo_payment_url?}` — `mode: "demo"` carries the dedicated demo payment URL (`/payment/demo/{order-id}`) for the UX flow; `mode: "manual"` omits it. This field is configuration-driven, not a promise to any provider.
- Outside demo mode, payment confirmation is **manual, admin-only** (see §4), audited.
- **Customers have no endpoint to set arbitrary payment status** — the only customer-reachable `PENDING_PAYMENT → PAID` path is the demo simulator below, and only when the server runs in demo mode.
- Semantics are kept gateway-ready: a real provider can be approved later without changing order creation.

**DEMO PAYMENT SIMULATION (mode = `demo` only — NOT a real payment provider):**

These endpoints exist only when the server is configured with payment mode `demo`; in any other mode they are unmounted (404). They simulate, never process: no money moves, no provider is contacted, nothing real is charged.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/orders/{id}/demo-payment/confirm` | owner USER | deterministic simulated success → order `PENDING_PAYMENT → PAID` (audited, idempotent); rejected for foreign orders or orders not in `PENDING_PAYMENT` |
| POST | `/orders/{id}/demo-payment/fail` | owner USER | deterministic simulated failure → order unchanged, stays `PENDING_PAYMENT`; order remains fully valid, retry allowed |

Rules:

- Demo endpoints operate **only on the calling user's own order** (object-level authz) and only from `PENDING_PAYMENT`.
- **REAL PAYMENT PROVIDER vs DEMO PAYMENT:** a real provider, if approved later, implements the same payment-service interface server-side and would add its own endpoints — it is *not* this surface, and nothing in v1 pretends to be one.
- The demo page UI itself (mock method selector: Demo Card / Demo UPI / Demo QR, processing animation, success/failure states) is a frontend concern (REQUIREMENTS §10/§13); these two endpoints are its entire backend.
- No request or response in this flow carries — or has fields shaped to carry — card numbers, CVV, UPI PIN, or banking passwords.

## 4. Admin (ADMIN session only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/dashboard` | real counts: orders by status, revenue, low/out stock |
| POST | `/admin/products` | create (validation per schema; SKU unique) |
| PATCH | `/admin/products/{id}` | update; price/discount/status changes |
| DELETE | `/admin/products/{id}` | archive (hard delete only if never ordered) |
| POST | `/admin/products/{id}/images` | upload (magic-byte validated, re-encoded) |
| DELETE | `/admin/images/{id}` | remove image |
| POST | `/admin/categories` / PATCH / DELETE | category CRUD; delete blocked while products assigned |
| GET | `/admin/inventory` | stock list, filters `low` / `out` |
| POST | `/admin/products/{id}/stock-adjustments` | audited {delta, reason}; negative outcome rejected |
| GET | `/admin/orders` | list + status filter + search by number/customer |
| POST | `/admin/orders/{id}/status` | ladder transitions only; audited |
| POST | `/admin/orders/{id}/payment-status` | **manual payment confirmation** — `{status: "PAID"}` only, only from `PENDING_PAYMENT`; audited; this is the sole path to `PAID` in v1 |
| GET | `/admin/users` | read-mostly customer list |
| POST | `/admin/users/{id}/block` / `/unblock` | block with reason |
| GET | `/admin/settings` / PUT | thresholds, shipping, sort default; brand values immutable |

**As implemented (Phase 10):**

- **Gate.** One router for `/admin/*`: `ensureSession → requireAdmin → csrfProtect`. The role is read from the `users` row on every request (a demoted admin is refused on the next call). Guest → `401 authentication_required`, USER → `403 access_denied`, mutations without the double-submit token → `403 csrf_failed`. Every response is `Cache-Control: private, no-store`. All bodies are strict Zod — unknown keys (ids, roles, audit fields, totals, `stock_quantity` on PATCH) → `400`. Malformed or unknown ids → `404 unknown_resource`.
- Extra reads used by the UI: `GET /admin/products` (`q` name/SKU, `status`, `category_id`, paging), `GET /admin/products/{id}` (images, specs, `deletion: "archive"|"delete"`, last 10 stock moves), `GET /admin/categories` (with product counts), `GET /admin/orders/{id}`, `POST /admin/images/{id}/primary`.
- `GET /admin/dashboard` → `orders {total, today, byStatus}`, `revenue {paid, awaitingPayment, awaitingPaymentCount, todayOrderValue}` (paid = PAID and not cancelled; "today" = since India midnight), `inventory {lowStockThreshold, productCount, lowStockCount, outOfStockCount, lowStock[≤8], outOfStock[≤8]}`, `recentOrders[≤8]`, `paymentMode`. All aggregated in SQL.
- Products: `POST` `{name, slug?, sku (HEY-ABC-12345), description, price, discount {type: none|percent|fixed, value}, category_id (active), status (default inactive), stock_quantity (opening, audited as initial), low_stock_threshold|null, specifications[]}` → `201 {product}`. `PATCH` the same fields, partial, minus stock. Conflicts `409 sku_taken` / `slug_taken` carry `details[{path, message}]`; `409 image_required` when going active without an image. `DELETE` → `{result: "archived"}` if the product has order lines or stock history, else `{result: "deleted"}`.
- Images: `POST /admin/products/{id}/images` multipart (`image`, optional `alt_text`), ≤ `UPLOAD_MAX_BYTES` (5 MB) → `413 file_too_large`; non JPEG/PNG/WebP by magic bytes, or undecodable → `415 unsupported_image`; under 200 px → `422 image_too_small`; max 12 per product. `DELETE /admin/images/{id}` refuses the last image of an active product (`409 last_image`); positions re-pack from 0.
- Categories: `POST {name, slug?, is_active, sort_order}` / `PATCH` → full list; `409 slug_taken`. `DELETE /admin/categories/{id}?reassign_to=` → `409 category_in_use {details.product_count}` unless a different active destination is named; the move and the delete are one transaction.
- `GET /admin/inventory?filter=all|low|out&q=` → list + `counts {all, low, out}` + `lowStockThreshold`; low = `0 < stock ≤ COALESCE(product threshold, store threshold)`; archived products excluded.
- `POST /admin/products/{id}/stock-adjustments` body is one of `{reason: "restock", delta > 0}`, `{reason: "damaged", delta < 0}`, `{reason: "correction", delta ≠ 0}`, `{reason: "admin_set", quantity ≥ 0}` (server computes the delta). `sale`/`cancel_restore`/`initial` are system-only. Below zero → `409 negative_stock`, nothing written. `201 {adjustment, stockQuantity}`.
- Orders: `GET /admin/orders?q=&status=&payment=&page=` (q matches order number, customer name or email; newest first; 24 per page). `POST /admin/orders/{id}/status {status: confirmed|shipped|delivered|cancelled, note?}` — the ladder only; repeats, skips, and moves out of delivered/cancelled → `409 illegal_transition`. Cancelling restores stock (see ARCHITECTURE §5). `POST /admin/orders/{id}/payment-status {status: "PAID", note?}` — anything else → 400; already PAID → `409 already_paid`; cancelled → `409 not_payable`.
- Users: `GET /admin/users?q=&status=active|blocked` (explicit columns — no password hash ever selected; includes `orderCount`, `lastOrderAt`). `POST /admin/users/{id}/block {reason (3–255)}` revokes every session in the same transaction; admins and self → `409 cannot_block_admin` / `cannot_block_self`; repeat → `409 already_blocked`. `POST …/unblock {}` → `409 not_blocked` if not blocked. No role-change endpoint exists.
- Settings: `GET` → `{settings {lowStockThreshold, shippingFlatRate, shippingFreeThreshold, defaultSort, pageSize, updatedAt, isDefault}, fixed {brand {name, tagline}, currency}}`. `PUT` requires all five values (threshold 0–1000, money ≤ 2 dp, sort key, page size 4–48); brand/currency keys → 400. Settings drive the catalog default sort/page size (`GET /products` now reports the applied `sort`), checkout shipping, and low-stock flags.

## 5. The sorting contract (critical)

`sort` accepts: `price_asc`, `price_desc`, `newest`, `name_asc`, `name_desc`. Unknown value → falls back to `newest` (documented, no error). `price_asc`/`price_desc` MUST compare the numeric column: given prices `100, 25, 1000, 250`, `price_asc` returns `25 → 100 → 250 → 1000`. Any string-collation result is a defect. Ties break on `created_at DESC, id DESC`. Sorting resolves after search+filter and before pagination — page 2 continues the same deterministic order.

## 6. Conventions (added v0.2)

**Error envelope** — every failure is:

```json
{ "error": { "code": "stock_shortage", "message": "…", "details": [ … ] } }
```

| code | HTTP | Meaning |
|---|---|---|
| `validation_failed` | 400 | schema/validation errors, field-level details |
| `invalid_credentials` | 401 | login failure (generic, no enumeration) |
| `authentication_required` | 401 | no/invalid session on a protected endpoint — guests at checkout, expired sessions |
| `access_denied` | 403 | authenticated but wrong role / ownership miss |
| `unknown_resource` | 404 | nonexistent id/slug; also used instead of 403 for foreign user resources |
| `stock_shortage` | 409 | checkout/cart line lost the race; `details` names lines |
| `cart_stale` | 409 | inactive/archived/removed products in cart |
| `default_reassignment_required` | 409 | deleting the default address while others exist without naming `new_default_id` |
| `cart_empty` | 409 | checkout/preview with no lines (also the answer to a duplicate checkout submit) |
| `illegal_transition` | 409 | order status move not on the ladder |
| `already_paid` / `not_payable` | 409 | demo failure or admin confirmation on a PAID order / payment attempted on a cancelled order |
| `sku_taken` / `slug_taken` | 409 | admin product/category uniqueness; `details` names the field |
| `negative_stock` | 409 | stock adjustment would go below zero |
| `category_in_use` / `last_image` / `image_required` | 409 | admin deletion and publishing guards |
| `unsupported_image` / `file_too_large` / `image_too_small` | 415 / 413 / 422 | image upload refused |
| `rate_limited` | 429 | back off; `Retry-After` header |

Production responses never carry stack traces or SQL (§12.7).

**List success envelope** — `{ "items": […], "page": 1, "page_size": 12, "total_items": 0, "total_pages": 0 }`.

**Money on the wire** — single currency **INR (₹)**; amounts serialized as exact decimal **strings** (`"250.00"`, never `250.00` float), so no JSON parser can silently corrupt a price. Amounts are computed server-side; request bodies that include totals are ignored outright.

## 7. Pagination, idempotency, protection

- `page` ≥ 1 (default 1); `page_size` default 12 catalog / 24 admin, max 48. Beyond last page → empty `items` with honest totals, not an error.
- `POST /checkout` is naturally idempotent: a second submit after success finds the cart already converted and replays the existing order — documented behavior, tested in §15's order tests.
- Rate limits: auth endpoints 10/min/IP, search burst-cooled, admin unthrottled v1.
- Cookie-auth mutations ride SameSite=strict plus a double-submit CSRF token; CORS allowlist is the web origin only.
- Versioning: additive changes ship under `/api/v1`; anything breaking bumps `/api/v2` — old version gets a deprecation window.
