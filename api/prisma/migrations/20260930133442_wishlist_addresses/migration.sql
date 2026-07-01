-- CreateTable
CREATE TABLE "wishlists" (
    "user_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlists_pkey" PRIMARY KEY ("user_id","product_id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "receiver_name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(24) NOT NULL,
    "line1" VARCHAR(120) NOT NULL,
    "line2" VARCHAR(120),
    "city" VARCHAR(80) NOT NULL,
    "state" VARCHAR(80) NOT NULL,
    "postal_code" VARCHAR(16) NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- AddForeignKey
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contract invariants (docs/DATABASE_SCHEMA.md §2.8) — DB-level backstop
-- for the service rules.

-- One default address per user: at most one row with is_default = true.
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses"("user_id") WHERE "is_default";

-- ISO 3166-1 alpha-2: exactly two uppercase letters.
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_country_code_check"
  CHECK ("country_code" ~ '^[A-Z]{2}$');

-- Required text is never empty/blank.
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_required_nonblank_check"
  CHECK (
    btrim("receiver_name") <> '' AND btrim("phone") <> '' AND btrim("line1") <> ''
    AND btrim("city") <> '' AND btrim("state") <> '' AND btrim("postal_code") <> ''
  );
