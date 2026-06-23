import bcrypt from "bcryptjs";

/**
 * Password hashing (REQUIREMENTS §11.3): bcrypt, cost 12, per-user salt
 * (bcrypt embeds it). Plaintext never stored, logged, or returned.
 * bcryptjs — pure JS, no native build step; API is constant-time on verify.
 */
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
