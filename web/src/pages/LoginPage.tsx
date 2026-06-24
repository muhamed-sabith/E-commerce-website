import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError, authApi } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import "./auth.css";

/**
 * Sign in (API_CONTRACT §1, REQUIREMENTS §7). One column, labels above,
 * generic failure copy (no user enumeration), typed data preserved on error.
 */
export function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from =
    typeof location.state?.from === "string" && location.state.from.startsWith("/")
      ? location.state.from
      : "/products";

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.login({ email, password });
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "validation_failed") {
        setError("Enter a valid email address and your password.");
      } else if (err instanceof ApiRequestError && err.code === "account_blocked") {
        setError("This account has been blocked. Contact support for help.");
      } else if (err instanceof ApiRequestError && err.code === "rate_limited") {
        setError("Too many attempts. Please wait a moment and try again.");
      } else {
        setError("Incorrect email or password.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Sign in</h1>
        <p className="auth-card__lede">
          Welcome back. Your cart and saved pieces are waiting.
        </p>

        {error && (
          <div role="alert" className="auth-card__error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-describedby="login-password-hint"
            />
          </div>

          <button type="submit" className="auth-card__submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-card__switch" id="login-password-hint">
          New to HEYRAH? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
