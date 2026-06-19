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
