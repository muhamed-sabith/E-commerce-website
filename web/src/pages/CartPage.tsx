import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import { MAX_LINE_QTY, type CartLine } from "../api/cart";
import { useCart } from "../cart/CartContext";
import { formatINR } from "../lib/format";
import "./cart.css";

/**
 * The bag (REQUIREMENTS §8, API_CONTRACT §3). Everything shown — prices,
 * discounts, line totals, availability, totals — is the server's latest
 * answer. Quantity changes are sent as intents; the response replaces the
 * view. Checkout is a later phase and deliberately absent.
 */
export function CartPage() {
  const { cart, status, refresh } = useCart();
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (status === "loading" && !cart) {
    return (
      <main className="bag">
        <div className="bag__inner">
          <h1 className="bag__title">Your bag</h1>
          <div className="bag__skeleton" aria-hidden="true">
            <div />
            <div />
          </div>
          <p className="sr-only" role="status">
            Loading your bag
          </p>
        </div>
      </main>
    );
  }

  if (status === "error" && !cart) {
    return (
      <main className="bag">
        <div className="bag__inner">
          <h1 className="bag__title">Your bag</h1>
          <div className="bag__state" role="alert">
            <p>We couldn't load your bag. Check your connection and try again.</p>
            <button type="button" className="bag__button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  const items = cart?.items ?? [];

  return (
    <main className="bag">
      <div className="bag__inner">
        <h1 className="bag__title" tabIndex={-1} ref={headingRef}>
          Your bag
        </h1>

        {items.length === 0 ? (
          <div className="bag__empty" data-testid="empty-bag">
            <p className="bag__empty-lede">Your bag is empty.</p>
            <p className="bag__empty-copy">
              Pieces you add will stay here while you browse.
            </p>
            <Link to="/products" className="bag__button">
              Explore the collection
            </Link>
          </div>
        ) : (
          <div className="bag__layout">
            <section aria-labelledby="bag-items-heading">
              <h2 id="bag-items-heading" className="sr-only">
                Items in your bag
              </h2>
              <ul className="bag__lines">
                {items.map((line) => (
                  <BagLine
                    key={line.id}
                    line={line}
                    onRemoved={() => headingRef.current?.focus()}
                  />
                ))}
              </ul>
              <Link to="/products" className="bag__continue">
                Continue shopping
              </Link>
            </section>

            <Summary />
          </div>
        )}
      </div>
    </main>
  );
}

function Summary() {
  const { cart } = useCart();
  if (!cart) return null;
  const hasDiscount = Number(cart.discountTotal.amount) > 0;
  const blocked = cart.items.some((l) => l.availability !== "available");

  return (
    <aside className="bag__summary" aria-labelledby="bag-summary-heading">
      <h2 id="bag-summary-heading" className="bag__summary-title">
        Summary
      </h2>
      <dl className="bag__totals" data-testid="bag-totals">
        <div className="bag__row">
          <dt>Subtotal</dt>
          <dd className="price" data-testid="bag-subtotal">
            {formatINR(cart.subtotal.amount)}
          </dd>
        </div>
        {hasDiscount ? (
          <div className="bag__row bag__row--saving">
            <dt>Savings</dt>
            <dd className="price" data-testid="bag-discount">
              −{formatINR(cart.discountTotal.amount)}
            </dd>
          </div>
        ) : null}
        <div className="bag__row bag__row--total">
          <dt>Total</dt>
          <dd className="price" data-testid="bag-total">
            {formatINR(cart.total.amount)}
          </dd>
        </div>
      </dl>
      <p className="bag__note">
        {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}. Shipping and taxes are
        confirmed at checkout.
      </p>
      {blocked ? (
        <p className="bag__note bag__note--warn">
          Items marked unavailable aren't included in your total.
        </p>
      ) : null}
    </aside>
  );
}

function BagLine({ line, onRemoved }: { line: CartLine; onRemoved: () => void }) {
  const { updateQuantity, removeItem, pendingLines } = useCart();
  const [error, setError] = useState<string | null>(null);
  const busy = pendingLines.has(line.id);
  const discounted = line.finalPrice.amount !== line.price.amount;
  const unavailable = line.availability === "unavailable";
  const errorId = `line-${line.id}-error`;
  const issueId = `line-${line.id}-issue`;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "That didn't go through. Check your connection and try again.",
      );
    }
  }

  const changeTo = (qty: number) => run(() => updateQuantity(line.id, qty));

  return (
    <li
      className={`bag-line${line.availability !== "available" ? " is-blocked" : ""}`}
      data-testid="bag-line"
      aria-busy={busy}
    >
      <Link to={`/product/${line.product.slug}`} className="bag-line__media" tabIndex={-1}>
        {line.product.image ? (
          <img
            src={line.product.image.src}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.parentElement?.classList.add("is-fallback");
            }}
          />
        ) : (
          <span className="bag-line__fallback" aria-hidden="true">
            HEYRAH
          </span>
        )}
      </Link>

      <div className="bag-line__body">
        <div className="bag-line__head">
          <h3 className="bag-line__name">
            <Link to={`/product/${line.product.slug}`}>{line.product.name}</Link>
          </h3>
          <p className="bag-line__total price" data-testid="line-total">
            {line.availability === "available" ? formatINR(line.lineTotal.amount) : "—"}
          </p>
        </div>

        <p className="bag-line__price price">
          {discounted ? (
            <>
              <span className="sr-only">Was </span>
              <s className="bag-line__was">{formatINR(line.price.amount)}</s>
              <span className="sr-only">, now </span>
              <span className="bag-line__now">{formatINR(line.finalPrice.amount)}</span>
            </>
          ) : (
            <span>{formatINR(line.finalPrice.amount)}</span>
          )}
          <span className="bag-line__each">each</span>
        </p>

        {line.issue ? (
          <p className="bag-line__issue" id={issueId} data-testid="line-issue">
            <span className="bag-line__issue-label">
              {unavailable ? "Unavailable" : "Stock issue"}
            </span>{" "}
            {line.issue}
          </p>
        ) : null}

        <div className="bag-line__actions">
          {unavailable ? null : (
            <QuantityControl
              line={line}
              busy={busy}
              describedBy={[line.issue ? issueId : "", error ? errorId : ""]
                .filter(Boolean)
                .join(" ")}
              onChange={changeTo}
              onInvalid={setError}
            />
          )}
          <button
            type="button"
            className="bag-line__remove"
            onClick={() => {
              if (busy) return;
              void run(async () => {
                await removeItem(line.id);
                // The line (and the focused button) is gone: land focus on
                // the bag heading instead of dropping it to <body>.
                onRemoved();
              });
            }}
            aria-disabled={busy}
            aria-label={`Remove ${line.product.name} from bag`}
          >
            Remove
          </button>
        </div>

        {error ? (
          <p className="bag-line__error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Stepper + typed input. The typed value commits on blur/Enter only (no
 * request per keystroke); invalid input is explained, never silently
 * clamped. The server remains the stock authority.
 */
function QuantityControl({
  line,
  busy,
  describedBy,
  onChange,
  onInvalid,
}: {
  line: CartLine;
  busy: boolean;
  describedBy: string;
  onChange: (qty: number) => Promise<void>;
  onInvalid: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(line.quantity);
  const inputId = `qty-${line.id}`;

  function commit() {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (!/^\d+$/.test(trimmed)) {
      onInvalid("Enter a whole number of pieces.");
      return;
    }
    const qty = Number(trimmed);
    if (qty === line.quantity) return;
    if (qty > MAX_LINE_QTY) {
      onInvalid(`You can add up to ${MAX_LINE_QTY} of one piece.`);
      return;
    }
    // 0 = remove, per the contract.
    void onChange(qty);
  }

  return (
    <div className="qty" role="group" aria-label={`Quantity for ${line.product.name}`}>
      {/* aria-disabled (not disabled) keeps keyboard focus in place while a
          request is in flight or a bound is reached. */}
      <button
        type="button"
        className="qty__step"
        onClick={() => {
          if (!busy && line.quantity > 1) void onChange(line.quantity - 1);
        }}
        aria-disabled={busy || line.quantity <= 1}
        aria-label={`Decrease quantity of ${line.product.name}`}
      >
        <span aria-hidden="true">−</span>
      </button>
      <label htmlFor={inputId} className="sr-only">
        Quantity
      </label>
      <input
        id={inputId}
        className="qty__input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={shown}
        readOnly={busy}
        aria-describedby={describedBy || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <button
        type="button"
        className="qty__step"
        onClick={() => {
          if (!busy && line.quantity < MAX_LINE_QTY) void onChange(line.quantity + 1);
        }}
        aria-disabled={busy || line.quantity >= MAX_LINE_QTY}
        aria-label={`Increase quantity of ${line.product.name}`}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
