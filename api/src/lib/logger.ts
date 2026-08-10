/**
 * Minimal structured logger (no dependency). Production: one JSON object per
 * line on stdout/stderr, ready for any log collector. Development: compact
 * readable lines. Every field passes through `redact` so passwords, tokens,
 * cookies, CSRF values, secrets, and connection strings never reach a log.
 */

type Level = "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|csrf|authorization|session|card|cvv|upi|pin|database_url/i;
const MAX_DEPTH = 4;

/** Mask anything that looks like a credential inside free text. */
export function scrubText(s: string): string {
  return s
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1***@")
    .replace(/(heyrah_(?:session|csrf)=)[^;\s]+/gi, "$1***")
    .replace(/(x-csrf-token["':\s=]+)[A-Za-z0-9_-]{16,}/gi, "$1***")
    .replace(/("?password"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"')
    // PostgreSQL echoes the offending row (names, addresses, phones) in constraint errors.
    .replace(/(Failing row contains )\([^)]*\)/g, "$1(***)");
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message), ...(value.stack ? { stack: scrubText(value.stack) } : {}) };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? "***" : redact(v, depth + 1);
  }
  return out;
}

let format: "json" | "pretty" = process.env.NODE_ENV === "production" ? "json" : "pretty";
// Test runs keep warnings/errors but not one access-log line per request.
let quiet = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export function configureLogger(opts: { format?: "json" | "pretty"; quiet?: boolean }) {
  if (opts.format) format = opts.format;
  if (opts.quiet !== undefined) quiet = opts.quiet;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (quiet && level === "info") return;
  const safe = fields ? (redact(fields) as Record<string, unknown>) : undefined;
  const stream = level === "info" ? process.stdout : process.stderr;
  if (format === "json") {
    stream.write(JSON.stringify({ time: new Date().toISOString(), level, msg: scrubText(msg), ...safe }) + "\n");
  } else {
    const extra = safe && Object.keys(safe).length ? " " + JSON.stringify(safe) : "";
    stream.write(`[${level}] ${scrubText(msg)}${extra}\n`);
  }
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
