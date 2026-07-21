-- CreateTable
CREATE TABLE "store_pages" (
    "slug" VARCHAR(20) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" TEXT NOT NULL,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_pages_pkey" PRIMARY KEY ("slug")
);

-- Only the fixed policy/contact slugs; text must be non-blank and bounded.
ALTER TABLE "store_pages" ADD CONSTRAINT "store_pages_slug_check"
  CHECK ("slug" IN ('privacy','terms','returns','shipping','contact'));
ALTER TABLE "store_pages" ADD CONSTRAINT "store_pages_text_check"
  CHECK (btrim("title") <> '' AND btrim("body") <> '' AND char_length("body") <= 20000);