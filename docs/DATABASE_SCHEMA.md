# HEYRAH — Database Schema Draft

**Status:** v0.1 draft — requirements phase companion document
**Depends on:** `docs/REQUIREMENTS.md` (§4 product fields, §8–10 commerce rules, §11 auth)
**Scope:** relational design for PostgreSQL. No ORM, no migrations, no application code in this document.

---

## 1. Conventions

- Snake_case names, surrogate primary keys (`BIGSERIAL`), immutable `created_at` / mutable `updated_at` timestamps on every mutable table (UTC storage).
- Money columns use fixed-point decimal types — never floats, never strings (REQUIREMENTS §7/§10).
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
| price | DECIMAL(10,2) | required, > 0 |
| discount_type | VARCHAR(10) | CHECK in ('none','percent','fixed'); one per product |
| discount_value | DECIMAL(10,2) | percent: 0–100 exclusive; fixed: 0 < v < price |
| category_id | BIGINT FK → categories | required |
| status | VARCHAR(12) | CHECK in ('active','inactive','archived') |
| stock_quantity | INT | current on-hand |
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

`carts`: id, user_id FK NULL (persisted user cart), session_token VARCHAR(64) NULL (guest cart), created_at, updated_at. Constraint: exactly one of user_id / session_token set. One active cart per user (UNIQUE(user_id) where not null).

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
| payment_status | VARCHAR(8) | CHECK in ('unpaid','paid','failed') |
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

### 2.12 payments

id PK, order_id FK, method VARCHAR(30), status CHECK in ('unpaid','paid','failed'), amount DECIMAL(12,2), provider_reference VARCHAR(80) NULL (sandbox in v1), created_at / updated_at.

### 2.13 stock_adjustments

id PK, product_id FK, delta INT, resulting_quantity INT, reason VARCHAR(40) CHECK in ('restock','correction','damaged','sale','cancel_restore','admin_set','initial'), actor_type / actor_id, created_at. **Append-only** — inventory audit per REQUIREMENTS §9; no UPDATE/DELETE from application paths.

## 3. Relations (narrative)

- categories 1—N products; products 1—N images/specifications.
- users 1—N addresses/orders; users 1—1 cart, N—N wishlists.
- orders 1—N order_items, 1—N status history, 0—1+ payments.
- products 1—N stock_adjustments.

## 4. Planned indexes

- products: (category_id), (status, stock_quantity), (slug), (sku), (price), (created_at DESC) — serving §5–7 query paths.
- orders: (user_id, created_at DESC), (order_number), (status).
- order_items: (order_id). cart_items: (cart_id). stock_adjustments: (product_id, created_at).
- Final list must be re-verified against real query plans in the performance phase.

## 5. Open questions

- JSONB vs relational rows for product specifications (v0.1 chose relational for queryability).
- Session-token cart vs server-side guest cart storage — tied to stack ADR.
- Order number generator: sequence-per-day vs random tail — decide with implementation.
