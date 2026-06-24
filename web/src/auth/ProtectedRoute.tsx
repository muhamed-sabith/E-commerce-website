import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

/**
 * Client-side route guard — UX only (REQUIREMENTS §11.6): the server is the
 * authority; this just avoids showing an authenticated page to a signed-out
 * visitor. Preserves the requested path so login returns the user to it.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth();
  const location = useLocation();

  if (restoring) {
    return (
      <main className="auth-page">
        <p className="auth-restoring" role="status">
          Checking your session…
        </p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
