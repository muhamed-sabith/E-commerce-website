import { z } from "zod";

/**
 * Auth boundary validation (REQUIREMENTS §11.1/§11.3). Trimmed, normalized
 * lowercase emails; documented password policy (min 10 chars); name required.
 * Mass-assignment protection: only these fields are ever parsed from input —
 * `role`, `isBlocked`, ids are NEVER client-settable.
 */
export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1, "Password is required").max(128),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
