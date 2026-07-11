import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import { checkoutApi, type CheckoutPreview, type LineProblem } from "../api/orders";
import { countryName } from "../addresses/validation";
import { useCart } from "../cart/CartContext";
import { formatINR } from "../lib/format";
import "../checkout/checkout.css";

/**
 * Checkout (REQUIREMENTS §10, API_CONTRACT §3). Signed-in only (route guard
 * + server). Every figure comes from POST /checkout/preview; placing the
 * order sends only the chosen address id. A stock change between preview
 * and placement comes back as a clean 409 and the page re-reads the truth.
 */

type Load =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; preview: CheckoutPreview };

function problemCopy(p: LineProblem): string {
  if (p.reason === "unavailable") return "No longer available";
  if (p.reason === "out_of_stock") return "Sold out";
  return `Only ${p.available} left, you have ${p.requested}`;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const { refresh: refreshCart } = useCart();
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [addressId, setAddressId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // Guards against a second submit while the first is in flight.
  const inFlight = useRef(false);

  const load = useCallback(async (chosen?: string | null) => {
    try {
      const preview = await checkoutApi.preview(chosen ?? undefined);
      setState({ kind: "ready", preview });
      setAddressId(preview.address?.id ?? null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "cart_empty") {
        setState({ kind: "empty" });
      } else if (err instanceof ApiRequestError && err.code === "unknown_resource" && chosen) {
        // The chosen address vanished (deleted in another tab): fall back.
        await load(null);
      } else {
        setState({
          kind: "error",
          message: "We couldn't load your checkout. Check your connection and try again.",
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function chooseAddress(id: string) {
    setAddressId(id);
    setPlaceError(null);
    await load(id);
    setStatus("Delivery address updated.");
  }

  async function placeOrder() {
    if (inFlight.current || state.kind !== "ready" || !addressId) return;
    inFlight.current = true;
    setPlacing(true);
    setPlaceError(null);
    try {
      const result = await checkoutApi.placeOrder(addressId);
      // The purchased lines are gone server-side; sync the header count.
      void refreshCart();
      if (result.payment.mode === "demo" && result.payment.demo_payment_url) {
        navigate(result.payment.demo_payment_url, { replace: true });
      } else {
        navigate(`/orders/${result.order.id}?placed=1`, { replace: true });
      }
    } catch (err) {
      let message = "We couldn't place your order. Nothing was charged. Please try again.";
      if (err instanceof ApiRequestError) {
        if (err.code === "stock_shortage" || err.code === "cart_stale") message = err.message;
        else if (err.code === "cart_empty") message = "Your bag is empty. It may have been checked out in another tab.";
        else if (err.code === "unknown_resource") message = "That address is no longer in your address book. Choose another.";
      }
      setPlaceError(message);
      // Re-read the server truth so flagged lines and totals are current.
      await load(addressId);
      void refreshCart();
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      inFlight.current = false;
      setPlacing(false);
    }
  }

  const heading = (
    <h1 className="co__title" tabIndex={-1} ref={headingRef}>
      Checkout
    </h1>
  );

  if (state.kind === "loading") {
    return (
      <main className="co">
        <div className="co__inner">
          {heading}
          <div className="co__skeleton" aria-hidden="true">
            <div />
            <div />
          </div>
          <p className="sr-only" role="status">
            Loading checkout
          </p>
        </div>
      </main>
    );
  }

  if (state.kind === "empty") {
    return (
      <main className="co">
        <div className="co__inner">
          {heading}
          <div className="co__state" data-testid="checkout-empty">
            <p className="co__state-lede">Your bag is empty.</p>
            <p>Add a piece or two, then come back to check out.</p>
            <Link to="/products" className="co__button">
              Explore the collection
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="co">
        <div className="co__inner">
          {heading}
          <div className="co__state" role="alert">
            <p>{state.message}</p>
            <button type="button" className="co__button" onClick={() => void load(addressId)}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  const p = state.preview;
  const hasDiscount = Number(p.discountTotal.amount) > 0;
  const freeShipping = Number(p.shippingTotal.amount) === 0;
  const blockedReason =
    p.problems.length > 0
      ? "Some items in your bag need attention before you can place the order."
      : !addressId
        ? "Add a delivery address to place your order."
        : null;

  return (
    <main className="co">
      <div className="co__inner">
        <nav className="co__crumbs" aria-label="Breadcrumb">
          <Link to="/cart">Bag</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">Checkout</span>
        </nav>
        {heading}
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>

        {placeError ? (
          <div className="co__alert" role="alert" tabIndex={-1} ref={errorRef} data-testid="checkout-error">
            {placeError}
          </div>
        ) : null}

        <div className="co__layout">
          <div className="co__main">
            {/* ---------- delivery ---------- */}
            <section className="co__section" aria-labelledby="co-delivery">
              <div className="co__section-head">
                <h2 id="co-delivery" className="co__section-title">
                  Delivery address
                </h2>
                <Link to="/account/addresses" className="co__manage">
                  Manage addresses
                </Link>
              </div>

              {p.addresses.length === 0 ? (
                <div className="co__no-address" data-testid="no-address">
                  <p>You don't have a saved address yet.</p>
                  <Link to="/account/addresses" className="co__button co__button--ghost">
                    Add an address
                  </Link>
                </div>
              ) : (
                <fieldset className="co__addresses">
                  <legend className="sr-only">Choose where to deliver</legend>
                  {p.addresses.map((a) => {
                    const checked = a.id === addressId;
                    return (
                      <label
                        key={a.id}
                        className={`co__address${checked ? " is-selected" : ""}`}
                        data-testid="checkout-address"
                      >
                        <input
                          type="radio"
                          name="delivery-address"
                          value={a.id}
                          checked={checked}
                          disabled={placing}
                          onChange={() => void chooseAddress(a.id)}
                        />
                        <span className="co__address-body">
                          <span className="co__address-name">
                            {a.receiverName}
                            {a.isDefault ? <span className="co__badge">Default</span> : null}
                          </span>
                          <span className="co__address-lines">
                            {a.line1}
                            {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.postalCode},{" "}
                            {countryName(a.countryCode)}
                          </span>
                          <span className="co__address-phone">{a.phone}</span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </section>

            {/* ---------- items ---------- */}
            <section className="co__section" aria-labelledby="co-items">
              <div className="co__section-head">
                <h2 id="co-items" className="co__section-title">
                  Your pieces
                </h2>
                <Link to="/cart" className="co__manage">
                  Edit bag
                </Link>
              </div>
              <ul className="co__lines">
                {p.lines.map((l) => {
                  const discounted = l.discount.amount !== "0.00";
                  return (
                    <li
                      key={l.id}
                      className={`co__line${l.problem ? " has-problem" : ""}`}
                      data-testid="checkout-line"
                    >
                      <div className={`co__line-media${l.product.image ? "" : " is-fallback"}`} aria-hidden="true">
                        {l.product.image ? (
                          <img
                            src={l.product.image.src}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              e.currentTarget.parentElement?.classList.add("is-fallback");
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="co__line-body">
                        <p className="co__line-name">{l.product.name}</p>
                        <p className="co__line-meta price">
                          Qty {l.quantity} ·{" "}
                          {discounted ? (
                            <>
                              <span className="sr-only">was </span>
                              <s>{formatINR(l.unitPrice.amount)}</s>{" "}
                              <span className="sr-only">now </span>
                              <span className="co__sale">{formatINR(l.finalPrice.amount)}</span>
                            </>
                          ) : (
                            formatINR(l.finalPrice.amount)
                          )}{" "}
                          each
                        </p>
                        {l.problem ? (
                          <p className="co__line-problem" data-testid="line-problem">
                            <span className="co__line-problem-label">Needs attention:</span>{" "}
                            {problemCopy(l.problem)}
                          </p>
                        ) : null}
                      </div>
                      <p className="co__line-total price">
                        {l.problem ? "—" : formatINR(l.lineTotal.amount)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          {/* ---------- summary ---------- */}
          <aside className="co__summary" aria-labelledby="co-summary">
            <h2 id="co-summary" className="co__summary-title">
              Order summary
            </h2>
            <dl className="co__totals" data-testid="checkout-totals">
              <div className="co__row">
                <dt>Subtotal</dt>
                <dd className="price" data-testid="co-subtotal">
                  {formatINR(p.subtotal.amount)}
                </dd>
              </div>
              {hasDiscount ? (
                <div className="co__row co__row--saving">
                  <dt>Savings</dt>
                  <dd className="price" data-testid="co-discount">
                    −{formatINR(p.discountTotal.amount)}
                  </dd>
                </div>
              ) : null}
              <div className="co__row">
                <dt>Shipping</dt>
                <dd className="price" data-testid="co-shipping">
                  {freeShipping ? "Free" : formatINR(p.shippingTotal.amount)}
                </dd>
              </div>
              <div className="co__row co__row--total">
                <dt>Total</dt>
                <dd className="price" data-testid="co-total">
                  {formatINR(p.grandTotal.amount)}
                </dd>
              </div>
            </dl>
            {!freeShipping ? (
              <p className="co__note">
                Free shipping on orders of {formatINR(p.shipping.freeThreshold.amount)} or more.
              </p>
            ) : null}

            <button
              type="button"
              className="co__button co__place"
              onClick={() => void placeOrder()}
              aria-disabled={placing || !p.canPlaceOrder || !addressId}
              aria-describedby={blockedReason ? "co-blocked" : undefined}
              data-testid="place-order"
            >
              {placing ? (
                <>
                  <span className="co__spinner" aria-hidden="true" />
                  Placing your order…
                </>
              ) : (
                `Place order · ${formatINR(p.grandTotal.amount)}`
              )}
            </button>
            {blockedReason ? (
              <p className="co__note co__note--warn" id="co-blocked">
                {blockedReason}
              </p>
            ) : (
              <p className="co__note">You'll pay on the next step. Your order is held for you.</p>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
