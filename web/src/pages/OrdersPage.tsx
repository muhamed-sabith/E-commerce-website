import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  ordersApi,
  type OrderDetail,
  type OrderList,
  type OrderStatus,
  type PaymentStatus,
} from "../api/orders";
import { countryName } from "../addresses/validation";
import { formatINR } from "../lib/format";
import "../orders/orders.css";

/**
 * Order history + detail (REQUIREMENTS §2.13). Own orders only (server
 * enforced). Everything shown is the purchase-time snapshot — later catalog
 * or address edits never change it.
 */

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`ord-pill ord-pill--${status}`}>{ORDER_STATUS_LABEL[status]}</span>;
}

function PaymentPill({ status }: { status: PaymentStatus }) {
  return (
    <span className={`ord-pill ord-pill--pay-${status === "PAID" ? "paid" : "pending"}`}>
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}

// ---------- list ----------

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; data: OrderList }>({
    kind: "loading",
  });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", data: await ordersApi.list(page) });
    } catch {
      setState({ kind: "error" });
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="ord">
      <div className="ord__inner">
        <nav className="ord__crumbs" aria-label="Breadcrumb">
          <Link to="/account">Account</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">Orders</span>
        </nav>
        <h1 className="ord__title">Orders</h1>

        {state.kind === "loading" ? (
          <>
            <div className="ord__skeleton" aria-hidden="true">
              <div />
              <div />
            </div>
            <p className="sr-only" role="status">
              Loading your orders
            </p>
          </>
        ) : state.kind === "error" ? (
          <div className="ord__state" role="alert">
            <p>We couldn't load your orders. Check your connection and try again.</p>
            <button type="button" className="ord__button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : state.data.items.length === 0 ? (
          <div className="ord__state" data-testid="orders-empty">
            <p className="ord__state-lede">No orders yet.</p>
            <p>When you place an order it will appear here, with its status and payment.</p>
            <Link to="/products" className="ord__button">
              Explore the collection
            </Link>
          </div>
        ) : (
          <>
            <ul className="ord__list">
              {state.data.items.map((o) => (
                <li key={o.id} className="ord-row" data-testid="order-row">
                  <div className="ord-row__main">
                    <Link to={`/orders/${o.id}`} className="ord-row__number">
                      {o.orderNumber}
                    </Link>
                    <span className="ord-row__meta">
                      <time dateTime={o.placedAt}>{dateFmt.format(new Date(o.placedAt))}</time>
                      {" · "}
                      {o.itemCount} {o.itemCount === 1 ? "piece" : "pieces"}
                    </span>
                  </div>
                  <div className="ord-row__pills">
                    <StatusPill status={o.status} />
                    <PaymentPill status={o.paymentStatus} />
                  </div>
                  <span className="ord-row__total price">{formatINR(o.grandTotal.amount)}</span>
                </li>
              ))}
            </ul>
            {state.data.total_pages > 1 ? (
              <nav className="ord__pages" aria-label="Pagination">
                <button
                  type="button"
                  className="ord__button ord__button--ghost"
                  aria-disabled={page <= 1}
                  onClick={() => page > 1 && setParams(page - 1 > 1 ? { page: String(page - 1) } : {})}
                >
                  Previous
                </button>
                <span>
                  Page {page} of {state.data.total_pages}
                </span>
                <button
                  type="button"
                  className="ord__button ord__button--ghost"
                  aria-disabled={page >= state.data.total_pages}
                  onClick={() => page < state.data.total_pages && setParams({ page: String(page + 1) })}
                >
                  Next
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

// ---------- detail / confirmation ----------

export function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const justPlaced = params.get("placed") === "1";
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; order: OrderDetail }
  >({ kind: "loading" });
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const { order } = await ordersApi.get(orderId);
      setState({ kind: "ready", order });
    } catch (err) {
      setState(err instanceof ApiRequestError && err.status === 404 ? { kind: "missing" } : { kind: "error" });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state.kind === "ready" && justPlaced) headingRef.current?.focus();
  }, [state.kind, justPlaced]);

  if (state.kind === "loading") {
    return (
      <main className="ord">
        <div className="ord__inner">
          <div className="ord__skeleton" aria-hidden="true">
            <div />
          </div>
          <p className="sr-only" role="status">
            Loading order
          </p>
        </div>
      </main>
    );
  }

  if (state.kind === "missing" || state.kind === "error") {
    return (
      <main className="ord">
        <div className="ord__inner">
          <h1 className="ord__title">{state.kind === "missing" ? "Order not found" : "Something went wrong"}</h1>
          <div className="ord__state" role={state.kind === "error" ? "alert" : undefined} data-testid="order-missing">
            <p>
              {state.kind === "missing"
                ? "We couldn't find this order in your account."
                : "We couldn't load this order. Check your connection and try again."}
            </p>
            {state.kind === "error" ? (
              <button type="button" className="ord__button" onClick={() => void load()}>
                Try again
              </button>
            ) : (
              <Link to="/orders" className="ord__button">
                Your orders
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  const o = state.order;
  const s = o.shipping;

  return (
    <main className="ord">
      <div className="ord__inner">
        <nav className="ord__crumbs" aria-label="Breadcrumb">
          <Link to="/account">Account</Link>
          <span aria-hidden="true"> / </span>
          <Link to="/orders">Orders</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">{o.orderNumber}</span>
        </nav>

        {justPlaced ? (
          <p className="ord__placed" data-testid="order-placed">
            Thank you. Your order has been placed.
          </p>
        ) : null}

        <header className="ord__head">
          <div>
            <h1 className="ord__title ord__title--detail" tabIndex={-1} ref={headingRef} data-testid="order-number">
              {o.orderNumber}
            </h1>
            <p className="ord__placed-at">
              Placed <time dateTime={o.placedAt}>{dateTimeFmt.format(new Date(o.placedAt))}</time>
            </p>
          </div>
          <div className="ord__pills">
            <StatusPill status={o.status} />
            <PaymentPill status={o.paymentStatus} />
          </div>
        </header>

        {o.payment.canPay && o.payment.demo_payment_url ? (
          <div className="ord__pay-cta" data-testid="order-pay-cta">
            <p>This order is waiting for payment.</p>
            <Link to={o.payment.demo_payment_url} className="ord__button">
              Pay {formatINR(o.grandTotal.amount)} (Demo)
            </Link>
          </div>
        ) : o.paymentStatus === "PENDING_PAYMENT" && o.status !== "cancelled" ? (
          <p className="ord__note">Payment for this order will be confirmed by our team.</p>
        ) : null}

        <div className="ord__layout">
          <section className="ord__card" aria-labelledby="ord-items">
            <h2 id="ord-items" className="ord__card-title">
              Pieces
            </h2>
            <ul className="ord__items">
              {o.items.map((i) => (
                <li key={i.id} className="ord-item" data-testid="order-item">
                  <div className={`ord-item__media${i.image ? "" : " is-fallback"}`} aria-hidden="true">
                    {i.image ? (
                      <img
                        src={i.image.src}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          e.currentTarget.parentElement?.classList.add("is-fallback");
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="ord-item__body">
                    <p className="ord-item__name">{i.name}</p>
                    <p className="ord-item__meta price">
                      {i.quantity} × {formatINR(i.finalPrice.amount)}
                      {i.discount.amount !== "0.00" ? (
                        <>
                          {" "}
                          <span className="ord-item__was">
                            <span className="sr-only">was </span>
                            <s>{formatINR(i.unitPrice.amount)}</s>
                          </span>
                        </>
                      ) : null}
                    </p>
                    <p className="ord-item__sku">SKU {i.sku}</p>
                  </div>
                  <p className="ord-item__total price">{formatINR(i.lineTotal.amount)}</p>
                </li>
              ))}
            </ul>
          </section>

          <div className="ord__side">
            <section className="ord__card" aria-labelledby="ord-summary">
              <h2 id="ord-summary" className="ord__card-title">
                Summary
              </h2>
              <dl className="ord__totals" data-testid="order-totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd className="price">{formatINR(o.subtotal.amount)}</dd>
                </div>
                {o.discountTotal.amount !== "0.00" ? (
                  <div className="ord__saving">
                    <dt>Savings</dt>
                    <dd className="price">−{formatINR(o.discountTotal.amount)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Shipping</dt>
                  <dd className="price">
                    {o.shippingTotal.amount === "0.00" ? "Free" : formatINR(o.shippingTotal.amount)}
                  </dd>
                </div>
                <div className="ord__grand">
                  <dt>Total</dt>
                  <dd className="price" data-testid="order-total">
                    {formatINR(o.grandTotal.amount)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="ord__card" aria-labelledby="ord-ship">
              <h2 id="ord-ship" className="ord__card-title">
                Delivering to
              </h2>
              <address className="ord__address" data-testid="order-address">
                <strong>{s.receiverName}</strong>
                <br />
                {s.line1}
                {s.line2 ? (
                  <>
                    <br />
                    {s.line2}
                  </>
                ) : null}
                <br />
                {s.city}, {s.state} {s.postalCode}
                <br />
                {countryName(s.countryCode)}
                <br />
                <span className="ord__phone">{s.phone}</span>
              </address>
            </section>
          </div>
        </div>

        <p className="ord__back">
          <Link to="/orders">All orders</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/products">Continue shopping</Link>
        </p>
      </div>
    </main>
  );
}
