-- CreateTable
CREATE TABLE "categories" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(90) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "discount_type" VARCHAR(10) NOT NULL DEFAULT 'none',
    "discount_value" DECIMAL(10,2),
    "category_id" BIGINT NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'active',
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "file_path" VARCHAR(255) NOT NULL,
    "alt_text" VARCHAR(200) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_specifications" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "spec_key" VARCHAR(60) NOT NULL,
    "spec_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "product_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_status_stock_quantity_idx" ON "products"("status", "stock_quantity");

-- CreateIndex
CREATE INDEX "products_price_idx" ON "products"("price");

-- CreateIndex
CREATE INDEX "products_created_at_idx" ON "products"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_images_product_id_position_key" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_specifications_product_id_spec_key_key" ON "product_specifications"("product_id", "spec_key");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- DATABASE_SCHEMA.md §2.14 — DB-enforced integrity (catalog)
-- ============================================================

-- §2.3 price must be positive
ALTER TABLE "products" ADD CONSTRAINT "products_price_positive_check" CHECK ("price" > 0);

-- §2.3 negative stock is unrepresentable at the DB level
ALTER TABLE "products" ADD CONSTRAINT "products_stock_non_negative_check" CHECK ("stock_quantity" >= 0);

-- §2.14 discount coherence (one compound CHECK):
--   none    → discount_value IS NULL
--   percent → 0 < discount_value < 100
--   fixed   → 0 < discount_value < price
ALTER TABLE "products" ADD CONSTRAINT "products_discount_coherence_check" CHECK (
    ("discount_type" = 'none' AND "discount_value" IS NULL)
    OR ("discount_type" = 'percent' AND "discount_value" IS NOT NULL AND "discount_value" > 0 AND "discount_value" < 100)
    OR ("discount_type" = 'fixed' AND "discount_value" IS NOT NULL AND "discount_value" > 0 AND "discount_value" < "price")
);

-- §1 enums as VARCHAR + CHECK (not native enums — easy to evolve)
ALTER TABLE "products" ADD CONSTRAINT "products_discount_type_check" CHECK ("discount_type" IN ('none', 'percent', 'fixed'));
ALTER TABLE "products" ADD CONSTRAINT "products_status_check" CHECK ("status" IN ('active', 'inactive', 'archived'));
