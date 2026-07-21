import "dotenv/config";
import { z } from "zod";

/**
 * Environment contract — validated once at boot with Zod (TECH_STACK.md).
 * The API must not start with an invalid environment.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  API_ALLOWED_ORIGIN: z.string().url(),
  /** Hard ceiling on any session's lifetime (REQUIREMENTS §11.4). */
  SESSION_ABSOLUTE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  /** Idle expiry: session dies after this much inactivity. */
  SESSION_IDLE_TTL_HOURS: z.coerce.number().int().positive().default(24),
  /** Admin sessions end after this much inactivity (REQUIREMENTS §3.1: shorter than customers). */
  ADMIN_SESSION_IDLE_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  /**
   * Public storefront origin, used for canonical URLs, the sitemap, and
   * robots.txt. Defaults to the allowed web origin.
   */
  PUBLIC_SITE_URL: z.string().url().optional(),
  /** Public catalog read limit per IP per minute (search burst-cooling, API_CONTRACT §7). */
  CATALOG_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  /** Auth rate-limit ceiling per IP per window (API_CONTRACT §9 default: 10). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Auth rate-limit window in ms. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Payment mode (ARCHITECTURE §5.5). `demo` mounts the demo simulator;
   * `manual` (the safe default, and the production setting) unmounts it —
   * only admin manual confirmation can mark an order PAID.
   */
  PAYMENT_MODE: z.enum(["demo", "manual"]).default("manual"),
  /** v1 shipping (REQUIREMENTS §8, decision 3): flat rate, free at/above a threshold. INR. */
  SHIPPING_FLAT_RATE: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/)
    .default("99.00"),
  SHIPPING_FREE_THRESHOLD: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/)
    .default("2999.00"),
  /**
   * Product image storage root (REQUIREMENTS §12.6). Re-encoded uploads are
   * written under `<UPLOAD_DIR>/products/<product-id>/` with generated names
   * and served read-only at /assets. Relative paths resolve from the API cwd.
   */
  UPLOAD_DIR: z.string().min(1).default("uploads"),
  /** Upload size ceiling in bytes (default 5 MB). */
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(20_000_000).default(5_000_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "[env] Invalid environment configuration:\n" +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
  );
  process.exit(1);
}

export const env = parsed.data;
