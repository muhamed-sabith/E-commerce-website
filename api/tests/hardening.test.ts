import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { configureLogger } from "../src/lib/logger.js";

/**
 * Phase 12 HTTP hardening: caching of identity responses, error envelopes
 * for malformed/oversized bodies, safe validation details, request ids,
 * health semantics, proxy-header handling. Real app, real PostgreSQL.
 */

let app: Express;
const base = "/api/v1";

beforeAll(() => {
  configureLogger({ quiet: true });
  app = createApp();
});
afterAll(async () => {
  configureLogger({ quiet: false });
  await prisma.$disconnect();
});

describe("cache control on per-visitor responses", () => {
  it("auth and account responses are private, no-store", async () => {
    for (const p of ["/auth/csrf", "/auth/me"]) {
      const res = await request(app).get(base + p);
      expect(res.headers["cache-control"], p).toBe("private, no-store");
    }
    const login = await request(app).post(base + "/auth/login").send({ email: "x@y.z", password: "nope" });
    expect(login.headers["cache-control"]).toBe("private, no-store");
  });

  it("health is never cached", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ status: "ok", database: "up" });
  });
});

describe("error envelopes", () => {
  async function csrfJar() {
    const r = await request(app).get(base + "/auth/csrf");
    const jar = new Map<string, string>();
    for (const line of (r.headers["set-cookie"] ?? []) as unknown as string[]) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), token: jar.get("heyrah_csrf")! };
  }

  it("malformed JSON is a 400 validation envelope, not a 500", async () => {
    const { cookie, token } = await csrfJar();
    const res = await request(app)
      .post(base + "/cart/items")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", token)
      .set("Content-Type", "application/json")
      .send('{"product_id": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at JSON|stack/);
  });

  it("oversized bodies are refused with 413", async () => {
    const { cookie, token } = await csrfJar();
    const res = await request(app)
      .post(base + "/cart/items")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", token)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ pad: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  it("validation details never echo what the client sent", async () => {
    const { cookie, token } = await csrfJar();
    const secretish = "my-secret-password-value";
    const res = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", token)
      .send({ name: "A", email: "not-an-email", password: 12345, note: secretish });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(secretish);
    expect(JSON.stringify(res.body)).not.toMatch(/"received"/);
    for (const d of res.body.error.details) expect(Object.keys(d).sort()).toEqual(["code", "message", "path"]);
  });
});

describe("request ids", () => {
  it("issues one per request and reuses a safe upstream id", async () => {
    const a = await request(app).get(base + "/categories");
    expect(a.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app).get(base + "/categories").set("X-Request-Id", "web-abc12345");
    expect(b.headers["x-request-id"]).toBe("web-abc12345");
    // Node rejects header values with newlines before they reach us; a spaced/markup value must be replaced.
    const c = await request(app).get(base + "/categories").set("X-Request-Id", "bad id <script>");
    expect(c.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("proxy headers", () => {
  it("does not trust client-supplied X-Forwarded-For without configured hops", async () => {
    // In test, TRUST_PROXY_HOPS is unset (0): spoofed forwarding headers are ignored.
    expect(app.get("trust proxy")).toBe(0);
  });
});
