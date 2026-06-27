import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useCart } from "./CartContext";
import "./merge-notice.css";

/**
 * Post-sign-in bag notice (API_CONTRACT §3 merge_report). Tells the shopper,
 * in plain words, what happened to the pieces she added as a guest: carried
 * over, reduced to what's in stock, or no longer available. Never mentions
 * sessions, ids, or storage. Stays until dismissed (WCAG 2.2.1).
 */
const DROP_REASON: Record<string, string> = {
  inactive: "no longer available",
  archived: "no longer available",
  removed_from_catalog: "no longer available",
  out_of_stock: "out of stock",
};

export function MergeNotice() {
  const { mergeReport, dismissMergeReport } = useCart();
  const { pathname } = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (mergeReport) headingRef.current?.focus();
  }, [mergeReport]);

  if (!mergeReport) return null;
  const { merged, capped, dropped } = mergeReport;
  const carried = merged.length + capped.length;

  return (
    <div className="merge-notice-wrap">
    <section className="merge-notice" aria-labelledby="merge-notice-title" data-testid="merge-notice">
      <h2 id="merge-notice-title" className="merge-notice__title" tabIndex={-1} ref={headingRef}>
        {carried > 0 ? "We've saved your bag" : "About your bag"}
      </h2>

      {merged.length > 0 ? (
        <div className="merge-notice__group">
          <p>Added to your bag from before you signed in:</p>
          <ul>
            {merged.map((m) => (
              <li key={m.product_id}>
                {m.name} <span className="merge-notice__qty">× {m.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {capped.length > 0 ? (
        <div className="merge-notice__group">
          <p>We adjusted these to what's in stock:</p>
          <ul>
            {capped.map((c) => (
              <li key={c.product_id} data-testid="merge-capped">
                {c.name}: {c.quantity} of the {c.requested} you wanted
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dropped.length > 0 ? (
        <div className="merge-notice__group">
          <p>We couldn't keep these:</p>
          <ul>
            {dropped.map((d) => (
              <li key={d.product_id} data-testid="merge-dropped">
                {d.name}, {DROP_REASON[d.reason] ?? "no longer available"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="merge-notice__actions">
        {pathname !== "/cart" ? (
          <Link to="/cart" className="merge-notice__link" onClick={dismissMergeReport}>
            Review your bag
          </Link>
        ) : null}
        <button type="button" className="merge-notice__dismiss" onClick={dismissMergeReport}>
          Dismiss
        </button>
      </div>
    </section>
    </div>
  );
}
