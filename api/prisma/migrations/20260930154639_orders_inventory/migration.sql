-- CreateTable
CREATE TABLE "orders" (
    "id" BIGSERIAL NOT NULL,
    "order_number" VARCHAR(20) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "payment_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING_PAYMENT',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL,
    "shipping_total" DECIMAL(12,2) NOT NULL,
    "grand_total" DECIMAL(12,2) NOT NULL,
    "ship_receiver_name" VARCHAR(120) NOT NULL,
    "ship_phone" VARCHAR(24) NOT NULL,
    "ship_line1" VARCHAR(120) NOT NULL,
    "ship_line2" VARCHAR(120),
    "ship_city" VARCHAR(80) NOT NULL,
    "ship_state" VARCHAR(80) NOT NULL,
    "ship_postal_code" VARCHAR(16) NOT NULL,
    "ship_country_code" CHAR(2) NOT NULL,
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "product_name_snapshot" VARCHAR(120) NOT NULL,
    "sku_snapshot" VARCHAR(40) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL,
    "final_price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20) NOT NULL,
    "actor_type" VARCHAR(10) NOT NULL,
    "actor_id" BIGINT,
    "note" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "delta" INTEGER NOT NULL,
    "resulting_quantity" INTEGER NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "actor_type" VARCHAR(10) NOT NULL,
    "actor_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_adjustments_product_id_created_at_idx" ON "stock_adjustments"("product_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Contract invariants (docs/DATABASE_SCHEMA.md §2.9–§2.14) — the database
-- itself makes wrong order/inventory states unrepresentable.
-- =====================================================================

-- orders: ladder values, payment values, money coherence, number format
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check"
  CHECK ("status" IN ('pending','confirmed','shipped','delivered','cancelled'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_status_check"
  CHECK ("payment_status" IN ('PENDING_PAYMENT','PAID'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_check"
  CHECK (
    "subtotal" >= 0 AND "discount_total" >= 0 AND "shipping_total" >= 0
    AND "discount_total" <= "subtotal"
    AND "grand_total" = "subtotal" - "discount_total" + "shipping_total"
  );
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_format_check"
  CHECK ("order_number" ~ '^HEY-[0-9]{6}-[0-9]{4,}$');
ALTER TABLE "orders" ADD CONSTRAINT "orders_ship_country_check"
  CHECK ("ship_country_code" ~ '^[A-Z]{2}$');

-- order_items: snapshot arithmetic is exact
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_money_check"
  CHECK (
    "unit_price" >= 0 AND "discount_amount" >= 0 AND "final_price" > 0
    AND "quantity" > 0 AND "line_total" >= 0
    AND "final_price" = "unit_price" - "discount_amount"
    AND "line_total" = "final_price" * "quantity"
  );

-- order_status_history / stock_adjustments: enumerations
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_check"
  CHECK ("actor_type" IN ('USER','ADMIN','SYSTEM'));
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_reason_check"
  CHECK ("reason" IN ('restock','correction','damaged','sale','cancel_restore','admin_set','initial'));
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_actor_check"
  CHECK ("actor_type" IN ('USER','ADMIN','SYSTEM'));
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_result_check"
  CHECK ("resulting_quantity" >= 0 AND "delta" <> 0);

-- ---------------------------------------------------------------------
-- Immutability (§2.14). The app connects as the owning role, so REVOKE
-- would not bind it; row-level triggers do. TRUNCATE (dev/test seed reset
-- only) is not a row operation and stays available to the owner.
-- ---------------------------------------------------------------------

CREATE FUNCTION heyrah_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "order_items_append_only"
  BEFORE UPDATE OR DELETE ON "order_items"
  FOR EACH ROW EXECUTE FUNCTION heyrah_reject_mutation();
CREATE TRIGGER "order_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION heyrah_reject_mutation();
CREATE TRIGGER "stock_adjustments_append_only"
  BEFORE UPDATE OR DELETE ON "stock_adjustments"
  FOR EACH ROW EXECUTE FUNCTION heyrah_reject_mutation();

-- orders: never deleted; money + shipping snapshot + identity frozen.
-- Only status, payment_status, their milestone timestamps and updated_at move.
CREATE FUNCTION heyrah_orders_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
     OR NEW.shipping_total IS DISTINCT FROM OLD.shipping_total
     OR NEW.grand_total IS DISTINCT FROM OLD.grand_total
     OR NEW.ship_receiver_name IS DISTINCT FROM OLD.ship_receiver_name
     OR NEW.ship_phone IS DISTINCT FROM OLD.ship_phone
     OR NEW.ship_line1 IS DISTINCT FROM OLD.ship_line1
     OR NEW.ship_line2 IS DISTINCT FROM OLD.ship_line2
     OR NEW.ship_city IS DISTINCT FROM OLD.ship_city
     OR NEW.ship_state IS DISTINCT FROM OLD.ship_state
     OR NEW.ship_postal_code IS DISTINCT FROM OLD.ship_postal_code
     OR NEW.ship_country_code IS DISTINCT FROM OLD.ship_country_code
     OR NEW.placed_at IS DISTINCT FROM OLD.placed_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'order snapshot columns are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_guard"
  BEFORE UPDATE OR DELETE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION heyrah_orders_guard();
