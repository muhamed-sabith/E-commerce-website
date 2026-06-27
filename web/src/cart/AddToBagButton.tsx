import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import { useCart } from "./CartContext";
import "./add-to-bag.css";

/**
 * Add-to-bag action. Sends only the backend product id + a quantity; the
 * server validates stock/status and answers with the recomputed cart.
 * Unavailable products get a disabled, clearly labelled control — never a
 * button that looks purchasable.
 */
export function AddToBagButton({
  productId,
  productName,
  available,
  variant = "primary",
}: {
  productId: string;
  productName: string;
  available: boolean;
  variant?: "primary" | "compact";
}) {
  const { addItem } = useCart();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "adding" } | { kind: "added" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const className = variant === "compact" ? "add-to-bag add-to-bag--compact" : "add-to-bag";

  if (!available) {
    return (
      <button type="button" className={className} disabled>
        {variant === "compact" ? "Out of stock" : "Unavailable"}
      </button>
    );
  }

  async function handleAdd() {
    setState({ kind: "adding" });
    try {
      await addItem(productId, 1, productName);
      setState({ kind: "added" });
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof ApiRequestError
            ? err.message
            : "Couldn't add this piece. Check your connection and try again.",
      });
    }
  }

  const label = state.kind === "adding" ? "Adding…" : "Add to bag";

  return (
    <div className={variant === "compact" ? "add-to-bag-wrap add-to-bag-wrap--compact" : "add-to-bag-wrap"}>
      <button
        type="button"
        className={className}
        onClick={() => void handleAdd()}
        disabled={state.kind === "adding"}
        aria-label={variant === "compact" ? `Add ${productName} to bag` : undefined}
      >
        {label}
      </button>
      {/* Visible confirmation only; the shell's live region announces it. */}
      {state.kind === "added" && variant === "primary" ? (
        <p className="add-to-bag__done" data-testid="add-confirmation">
          Added to your bag. <Link to="/cart">View bag</Link>
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="add-to-bag__error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
