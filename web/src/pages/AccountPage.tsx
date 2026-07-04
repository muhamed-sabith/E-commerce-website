import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, authApi } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import "./auth.css";

/**
 * Account overview (REQUIREMENTS §6.4): profile name edit, password change
 * (re-verifies current password), sign out. Success feedback says what
 * changed; the form is never cleared on error.
 */
export function AccountPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();

  // profile form
  const [name, setName] = useState(user?.name ?? "");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  async function handleProfileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileMessage(null);
    setProfileError(null);
    setSavingProfile(true);
    try {
      await authApi.updateProfile({ name });
      await refresh();
      setProfileMessage("Your name has been updated.");
    } catch (err) {
      setProfileError(
        err instanceof ApiRequestError && err.code === "validation_failed"
          ? "Enter your name to save."
          : "Couldn't save your name. Please try again.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setPasswordMessage("Your password has been changed.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "wrong_password") {
        setPasswordError("Current password is incorrect.");
      } else if (err instanceof ApiRequestError && err.code === "validation_failed") {
        setPasswordError("The new password needs at least 10 characters.");
      } else {
        setPasswordError("Couldn't change your password. Please try again.");
      }
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/products");
  }

  if (!user) return null; // ProtectedRoute guarantees presence; this satisfies types

  return (
    <main className="auth-page auth-page--wide">
      <h1 className="account-title">Your account</h1>

      <div className="account-grid">
        <section className="auth-card" aria-labelledby="profile-heading">
          <h2 className="auth-card__title auth-card__title--sub" id="profile-heading">
            Profile
          </h2>
          <p className="auth-card__meta">
            Signed in as <strong>{user.email}</strong>
          </p>

          {profileMessage && (
            <div role="status" className="auth-card__success">
              {profileMessage}
            </div>
          )}
          {profileError && (
            <div role="alert" className="auth-card__error">
              {profileError}
            </div>
          )}

          <form onSubmit={handleProfileSubmit} noValidate>
            <div className="field">
              <label htmlFor="acct-name">Full name</label>
              <input
                id="acct-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <button type="submit" className="auth-card__submit" disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save changes"}
            </button>
          </form>
        </section>

        <section className="auth-card" aria-labelledby="password-heading">
          <h2 className="auth-card__title auth-card__title--sub" id="password-heading">
            Password
          </h2>

          {passwordMessage && (
            <div role="status" className="auth-card__success">
              {passwordMessage}
            </div>
          )}
          {passwordError && (
            <div role="alert" className="auth-card__error">
              {passwordError}
            </div>
          )}

          <form onSubmit={handlePasswordSubmit} noValidate>
            <div className="field">
              <label htmlFor="acct-current">Current password</label>
              <input
                id="acct-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="acct-new">New password</label>
              <input
                id="acct-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={10}
                maxLength={128}
                aria-describedby="acct-new-hint"
              />
              <p className="field__hint" id="acct-new-hint">
                At least 10 characters.
              </p>
            </div>
            <button type="submit" className="auth-card__submit" disabled={savingPassword}>
              {savingPassword ? "Updating…" : "Change password"}
            </button>
          </form>
        </section>

        <section className="auth-card" aria-labelledby="shortcuts-heading">
          <h2 className="auth-card__title auth-card__title--sub" id="shortcuts-heading">
            Your pieces and places
          </h2>
          <ul className="account-links">
            <li>
              <Link to="/wishlist" className="account-links__item">
                <span className="account-links__label">Wishlist</span>
                <span className="account-links__meta">Saved pieces, with today's price</span>
              </Link>
            </li>
            <li>
              <Link to="/account/addresses" className="account-links__item">
                <span className="account-links__label">Addresses</span>
                <span className="account-links__meta">Delivery addresses and your default</span>
              </Link>
            </li>
          </ul>
        </section>

        <section className="auth-card auth-card--actions" aria-labelledby="session-heading">
          <h2 className="auth-card__title auth-card__title--sub" id="session-heading">
            Session
          </h2>
          <p className="auth-card__meta">
            Signed in as {user.name}. You can sign out on this device at any time.
          </p>
          <button type="button" className="auth-card__ghost" onClick={handleLogout}>
            Sign out
          </button>
          <p className="auth-card__switch">
            <Link to="/products">Continue shopping</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
