import "dotenv/config";
import { z } from "zod";

/**
 * Environment contract — validated once at boot with Zod (TECH_STACK.md).
 * The API must not start with an invalid environment.
 *
 * Production (NODE_ENV=production) adds deployment checks on top of the
 * shape checks (`productionProblems`): https origins, no localhost, no demo
 * payment unless explicitly acknowledged, no placeholder secrets, a real
 * proxy-hop count. Development and test keep permissive local defaults.
 */
const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "must be an amount like 99.00");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  /**
   * Reserved deployment secret (≥ 32 chars). Sessions use opaque random
   * tokens stored hashed, so nothing is signed with it today; it is still
   * required so a deployment can't ship with a known placeholder value.
   */
  SESSION_SECRET: z.string().min(32),
  /** Exact browser origin allowed by CORS (scheme://host[:port], no path). */
  API_ALLOWED_ORIGIN: z.string().url(),
  /** Hard ceiling on any session's lifetime (REQUIREMENTS §11.4). */
  SESSION_ABSOLUTE_TTL_HOURS: z.coerce.number().int().positive().max(24 * 90).default(168),
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
  /** Auth rate-limit ceiling per IP per window (API_CONTRACT §7 default: 10). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Auth rate-limit window in ms. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Number of reverse proxies in front of the API whose X-Forwarded-For
   * entries are trusted (Express `trust proxy`). 0 = trust none (the
   * socket address is the client). The compose stack has one (the web
   * server). Never `true`: that would let any client spoof its IP and
   * dodge the rate limiters.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
  /**
   * Payment mode (ARCHITECTURE §5.5). `demo` mounts the demo simulator;
   * `manual` (the safe default, and the production setting) unmounts it —
   * only admin manual confirmation can mark an order PAID.
   */
  PAYMENT_MODE: z.enum(["demo", "manual"]).default("manual"),
  /**
   * Required to run a production build in demo payment mode (a public demo
   * deployment). Must be the literal string "I_UNDERSTAND_NO_REAL_PAYMENTS".
   */
  ALLOW_DEMO_PAYMENT_IN_PRODUCTION: z.string().optional(),
  /** v1 shipping (REQUIREMENTS §8, decision 3): flat rate, free at/above a threshold. INR. */
  SHIPPING_FLAT_RATE: money.default("99.00"),
  SHIPPING_FREE_THRESHOLD: money.default("2999.00"),
  /**
   * Product image storage root (REQUIREMENTS §12.6). Re-encoded uploads are
   * written under `<UPLOAD_DIR>/products/<product-id>/` with generated names
   * and served read-only at /assets. Relative paths resolve from the API cwd.
   */
  UPLOAD_DIR: z.string().min(1).default("uploads"),
  /** Upload size ceiling in bytes (default 5 MB). */
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(20_000_000).default(5_000_000),
  /** `json` (one JSON object per line — production default) or `pretty` (development default). */
  LOG_FORMAT: z.enum(["json", "pretty"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Values shipped in templates/examples; never acceptable in production. */
const PLACEHOLDER_SECRETS = [
  /replace-me/i,
  /change-me/i,
  /^x+$/i,
  /example/i,
  /placeholder/i,
];

const isLocalHost = (u: URL) => ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(u.hostname);

export const DEMO_ACK = "I_UNDERSTAND_NO_REAL_PAYMENTS";

/**
 * Deployment checks for NODE_ENV=production. Pure: returns human-readable
 * problems (empty = OK) so tests can exercise every rule without exiting.
 */
export function productionProblems(e: Env): string[] {
  if (e.NODE_ENV !== "production") return [];
  const out: string[] = [];

  if (PLACEHOLDER_SECRETS.some((r) => r.test(e.SESSION_SECRET)) || new Set(e.SESSION_SECRET).size < 10) {
    out.push("SESSION_SECRET looks like a placeholder; generate a random value (e.g. 32+ random bytes, hex).");
  }

  const origin = new URL(e.API_ALLOWED_ORIGIN);
  if (origin.protocol !== "https:") out.push("API_ALLOWED_ORIGIN must use https:// in production (Secure cookies require TLS).");
  if (isLocalHost(origin)) out.push("API_ALLOWED_ORIGIN must not be localhost in production.");
  if (origin.pathname !== "/" || origin.search || origin.hash) out.push("API_ALLOWED_ORIGIN must be an origin only (no path, query, or hash).");

  if (!e.PUBLIC_SITE_URL) {
    out.push("PUBLIC_SITE_URL is required in production (canonical URLs, sitemap, robots.txt).");
  } else {
    const site = new URL(e.PUBLIC_SITE_URL);
    if (site.protocol !== "https:") out.push("PUBLIC_SITE_URL must use https:// in production.");
    if (isLocalHost(site)) out.push("PUBLIC_SITE_URL must not be localhost in production.");
    if (site.pathname !== "/" || site.search || site.hash) out.push("PUBLIC_SITE_URL must be an origin only (no path, query, or hash).");
    // The storefront is served from one origin; cookies are SameSite=strict.
    if (site.origin !== origin.origin) {
      out.push(`PUBLIC_SITE_URL (${site.origin}) and API_ALLOWED_ORIGIN (${origin.origin}) must be the same origin.`);
    }
  }

  const db = new URL(e.DATABASE_URL);
  if (!db.password) out.push("DATABASE_URL has no password; production databases must require authentication.");

  if (e.PAYMENT_MODE === "demo" && e.ALLOW_DEMO_PAYMENT_IN_PRODUCTION !== DEMO_ACK) {
    out.push(
      `PAYMENT_MODE=demo in production would let customers mark orders paid with the simulator. Use PAYMENT_MODE=manual, or set ALLOW_DEMO_PAYMENT_IN_PRODUCTION=${DEMO_ACK} for a public demo.`,
    );
  }

  if (e.TRUST_PROXY_HOPS === undefined) {
    out.push("TRUST_PROXY_HOPS is required in production: the number of reverse proxies in front of the API (compose: 1).");
  }

  if (e.SESSION_IDLE_TTL_HOURS * 60 < e.ADMIN_SESSION_IDLE_TTL_MINUTES) {
    out.push("ADMIN_SESSION_IDLE_TTL_MINUTES must not exceed the customer idle timeout.");
  }
  if (e.RATE_LIMIT_MAX > 100) out.push("RATE_LIMIT_MAX above 100/window weakens login brute-force protection.");

  return out;
}

/** Parse + validate. Exported for tests; the process uses `env` below. */
export function loadEnv(source: NodeJS.ProcessEnv): { ok: true; env: Env } | { ok: false; problems: string[] } {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const problems = productionProblems(parsed.data);
  return problems.length ? { ok: false, problems } : { ok: true, env: parsed.data };
}

const result = loadEnv(process.env);
if (!result.ok) {
  // Names only — never echo values (they may be secrets).
  console.error("[env] Invalid environment configuration:\n" + result.problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

export const env = result.env;

/** Express `trust proxy` value: an explicit hop count, never `true`. */
export const trustProxyHops = env.TRUST_PROXY_HOPS ?? 0;
