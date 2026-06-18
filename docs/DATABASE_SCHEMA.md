# HEYRAH — Database Schema Draft

**Status:** v0.3 draft — synchronized with final v1 decisions (INR, manual payment confirmation, guest session cart)
**Depends on:** `docs/REQUIREMENTS.md` (§4 product fields, §8–10 commerce rules, §11 auth)
**Scope:** relational design for PostgreSQL. No ORM, no migrations, no application code in this document.

---

## 1. Conventions

- Snake_case names, surrogate primary keys (`BIGSERIAL`), immutable `created_at` / mutable `updated_at` timestamps on every mutable table (UTC storage).
- Money columns use fixed-point decimal types — never floats, never strings (REQUIREMENTS §7/§10). Single currency: **INR (₹)**; no currency column per money value — the store-wide currency is a constant, format at display.
- Soft lifecycle via `status` columns; nothing customer-visible is hard-deleted once it appears in an order.
- Enums are stored as `VARCHAR` + `CHECK` constraints (easy to evolve, portable across migrations).

## 2. Tables

### 2.1 users

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| name | VARCHAR(120) | required, trimmed |
| email | VARCHAR(255) UNIQUE | normalized lowercase |
| password_hash | VARCHAR(255) | bcrypt/argon2 output; plaintext never exists here |
| role | VARCHAR(10) | CHECK in ('USER','ADMIN'); default 'USER' |
| is_blocked | BOOLEAN | default false; admin action (§3.10) |
| created_at / updated_at | TIMESTAMPTZ | |

### 2.2 categories

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| name | VARCHAR(80) | |
| slug | VARCHAR(90) UNIQUE | URL-safe, stable |
| is_active | BOOLEAN | inactive → hidden from storefront |
| sort_order | INT | nav display order |
| created_at / updated_at | TIMESTAMPTZ | |

### 2.3 products

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| name | VARCHAR(120) | |
| slug | VARCHAR(140) UNIQUE | derived, stable |
| sku | VARCHAR(40) UNIQUE | uppercase-normalized, pattern `HEY-<CAT>-#####` |
| description | TEXT | safe-rendered only |
| price | NUMERIC(10,2) | required, `CHECK (price > 0)` — NUMERIC, never FLOAT8, never VARCHAR |
| discount_type | VARCHAR(10) | CHECK in ('none','percent','fixed'); one per product |
| discount_value | DECIMAL(10,2) | percent: 0–100 exclusive; fixed: 0 < v < price |
| category_id | BIGINT FK → categories | required |
| status | VARCHAR(12) | CHECK in ('active','inactive','archived') |
| stock_quantity | INT | `CHECK (stock_quantity >= 0)` — negative stock is unrepresentable at the DB level, per REQUIREMENTS §9 |
| low_stock_threshold | INT NULL | per-product override; NULL → global default |
| created_at / updated_at | TIMESTAMPTZ | `newest` sort uses created_at |

### 2.4 product_images

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| product_id | BIGINT FK → products | |
| file_path | VARCHAR(255) | storage path, generated filename (§12.6) |
| alt_text | VARCHAR(200) | accessibility |
| position | INT | ordered gallery; position 0 = primary; UNIQUE(product_id, position) |

### 2.5 product_specifications

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| product_id | BIGINT FK → products | |
| spec_key | VARCHAR(60) | e.g. 'Material', 'Care' |
| spec_value | VARCHAR(255) | UNIQUE(product_id, spec_key) |

### 2.6 carts / cart_items

`carts`: id, user_id FK NULL (persisted user cart), session_token VARCHAR(64) NULL (guest's temporary session cart — keyed by the unauthenticated guest session), created_at, updated_at. Constraint: exactly one of user_id / session_token set. One active cart per user (UNIQUE(user_id) where not null). **On login the guest cart (session_token) merges into the user cart: lines union, duplicate products qty-summed, quantities re-capped by current stock; unavailable products dropped with a flag; the merge runs in one transaction.**

`cart_items`: id, cart_id FK, product_id FK, quantity INT > 0. UNIQUE(cart_id, product_id) — adding twice sums quantity.

### 2.7 wishlists

Composite PK (user_id FK, product_id FK), created_at. Idempotent add; no stock reservation implied.

### 2.8 addresses

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id | BIGINT FK → users | |
| receiver_name | VARCHAR(120) | |
| phone | VARCHAR(24) | format validated app-side |
| line1 / line2 | VARCHAR(120) / VARCHAR(120) | line1 required |
| city / state | VARCHAR(80) / VARCHAR(80) | |
| postal_code | VARCHAR(16) | |
| country_code | CHAR(2) | ISO 3166-1 alpha-2 |
| is_default | BOOLEAN | app enforces: one default per user, delete rules per REQUIREMENTS §2.12 |
| created_at / updated_at | TIMESTAMPTZ | |

### 2.9 orders

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| order_number | VARCHAR(20) UNIQUE | `HEY-YYMMDD-####` |
| user_id | BIGINT FK → users | |
| status | VARCHAR(12) | CHECK in ('pending','confirmed','shipped','delivered','cancelled') |
| payment_status | VARCHAR(20) | CHECK in ('PENDING_PAYMENT','PAID') — v1 has **no payment gateway**: every order starts `PENDING_PAYMENT`; an authorized admin manually flips it to `PAID` (audited in order_status_history). Customers have no path to set PAID |
| subtotal | DECIMAL(12,2) | server-computed at purchase |
| discount_total | DECIMAL(12,2) | Σ per-product discounts |
| shipping_total | DECIMAL(12,2) | v1 flat/free-above rules |
| grand_total | DECIMAL(12,2) | = Σ rounded lines; immutable after creation |
| ship_receiver_name … ship_country_code | snapshot columns | copied from address at checkout; survives address edits/deletion |
| placed_at / confirmed_at / cancelled_at | TIMESTAMPTZ NULL | audit milestones |
| created_at / updated_at | TIMESTAMPTZ | |

### 2.10 order_items

id PK, order_id FK, product_id FK (may point to archived product — snapshot below is authoritative), product_name_snapshot VARCHAR(120), sku_snapshot VARCHAR(40), unit_price DECIMAL(10,2), discount_amount DECIMAL(10,2), final_price DECIMAL(10,2), quantity INT > 0, line_total DECIMAL(12,2), created_at. Append-only; historical rows are never updated.

### 2.11 order_status_history

id PK, order_id FK, from_status NULL→to_status, actor_type CHECK ('USER','ADMIN','SYSTEM'), actor_id NULL, note VARCHAR(255), created_at. The status ladder (§10.4) is enforced app-side; this table is its evidence trail.

### 2.12 payments — **future-only, not part of v1**

Reserved for the day a real gateway is approved (would hold method, gateway status, provider references, webhook evidence). **v1 builds no payments table and no gateway integration**: the order's `payment_status` column is the single source of payment truth, admin-confirmed manually. Listed here only so the v1 schema leaves clean room for it — no v1 requirement references provider references, gateway IDs, or webhooks.

*(If ever built: id PK, order_id FK, method VARCHAR(30), status, amount DECIMAL(12,2), provider_reference VARCHAR(80) NULL, created_at / updated_at.)*

### 2.13 stock_adjustments

id PK, product_id FK, delta INT, resulting_quantity INT, reason VARCHAR(40) CHECK in ('restock','correction','damaged','sale','cancel_restore','admin_set','initial'), actor_type / actor_id, created_at. **Append-only** — inventory audit per REQUIREMENTS §9; no UPDATE/DELETE from application paths.

### 2.14 DB-enforced integrity summary (v0.2)

Beyond app validation, the database itself must make wrong states impossible:

- `products.price > 0`, `products.stock_quantity >= 0` — CHECK constraints.
- discount coherence: if `discount_type='percent'` then `0 < discount_value < 100`; if `'fixed'` then `0 < discount_value < price`; if `'none'` then `discount_value IS NULL` — one compound CHECK.
- `cart_items.quantity > 0 AND quantity <= 99` — the cart hard cap enforced close to the data.
- `order_items.unit_price >= 0`, `final_price > 0`, `quantity > 0`, `line_total >= 0`.
- UNIQUE on: `users.email`, `categories.slug`, `products.slug`, `products.sku`, `orders.order_number`, `cart_items(cart_id, product_id)`, `product_images(product_id, position)`, `product_specifications(product_id, spec_key)`.
- Append-only tables (`order_items`, `stock_adjustments`, `order_status_history`) protected by revoking UPDATE/DELETE from the application role at the migration level.

## 3. Relations (narrative)

- categories 1—N products; products 1—N images/specifications.
- users 1—N addresses/orders; users 1—1 cart, N—N wishlists.
- orders 1—N order_items, 1—N status history; payment state lives on the order itself in v1 (`orders.payment_status`) — no active payments relation.
- products 1—N stock_adjustments.

## 4. Planned indexes

- products: (category_id), (status, stock_quantity), (slug), (sku), (price), (created_at DESC) — serving §5–7 query paths.
- orders: (user_id, created_at DESC), (order_number), (status).
- order_items: (order_id). cart_items: (cart_id). stock_adjustments: (product_id, created_at).
- Final list must be re-verified against real query plans in the performance phase.

## 5. Entity-relationship diagram

```mermaid
erDiagram
    USERS ||--o| CARTS : has
    USERS ||--o{ ADDRESSES : stores
    USERS ||--o{ ORDERS : places
    USERS ||--o{ WISHLIST_ITEMS : saves
    CATEGORIES ||--o{ PRODUCTS : contains
    PRODUCTS ||--o{ PRODUCT_IMAGES : shows
    PRODUCTS ||--o{ PRODUCT_SPECIFICATIONS : describes
    PRODUCTS ||--o{ STOCK_ADJUSTMENTS : audited-by
    PRODUCTS ||--o{ CART_ITEMS : in
    CARTS ||--o{ CART_ITEMS : holds
    ORDERS ||--|{ ORDER_ITEMS : snapshots
    ORDERS ||--o{ ORDER_STATUS_HISTORY : transitions
    WISHLIST_ITEMS }o--|| PRODUCTS : refers

    USERS { bigint id; varchar email; varchar role; bool is_blocked }
    PRODUCTS { bigint id; varchar sku; numeric price; varchar status; int stock_quantity }
    ORDERS { bigint id; varchar order_number; varchar status; varchar payment_status; numeric grand_total }
    ORDER_ITEMS { bigint id; varchar product_name_snapshot; numeric final_price; int quantity; numeric line_total }
    STOCK_ADJUSTMENTS { bigint id; int delta; varchar reason; int resulting_quantity }
```

Rendering note: the mermaid block lives inside this markdown so GitHub renders it natively — the diagram stays part of the doc, not a separate binary asset.

## 6. Open questions

- JSONB vs relational rows for product specifications (v0.1 chose relational for queryability).
- Order number generator: sequence-per-day vs random tail — decide with implementation.
- ~~Session-token cart vs server-side guest cart storage~~ — **decided (v1): guest cart keyed by the unauthenticated session** (`carts.session_token`), per the cookie-session decision; merge-on-login rules specified above.
