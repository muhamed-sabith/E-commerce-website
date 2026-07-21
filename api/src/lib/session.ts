import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

/** Cryptographically random opaque token for the CSRF double-submit cookie. */
export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Server-side session store (REQUIREMENTS §11.4, ARCHITECTURE §5):
 * state lives in Postgres for instant revocation; the cookie carries only an
 * opaque 256-bit token whose sha256 is stored — a DB leak yields no sessions.
 * Every visitor gets a session (guests unauthenticated — the future cart keys
 * off it); login rotates the identifier and records the chain in rotated_from.
 */

const TOKEN_BYTES = 32;

export interface SessionRecord {
  id: string;
  userId: bigint | null;
  expiresAt: Date;
  lastSeenAt: Date;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

const absoluteTtlMs = () => env.SESSION_ABSOLUTE_TTL_HOURS * 60 * 60 * 1000;
const idleTtlMs = () => env.SESSION_IDLE_TTL_HOURS * 60 * 60 * 1000;
const adminIdleTtlMs = () => env.ADMIN_SESSION_IDLE_TTL_MINUTES * 60 * 1000;

/**
 * Create a session. `userId` null = guest session.
 * Returns the raw token — it exists only here and in the Set-Cookie header.
 */
export async function createSession(userId: bigint | null): Promise<string> {
  const token = newToken();
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + absoluteTtlMs()),
    },
  });
  return token;
}

/**
 * Resolve the live session for a token: must exist, be within the absolute
 * ceiling, and within the idle window (touching last_seen_at). Expired or
 * unknown tokens resolve to null; expired rows are swept opportunistically.
 */
export async function resolveSession(token: string): Promise<SessionRecord | null> {
  const id = hashToken(token);
  const now = new Date();

  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { role: true } } },
  });
  if (!session) return null;

  // Admin sessions idle out sooner (REQUIREMENTS §3.1). The role is read from
  // the users row on every resolution, so a promotion/demotion applies at once.
  const idle = session.user?.role === "ADMIN" ? adminIdleTtlMs() : idleTtlMs();
  if (session.expiresAt <= now || session.lastSeenAt.getTime() + idle <= now.getTime()) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }

  await prisma.session
    .update({ where: { id }, data: { lastSeenAt: now } })
    .catch(() => undefined);

  return {
    id: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
    lastSeenAt: now,
  };
}

/**
 * Login rotation: the incoming (guest) session is consumed and a fresh session
 * for `userId` is issued. The old id is recorded as rotated_from — the audit
 * chain the future guest-cart merge keys off. Old token becomes unusable.
 */
export async function rotateSession(
  oldToken: string | null,
  userId: bigint,
): Promise<string> {
  const oldId = oldToken ? hashToken(oldToken) : null;
  if (oldId) {
    await prisma.session.deleteMany({ where: { id: oldId } });
  }
  const token = await createSession(userId);
  if (oldId) {
    await prisma.session
      .update({ where: { id: hashToken(token) }, data: { rotatedFrom: oldId } })
      .catch(() => undefined);
  }
  return token;
}

/**
 * True when this (now dead) token was consumed by a login rotation — its
 * successor session records it in rotated_from. Such a client is about to
 * receive the new cookie from the login response, so it must NOT be handed
 * a replacement guest session (that would clobber the login).
 */
export async function wasRotatedAway(token: string): Promise<boolean> {
  const successor = await prisma.session.findFirst({
    where: { rotatedFrom: hashToken(token) },
    select: { id: true },
  });
  return successor !== null;
}

/** Logout: server-side revocation — the cookie value is dead on arrival. */
export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } }).catch(() => undefined);
}

/** Deterministic token factory for tests (timing-safe compare lives here too). */
export function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
