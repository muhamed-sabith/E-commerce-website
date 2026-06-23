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
  /** Auth rate-limit ceiling per IP per window (API_CONTRACT §9 default: 10). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Auth rate-limit window in ms. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
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
