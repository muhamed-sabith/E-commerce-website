# HEYRAH — API Contract Draft

**Status:** v0.2 draft — resources + conventions
**Depends on:** `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`
**No implementation exists yet.** This is the surface the API will be built to match.

Base: `/api/v1` — JSON over HTTPS. Auth: cookie session. Role checks are server-side on every endpoint below; the "Auth" column describes intent, never a client-side promise.

---

## 1. Auth & account

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | none | name, email, password → creates USER, starts session |
| POST | `/auth/login` | none | email + password; generic failures; rate-limited |
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

## 3. Customer resources (USER session)

| Method | Path | Purpose |
|---|---|---|
| GET | `/cart` | server-recomputed cart: lines, availability flags, totals |
| POST | `/cart/items` | add {product_id, qty≤99}; merges, stock-checked |
| PATCH | `/cart/items/{id}` | quantity change or remove (qty 0) |
| DELETE | `/cart/items/{id}` | remove line |
| GET | `/wishlist` | saved products with live price/stock state |
| POST | `/wishlist/items` | idempotent add |
| DELETE | `/wishlist/items/{id}` | remove |
| GET | `/addresses` | address book |
| POST | `/addresses` | create; first address becomes default |
| PATCH | `/addresses/{id}` | edit |
| DELETE | `/addresses/{id}` | delete; default-reassignment rules enforced |
| POST | `/addresses/{id}/default` | set default |
| POST | `/checkout/preview` | authoritative totals + shipping + per-line validation, pre-order |
| POST | `/checkout` | create order; atomic stock deduction; returns order snapshot |
| GET | `/orders` | own orders, newest first |
| GET | `/orders/{id}` | own order detail with line snapshots |

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
| `access_denied` | 403 | authenticated but wrong role / ownership miss |
| `unknown_resource` | 404 | nonexistent id/slug; also used instead of 403 for foreign user resources |
| `stock_shortage` | 409 | checkout/cart line lost the race; `details` names lines |
| `cart_stale` | 409 | inactive/archived/removed products in cart |
| `rate_limited` | 429 | back off; `Retry-After` header |

Production responses never carry stack traces or SQL (§12.7).

**List success envelope** — `{ "items": […], "page": 1, "page_size": 12, "total_items": 0, "total_pages": 0 }`.

**Money on the wire** — exact decimal **strings** (`"250.00"`, never `250.00` float), so no JSON parser can silently corrupt a price. Amounts are computed server-side; request bodies that include totals are ignored outright.

## 7. Pagination, idempotency, protection

- `page` ≥ 1 (default 1); `page_size` default 12 catalog / 24 admin, max 48. Beyond last page → empty `items` with honest totals, not an error.
- `POST /checkout` is naturally idempotent: a second submit after success finds the cart already converted and replays the existing order — documented behavior, tested in §15's order tests.
- Rate limits: auth endpoints 10/min/IP, search burst-cooled, admin unthrottled v1.
- Cookie-auth mutations ride SameSite=strict plus a double-submit CSRF token; CORS allowlist is the web origin only.
- Versioning: additive changes ship under `/api/v1`; anything breaking bumps `/api/v2` — old version gets a deprecation window.
