import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import { useWishlist } from "./WishlistContext";
import "./wishlist.css";

/**
 * Save-for-later toggle (REQUIREMENTS §2.9). A real toggle button
 * (aria-pressed) with a visible text label — state never by icon or color
 * alone. Guests are sent to sign in when they actually try to save; the
 * catalog stays browsable without an account.
 */
export function SaveToggle({
  productId,
  productName,
  variant = "inline",
}: {
  productId: string;
  productName: string;
  variant?: "inline" | "compact";
}) {
  const { status, isSaved, save, remove, pending } = useWishlist();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  const saved = isSaved(productId);
  const busy = pending.has(productId);
  const known = status === "ready" || status === "guest";

  async function toggle() {
    setError(null);
    if (status === "guest") {
      navigate("/login", { state: { from: location.pathname + location.search } });
      return;
    }
    if (busy || !known) return;
    try {
      if (saved) await remove(productId);
      else await save(productId);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === "unknown_resource"
          ? "This piece can't be saved right now."
          : "Couldn't update your wishlist. Try again.",
      );
    }
  }

  // Name starts with the visible word (voice control: "click Save"); the
  // pressed state carries saved/unsaved for screen readers.
  return (
    <span className={`save-toggle-wrap save-toggle-wrap--${variant}`}>
      <button
        type="button"
        className={`save-toggle save-toggle--${variant}${saved ? " is-saved" : ""}`}
        aria-pressed={status === "guest" ? undefined : saved}
        aria-disabled={busy || !known}
        onClick={() => void toggle()}
        data-testid="save-toggle"
      >
        <svg className="save-toggle__mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {/* bookmark ribbon — quiet, not a heart */}
          <path d="M4 2.5h8v11l-4-2.6-4 2.6z" />
        </svg>
        <span className="save-toggle__label">{saved ? "Saved" : "Save"}</span>
        <span className="sr-only"> {productName} to wishlist</span>
      </button>
      {error ? (
        <span className="save-toggle__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
