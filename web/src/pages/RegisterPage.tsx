import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError, authApi } from "../api/auth";
import { hasMergeNews } from "../api/cart";
import { useAuth } from "../auth/AuthContext";
import { useCart } from "../cart/CartContext";
import "./auth.css";

/**
 * Create account (API_CONTRACT §1, REQUIREMENTS §11.1). Password policy
 * stated before typing, not as an error afterwards. Field-level server
 * errors map back to the specific input. Like sign-in, it returns the
 * shopper to where she was headed (e.g. checkout) once the account exists.
 */
export function RegisterPage() {
  const { refresh } = useAuth();
  const { showMergeReport } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    typeof location.state?.from === "string" && location.state.from.startsWith("/")
      ? location.state.from
      : "/products";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authApi.register({ name, email, password });
      showMergeReport(hasMergeNews(result.merge_report) ? result.merge_report : null);
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "email_taken") {
          setError("An account with this email already exists. Try signing in instead.");
        } else if (err.code === "validation_failed") {
          setError("Check your details — the password needs at least 10 characters.");
        } else if (err.code === "rate_limited") {
          setError("Too many attempts. Please wait a moment and try again.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Couldn't create your account. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Create account</h1>
        <p className="auth-card__lede">Join HEYRAH — your wardrobe, considered.</p>

        {error && (
          <div role="alert" className="auth-card__error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="reg-name">Full name</label>
            <input
              id="reg-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>

          <div className="field">
            <label htmlFor="reg-email">Email address</label>
            <input
              id="reg-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              maxLength={128}
              aria-describedby="reg-password-hint"
            />
            <p className="field__hint" id="reg-password-hint">
              At least 10 characters.
            </p>
          </div>

          <button type="submit" className="auth-card__submit" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="auth-card__switch">
          Already have an account?{" "}
          <Link to="/login" state={{ from }}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
