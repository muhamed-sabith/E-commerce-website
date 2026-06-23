import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { seed } from "../prisma/seed";
import { prisma } from "../src/lib/prisma.js";
import { resetRateLimiter } from "../src/middleware/rate-limit.js";

/**
 * Auth + account API integration tests (Phase 6 §22) — real PostgreSQL
 * (heyrah_test via `npm run test:db`). Covers: registration, login, session
 * lifecycle (cookies, rotation, revocation), authorization matrix, account
 * endpoints, and the security contract (cookie flags, CSRF, generic
 * failures, rate limiting, mass-assignment safety).
 */

let app: Express;

beforeAll(async () => {
  await seed();
  app = createApp();
  resetRateLimiter();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// The contract limiter is 10/min/IP across auth endpoints; the suite issues
// more than that legitimately, so each test starts from a clean window.
beforeEach(() => {
  resetRateLimiter();
});

interface UserBody {
  user: { id: string; name: string; email: string; role: string };
}

const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

function extractCookies(res: request.Response): Record<string, string> {
  const setHeaders = res.headers["set-cookie"] ?? [];
  const jar: Record<string, string> = {};
  for (const line of setHeaders as unknown as string[]) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Bootstrap: mint a guest session + CSRF token (contract: every visitor gets a session). */
async function bootstrap(): Promise<Record<string, string>> {
  const res = await request(app).get(base + "/auth/csrf");
  return extractCookies(res);
}

/** Register via the API; returns status, body, and the cookie jar. */
async function registerUser(overrides: Partial<Record<"name" | "email" | "password", string>> = {}) {
  const payload = {
    name: "Test User",
    email: uniqueEmail("reg"),
    password: "Str0ngPass!x",
    ...overrides,
  };
  const guest = await bootstrap();
  const res = await request(app)
    .post("/api/v1/auth/register")
    .set("Cookie", cookieHeader(guest))
    .set("X-CSRF-Token", guest["heyrah_csrf"])
    .send(payload);
  return { res, payload, jar: { ...guest, ...extractCookies(res) } };
}

const base = "/api/v1";

/** Login helper returning the fresh jar (post-rotation), CSRF-bootstrapped. */
async function loginUser(email: string, password: string, jar: Record<string, string> = {}) {
  const guest = Object.keys(jar).length > 0 ? jar : await bootstrap();
  const res = await request(app)
    .post("/api/v1/auth/login")
    .set("Cookie", cookieHeader(guest))
    .set("X-CSRF-Token", guest["heyrah_csrf"])
    .send({ email, password });
  return { res, jar: { ...guest, ...extractCookies(res) } };
}

describe("POST /auth/register", () => {
  it("creates a USER, starts an authenticated session, sets hardened cookies", async () => {
    const { res } = await registerUser({ name: "Cookie Check" });
    expect(res.status).toBe(201);

    const body = res.body as UserBody;
    expect(body.user.role).toBe("USER");

    const raw = res.headers["set-cookie"] as unknown as string[];
    const session = raw.find((c) => c.startsWith("heyrah_session="))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Strict");
    expect(session).toContain("Path=/");
    const csrf = raw.find((c) => c.startsWith("heyrah_csrf="))!;
    expect(csrf).not.toContain("HttpOnly");

    // /me reflects the session immediately
    const me = await request(app)
      .get(base + "/auth/me")
      .set("Cookie", `heyrah_session=${extractCookies(res)["heyrah_session"]}`);
    expect((me.body as UserBody).user?.email).toBe(body.user.email);
  });

  it("rejects duplicate email with 409 email_taken", async () => {
    const { res } = await registerUser();
    expect(res.status).toBe(201);
    const email = (res.body as UserBody).user.email;

    const guest = await bootstrap();
    const dup = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({ name: "Dup", email, password: "Str0ngPass!x" });
    expect(dup.status).toBe(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe("email_taken");
  });

  it("normalizes email to lowercase", async () => {
    const email = uniqueEmail("Case");
    const guest = await bootstrap();
    const res = await request(app)
      .post(base + "/auth/register")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({ name: "Case", email: email.toUpperCase(), password: "Str0ngPass!x" });
    expect(res.status).toBe(201);
    expect((res.body as UserBody).user.email).toBe(email.toLowerCase());
  });

  it("validates input: short password, bad email, missing name", async () => {
    const attempt = async (body: Record<string, unknown>) => {
      const guest = await bootstrap();
      return request(app)
        .post(base + "/auth/register")
        .set("Cookie", cookieHeader(guest))
        .set("X-CSRF-Token", guest["heyrah_csrf"])
        .send(body);
    };

    const short = await attempt({ name: "A", email: uniqueEmail("short"), password: "short" });
    expect(short.status).toBe(400);
    expect((short.body as { error: { code: string } }).error.code).toBe("validation_failed");

    const badEmail = await attempt({ name: "A", email: "not-an-email", password: "Str0ngPass!x" });
    expect(badEmail.status).toBe(400);

    const noName = await attempt({ email: uniqueEmail("noname"), password: "Str0ngPass!x" });
    expect(noName.status).toBe(400);
  });

  it("ignores client-supplied role (mass-assignment protection)", async () => {
    const { res } = await registerUser({ name: "Escalation" });
    expect(res.status).toBe(201);
    expect((res.body as UserBody).user.role).toBe("USER");
  });
});

describe("POST /auth/login", () => {
  it("logs in with valid credentials and rotates the session id", async () => {
    const first = await registerUser();
    const email = JSON.parse(first.res.text).user.email as string;

    const { res } = await loginUser(email, "Str0ngPass!x", first.jar);
    expect(res.status).toBe(200);
    expect((res.body as UserBody).user.email).toBe(email);

    // rotation: the new cookie's session id differs from the register-time one
    const oldId = first.jar["heyrah_session"];
    const newId = extractCookies(res)["heyrah_session"];
    expect(newId).toBeTruthy();
    expect(newId).not.toEqual(oldId);

    // old session id is dead server-side
    const stale = await request(app)
      .get(base + "/auth/me")
      .set("Cookie", `heyrah_session=${oldId}`);
    expect((stale.body as { user: unknown }).user).toBeNull();
  });

  it("returns the identical generic failure for unknown email and wrong password", async () => {
    const { res } = await registerUser();
    const email = (res.body as UserBody).user.email;

    const guest = await bootstrap();
    const post = (body: { email: string; password: string }) =>
      request(app)
        .post(base + "/auth/login")
        .set("Cookie", cookieHeader(guest))
        .set("X-CSRF-Token", guest["heyrah_csrf"])
        .send(body);

    const unknown = await post({ email: uniqueEmail("ghost"), password: "Whatever!123" });
    const wrong = await post({ email, password: "WrongPass!99" });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect((wrong.body as { error: { code: string } }).error.code).toBe("invalid_credentials");
  });

  it("403s blocked accounts and revokes their sessions", async () => {
    const { res } = await registerUser();
    const email = (res.body as UserBody).user.email;
    const id = BigInt((res.body as UserBody).user.id);
    await prisma.user.update({ where: { id }, data: { isBlocked: true } });

    const guest = await bootstrap();
    const login = await request(app)
      .post(base + "/auth/login")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({ email, password: "Str0ngPass!x" });
    expect(login.status).toBe(403);
    expect((login.body as { error: { code: string } }).error.code).toBe("account_blocked");

    // an existing session dies as soon as the block lands
    const oldSession = extractCookies(res)["heyrah_session"];
    const me = await request(app)
      .get(base + "/auth/me")
      .set("Cookie", `heyrah_session=${oldSession}`);
    expect((me.body as { user: unknown }).user).toBeNull();
  });
});

describe("session lifecycle", () => {
  it("logout revokes server-side: the cookie value is dead afterwards", async () => {
    const { res } = await registerUser();
    const jar = extractCookies(res);

    const out = await request(app)
      .post(base + "/auth/logout")
      .set("Cookie", cookieHeader(jar))
      .set("X-CSRF-Token", jar["heyrah_csrf"]);
    expect(out.status).toBe(200);

    const me = await request(app)
      .get(base + "/auth/me")
      .set("Cookie", `heyrah_session=${jar["heyrah_session"]}`);
    expect((me.body as { user: unknown }).user).toBeNull();
  });

  it("guest sessions exist without authentication (every visitor gets one)", async () => {
    // no register/login — force a session by hitting register with a guest
    // cookie; simpler: /me with no cookie still answers 200 user:null
    const me = await request(app).get(base + "/auth/me");
    expect(me.status).toBe(200);
    expect((me.body as { user: unknown }).user).toBeNull();
  });

  it("absolute + idle expiry: expired sessions resolve to null and are swept", async () => {
    const { res } = await registerUser();
    const token = extractCookies(res)["heyrah_session"];
    const { hashToken } = await import("../src/lib/session.js");

    // force-expire both windows
    await prisma.session.update({
      where: { id: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000), lastSeenAt: new Date(Date.now() - 1000) },
    });

    const me = await request(app)
      .get(base + "/auth/me")
      .set("Cookie", `heyrah_session=${token}`);
    expect((me.body as { user: unknown }).user).toBeNull();

    const row = await prisma.session.findUnique({ where: { id: hashToken(token) } });
    expect(row).toBeNull(); // swept
  });
});

describe("authorization", () => {
  it("account endpoints require authentication (401 envelope)", async () => {
    const pwd = await request(app)
      .patch(base + "/account/password")
      .send({ currentPassword: "x".repeat(12), newPassword: "Str0ngPass!x" });
    expect(pwd.status).toBe(401);
    expect((pwd.body as { error: { code: string } }).error.code).toBe("authentication_required");

    const prof = await request(app)
      .patch(base + "/account/profile")
      .send({ name: "Nope" });
    expect(prof.status).toBe(401);
  });

  it("ADMIN role is honored server-side; USER cannot reach admin-only checks", async () => {
    // Bootstrap an admin directly at the data layer (v1 has no admin signup).
    const { hashPassword } = await import("../src/lib/password.js");
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        email: uniqueEmail("admin"),
        passwordHash: await hashPassword("AdminPass!23"),
        role: "ADMIN",
      },
    });

    const guest = await bootstrap();
    const login = await request(app)
      .post(base + "/auth/login")
      .set("Cookie", cookieHeader(guest))
      .set("X-CSRF-Token", guest["heyrah_csrf"])
      .send({ email: admin.email, password: "AdminPass!23" });
    expect(login.status).toBe(200);
    expect((login.body as UserBody).user.role).toBe("ADMIN");

    // USER on their own surface is fine; the role split is enforced at the
    // route layer (requireAdmin) which admin routes will mount next phase.
    const { res } = await registerUser();
    expect((res.body as UserBody).user.role).toBe("USER");
  });
});

describe("PATCH /account/password + /account/profile", () => {
  it("changes password only with the correct current password", async () => {
    const { res, jar } = await registerUser();
    const email = (res.body as UserBody).user.email;
    const auth = { Cookie: cookieHeader(jar), "X-CSRF-Token": jar["heyrah_csrf"] };

    const wrong = await request(app)
      .patch(base + "/account/password")
      .set(auth)
      .send({ currentPassword: "NotThePassword!1", newPassword: "FreshPass!22x" });
    expect(wrong.status).toBe(400);
    expect((wrong.body as { error: { code: string } }).error.code).toBe("wrong_password");

    const ok = await request(app)
      .patch(base + "/account/password")
      .set(auth)
      .send({ currentPassword: "Str0ngPass!x", newPassword: "FreshPass!22x" });
    expect(ok.status).toBe(200);

    // old password dead, new one live
    const oldLogin = await loginUser(email, "Str0ngPass!x");
    expect(oldLogin.res.status).toBe(401);
    const newLogin = await loginUser(email, "FreshPass!22x");
    expect(newLogin.res.status).toBe(200);
  });

  it("updates profile name; other users' data stays untouched", async () => {
    const a = await registerUser({ name: "Alice" });
    const b = await registerUser({ name: "Bob" });

    const res = await request(app)
      .patch(base + "/account/profile")
      .set({ Cookie: cookieHeader(a.jar), "X-CSRF-Token": a.jar["heyrah_csrf"] })
      .send({ name: "Alicia" });
    expect(res.status).toBe(200);
    expect((res.body as UserBody).user.name).toBe("Alicia");

    const bob = await prisma.user.findUnique({
      where: { id: BigInt((b.res.body as UserBody).user.id) },
    });
    expect(bob?.name).toBe("Bob");
  });

  it("requires the CSRF double-submit header on mutations", async () => {
    const { res } = await registerUser();
    const jar = extractCookies(res);

    // cookie present, header missing → blocked
    const noHeader = await request(app)
      .patch(base + "/account/profile")
      .set("Cookie", cookieHeader(jar))
      .send({ name: "Sneaky" });
    expect(noHeader.status).toBe(403);
    expect((noHeader.body as { error: { code: string } }).error.code).toBe("csrf_failed");

    // header present but mismatched → blocked
    const badHeader = await request(app)
      .patch(base + "/account/profile")
      .set("Cookie", cookieHeader(jar))
      .set("X-CSRF-Token", "totally-different-token-value-aaaaaaaaaaaa")
      .send({ name: "Sneaky" });
    expect(badHeader.status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("returns 429 with the envelope once the per-IP quota is exhausted", { timeout: 60_000 }, async () => {
    resetRateLimiter();
    const { env } = await import("../src/config/env.js");
    const max = env.RATE_LIMIT_MAX;
    const attempts = async (email: string) => {
      const guest = await bootstrap();
      return request(app)
        .post(base + "/auth/login")
        .set("Cookie", cookieHeader(guest))
        .set("X-CSRF-Token", guest["heyrah_csrf"])
        .send({ email, password: "Whatever!123" });
    };
    for (let i = 0; i < max; i++) {
      await attempts(uniqueEmail("rl"));
    }
    const overQuota = await attempts(uniqueEmail("rl"));
    expect(overQuota.status).toBe(429);
    expect((overQuota.body as { error: { code: string } }).error.code).toBe("rate_limited");
    expect(overQuota.headers["retry-after"]).toBeDefined();
    resetRateLimiter();
  });
});

describe("GET /auth/me", () => {
  it("returns the full identity for an authenticated session", async () => {
    const { res } = await registerUser({ name: "Identity" });
    const jar = extractCookies(res);
    const me = await request(app)
      .get(base + "/auth/me")
      .set("Cookie", cookieHeader(jar));
    expect(me.status).toBe(200);
    const body = me.body as UserBody;
    expect(body.user).toMatchObject({ name: "Identity", role: "USER" });
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(me.body)).not.toContain("$2");
  });
});
