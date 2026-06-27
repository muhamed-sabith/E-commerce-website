/**
 * Typed auth + account API surface (API_CONTRACT §1). Transport, CSRF, and
 * error envelopes live in the shared client (./client).
 */
import { apiRequest, ApiRequestError, ensureCsrf } from "./client";
import type { MergeReport } from "./cart";

export { ApiRequestError, ensureCsrf };

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
}

/** Login/register answer; merge_report is present when a guest cart existed. */
export interface AuthResult {
  user: PublicUser;
  merge_report?: MergeReport;
}

export const authApi = {
  register(input: { name: string; email: string; password: string }): Promise<AuthResult> {
    return apiRequest("/api/v1/auth/register", { method: "POST", body: input });
  },
  login(input: { email: string; password: string }): Promise<AuthResult> {
    return apiRequest("/api/v1/auth/login", { method: "POST", body: input });
  },
  logout(): Promise<{ ok: boolean }> {
    return apiRequest("/api/v1/auth/logout", { method: "POST" });
  },
  me(): Promise<{ user: PublicUser | null }> {
    return apiRequest("/api/v1/auth/me");
  },
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ ok: boolean }> {
    return apiRequest("/api/v1/account/password", { method: "PATCH", body: input });
  },
  updateProfile(input: { name: string }): Promise<{ user: PublicUser }> {
    return apiRequest("/api/v1/account/profile", { method: "PATCH", body: input });
  },
};
