import { prisma } from "../lib/prisma.js";
import { ApiError } from "../middleware/error.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createSession, destroySession, rotateSession } from "../lib/session.js";
import type {
  LoginInput,
  PasswordChangeInput,
  ProfileUpdateInput,
  RegisterInput,
} from "./auth.schemas.js";

/**
 * Auth business rules (REQUIREMENTS §11, API_CONTRACT §1):
 * - email uniqueness; normalized lowercase (§11.1)
 * - generic login failure — identical error for unknown email and wrong
 *   password; no user enumeration (§11.2)
 * - blocked users cannot authenticate or hold a working session (§3.10)
 * - session rotation at login; server-side revocation at logout (§11.4)
 * - password change re-verifies the current password (§11.4)
 * - role/isBlocked come from the DB only — never from input (mass assignment)
 */

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
}

/** Wire shape — never exposes password_hash, is_blocked internals, or ids as numbers. */
function toPublicUser(user: {
  id: bigint;
  name: string;
  email: string;
  role: string;
}): PublicUser {
  return {
    id: user.id.toString(),
    name: user.name,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
  };
}

/** Generic credential failure — one shape for every auth rejection (§11.2). */
function invalidCredentials(): ApiError {
  return new ApiError(401, "invalid_credentials", "Incorrect email or password.");
}

export const authService = {
  async register(input: RegisterInput): Promise<PublicUser> {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ApiError(409, "email_taken", "An account with this email already exists.");
    }
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: "USER", // fixed — registration never creates admins
      },
    });
    return toPublicUser(user);
  },

  async login(input: LoginInput): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      // Burn a real hash comparison so timing does not reveal existence.
      await verifyPassword(input.password, DUMMY_HASH);
      throw invalidCredentials();
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      throw invalidCredentials();
    }
    if (user.isBlocked) {
      throw new ApiError(403, "account_blocked", "This account has been blocked.");
    }
    return toPublicUser(user);
  },

  async changePassword(userId: bigint, input: PasswordChangeInput): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiError(401, "authentication_required", "Please sign in to continue.");
    }
    const ok = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!ok) {
      throw new ApiError(400, "wrong_password", "Current password is incorrect.");
    }
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  },

  async updateProfile(userId: bigint, input: ProfileUpdateInput): Promise<PublicUser> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
    });
    return toPublicUser(user);
  },

  /** Session lifecycle helpers — the controller wires them to cookies. */
  async startSession(userId: bigint | null): Promise<string> {
    return createSession(userId);
  },

  async rotateLoginSession(oldToken: string | null, userId: bigint): Promise<string> {
    return rotateSession(oldToken, userId);
  },

  async endSession(token: string): Promise<void> {
    await destroySession(token);
  },
};

/** Randomly-shaped bcrypt hash used for the timing-equal "no such user" path. */
const DUMMY_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBk0H3DlGiE8vC0OQ0uVQEqEoUqVxu";
