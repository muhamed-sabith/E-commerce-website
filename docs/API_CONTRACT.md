# HEYRAH — API Contract Draft

**Status:** v0.3 draft — guest cart, manual payment model, and conventions synchronized with final v1 decisions
**Depends on:** `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`
**No implementation exists yet.** This is the surface the API will be built to match.

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
| POST | `/checkout/preview` | **authenticated only** — authoritative totals + shipping + per-line validation, pre-order |
| POST | `/checkout` | **authenticated only — the authoritative order creation endpoint.** Re-validates every line, deducts stock atomically (any failure rolls back the entire order — no partial orders), snapshots line prices, creates the order with `payment_status = PENDING_PAYMENT` |
| GET | `/orders` | own orders, newest first |
| GET | `/orders/{id}` | own order detail with line snapshots |

Guests calling `/checkout/*` or any customer resource receive `401 authentication_required` — login is the checkout wall, and the guest cart merges on the way through.

**Payment behavior (v1 — no payment gateway):**

- Every newly created order has `payment_status = PENDING_PAYMENT`. There is no SDK, no webhook, no provider API, nothing to integrate.
- Payment confirmation is **manual, admin-only**: an authorized admin flips the order to `PAID` (see §4). The action is audited.
- **Customers have no endpoint to set any payment status** — attempting it server-side is impossible, not merely hidden.
- Semantics are kept gateway-ready: a real provider can be approved later without changing order creation.

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
