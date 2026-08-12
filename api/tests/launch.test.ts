import { describe, expect, it } from "vitest";
import { DEMO_ACK, loadEnv, productionProblems, envSchema } from "../src/config/env.js";
import { redact, scrubText } from "../src/lib/logger.js";
import { LocalDiskStorage, ensureUploadRoot, resolveKey } from "../src/lib/storage.js";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Phase 12 launch-readiness checks. Pure configuration/logging/storage
 * rules exercised with explicit inputs — no process env is changed, so
 * these run the same in development and CI.
 */

const GOOD_PROD = {
  NODE_ENV: "production",
  PORT: "4000",
  DATABASE_URL: "postgresql://heyrah:s3cretDbPass@db.internal:5432/heyrah",
  SESSION_SECRET: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  API_ALLOWED_ORIGIN: "https://shop.example.test",
  PUBLIC_SITE_URL: "https://shop.example.test",
  PAYMENT_MODE: "manual",
  TRUST_PROXY_HOPS: "1",
};

const prod = (over: Record<string, string | undefined> = {}) => loadEnv({ ...GOOD_PROD, ...over } as NodeJS.ProcessEnv);
const problems = (over: Record<string, string | undefined> = {}) => {
  const r = prod(over);
  return r.ok ? [] : r.problems;
};

describe("production configuration checks", () => {
  it("accepts a complete, safe production configuration", () => {
    const r = prod();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.env.PAYMENT_MODE).toBe("manual");
      expect(r.env.TRUST_PROXY_HOPS).toBe(1);
    }
  });

  it("rejects missing or placeholder secrets", () => {
    expect(problems({ SESSION_SECRET: undefined }).join()).toMatch(/SESSION_SECRET/);
    expect(problems({ SESSION_SECRET: "short" }).join()).toMatch(/SESSION_SECRET/);
    for (const s of [
      "replace-me-in-real-deployments-with-32-plus-chars",
      "change-me-to-a-random-32-char-minimum-value",
      "x".repeat(40),
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]) {
      expect(problems({ SESSION_SECRET: s }).join(), s).toMatch(/placeholder/);
    }
  });

  it("rejects accidental demo payment, unless explicitly acknowledged", () => {
    expect(problems({ PAYMENT_MODE: "demo" }).join()).toMatch(/PAYMENT_MODE=demo/);
    expect(problems({ PAYMENT_MODE: "demo", ALLOW_DEMO_PAYMENT_IN_PRODUCTION: "yes" }).join()).toMatch(/PAYMENT_MODE=demo/);
    expect(problems({ PAYMENT_MODE: "demo", ALLOW_DEMO_PAYMENT_IN_PRODUCTION: DEMO_ACK })).toEqual([]);
    expect(problems({ PAYMENT_MODE: "stripe" }).join()).toMatch(/PAYMENT_MODE/);
  });

  it("requires https, non-localhost, origin-only URLs that match", () => {
    expect(problems({ API_ALLOWED_ORIGIN: "http://shop.example.test", PUBLIC_SITE_URL: "http://shop.example.test" }).join()).toMatch(/https/);
    expect(problems({ API_ALLOWED_ORIGIN: "https://localhost:8080", PUBLIC_SITE_URL: "https://localhost:8080" }).join()).toMatch(/localhost/);
    expect(problems({ API_ALLOWED_ORIGIN: "https://shop.example.test/app" }).join()).toMatch(/origin only/);
    expect(problems({ PUBLIC_SITE_URL: undefined }).join()).toMatch(/PUBLIC_SITE_URL is required/);
    expect(problems({ PUBLIC_SITE_URL: "https://www.example.test" }).join()).toMatch(/same origin/);
    expect(problems({ API_ALLOWED_ORIGIN: "not a url" }).join()).toMatch(/API_ALLOWED_ORIGIN/);
  });

  it("requires a password-protected database and an explicit proxy hop count", () => {
    expect(problems({ DATABASE_URL: "postgresql://postgres@db:5432/heyrah" }).join()).toMatch(/DATABASE_URL has no password/);
    expect(problems({ TRUST_PROXY_HOPS: undefined }).join()).toMatch(/TRUST_PROXY_HOPS is required/);
    expect(problems({ TRUST_PROXY_HOPS: "true" }).join()).toMatch(/TRUST_PROXY_HOPS/);
    expect(problems({ TRUST_PROXY_HOPS: "9" }).join()).toMatch(/TRUST_PROXY_HOPS/);
  });

  it("rejects invalid shipping amounts and weakened limits", () => {
    expect(problems({ SHIPPING_FLAT_RATE: "-1" }).join()).toMatch(/SHIPPING_FLAT_RATE/);
    expect(problems({ SHIPPING_FREE_THRESHOLD: "99.999" }).join()).toMatch(/SHIPPING_FREE_THRESHOLD/);
    expect(problems({ RATE_LIMIT_MAX: "1000" }).join()).toMatch(/RATE_LIMIT_MAX/);
    expect(problems({ ADMIN_SESSION_IDLE_TTL_MINUTES: String(25 * 60) }).join()).toMatch(/ADMIN_SESSION_IDLE_TTL_MINUTES/);
    expect(problems({ UPLOAD_DIR: "" }).join()).toMatch(/UPLOAD_DIR/);
  });

  it("development and test keep permissive local defaults", () => {
    const dev = envSchema.parse({
      DATABASE_URL: "postgresql://postgres@localhost:5432/heyrah_dev",
      SESSION_SECRET: "change-me-to-a-random-32-char-minimum-value",
      API_ALLOWED_ORIGIN: "http://localhost:5173",
    });
    expect(productionProblems(dev)).toEqual([]);
    expect(productionProblems({ ...dev, NODE_ENV: "test", PAYMENT_MODE: "demo" })).toEqual([]);
  });

  it("never echoes configuration values in problems", () => {
    const secret = "replace-me-in-real-deployments-with-32-plus-chars";
    const all = problems({ SESSION_SECRET: secret, DATABASE_URL: "postgresql://postgres@db:5432/x" }).join("\n");
    expect(all).not.toContain(secret);
  });
});

describe("log redaction", () => {
  it("masks sensitive keys at any depth", () => {
    const out = redact({
      email: "a@b.c",
      password: "hunter2hunter2",
      headers: { cookie: "heyrah_session=abc", "x-csrf-token": "tok" },
      nested: { sessionToken: "s", card_number: "4111", ok: 1 },
    }) as Record<string, Record<string, unknown>>;
    expect(out.password).toBe("***");
    expect(out.headers.cookie).toBe("***");
    expect(out.headers["x-csrf-token"]).toBe("***");
    expect(out.nested.sessionToken).toBe("***");
    expect(out.nested.card_number).toBe("***");
    expect(out.nested.ok).toBe(1);
    expect(out.email).toBe("a@b.c");
  });

  it("scrubs credentials inside free text and error messages", () => {
    expect(scrubText("connect postgresql://heyrah:topSecret@db:5432/x failed")).toBe("connect postgresql://heyrah:***@db:5432/x failed");
    expect(scrubText("Cookie: heyrah_session=abcdef123; heyrah_csrf=zzz")).toBe("Cookie: heyrah_session=***; heyrah_csrf=***");
    const err = redact(new Error('bad {"password":"pw123456"} at postgres://u:p4ss@h/d')) as { message: string };
    expect(err.message).not.toMatch(/pw123456|p4ss/);
    expect(scrubText('violates check constraint. Failing row contains (3, Amira Rahman, +91 98765 43210, Kochi).')).toBe(
      "violates check constraint. Failing row contains (***).",
    );
  });
});

describe("image storage", () => {
  it("only resolves keys it generates, inside the root", () => {
    const root = path.resolve(tmpdir(), "heyrah-store");
    expect(resolveKey(root, "products/12/0b6f3a52-6a9a-4c0b-9b9f-1c1e5c8f2a10.webp")).toBe(path.join(root, "products", "12", "0b6f3a52-6a9a-4c0b-9b9f-1c1e5c8f2a10.webp"));
    for (const bad of ["../etc/passwd", "products/12/../../x.webp", "products/seed/hey-drs-00001-1.webp", "products/12/evil.php", "/abs/path.webp"]) {
      expect(resolveKey(root, bad), bad).toBeNull();
    }
  });

  it("creates the upload root, writes generated keys, never overwrites, ignores foreign removals", async () => {
    const root = path.join(mkdtempSync(path.join(tmpdir(), "heyrah-up-")), "nested", "uploads");
    await ensureUploadRoot(root);
    expect(existsSync(path.join(root, "products"))).toBe(true);
    const store = new LocalDiskStorage(root);
    const key = await store.put(7n, Buffer.from("webp-bytes"));
    expect(key).toMatch(/^products\/7\/[0-9a-f-]{36}\.webp$/);
    expect(existsSync(path.join(root, key))).toBe(true);
    writeFileSync(path.join(root, "keep.txt"), "x");
    await store.remove("../keep.txt");
    expect(existsSync(path.join(root, "keep.txt"))).toBe(true);
    await store.remove(key);
    expect(existsSync(path.join(root, key))).toBe(false);
  });

  it("fails fast when the upload root can't be created", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "heyrah-up-")), "a-file");
    writeFileSync(file, "x");
    await expect(ensureUploadRoot(path.join(file, "sub"))).rejects.toThrow(/not writable/);
  });
});
