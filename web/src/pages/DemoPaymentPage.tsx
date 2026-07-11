import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import { ordersApi, type DemoMethod, type OrderDetail } from "../api/orders";
import { formatINR } from "../lib/format";
import "../payment/demo-payment.css";

/**
 * Demo payment (REQUIREMENTS §10, ARCHITECTURE §5.5). A simulation of a
 * hosted payment sheet — opening → method choice → processing → result —
 * modelled on how modern gateway checkouts feel (sheet rises over a dimmed
 * page, short status steps, a drawn confirmation mark). No provider is
 * contacted, nothing is charged, no payment credentials are ever asked for.
 * "DEMO / TEST MODE" is visible on the page and inside the sheet at all times.
 */

type Phase =
  | "closed"
  | "opening" // Securing your payment… → Connecting securely…
  | "select" // demo method choice
  | "processing" // Securing your payment… → Processing…
  | "confirmed" // Payment confirmed (brief) → page success
  | "failed";

type Load =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; order: OrderDetail };

const METHODS: { id: DemoMethod; label: string; hint: string }[] = [
  { id: "demo_card", label: "Demo Card", hint: "Simulates a card payment. No card details are asked for." },
  { id: "demo_upi", label: "Demo UPI", hint: "Simulates a UPI payment. No UPI ID or PIN is asked for." },
  { id: "demo_qr", label: "Demo QR", hint: "Simulates paying by scanning a QR code." },
];

function prefersReducedMotion(): boolean {
  // jsdom and old browsers lack matchMedia — treat as reduced (fast, still sequenced).
  return typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Step length: long enough to read, short enough not to stall. */
function stepMs(): number {
  return prefersReducedMotion() ? 180 : 650;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function DemoPaymentPage() {
  const { orderId = "" } = useParams();
  const uid = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [phase, setPhase] = useState<Phase>("closed");
  const [step, setStep] = useState("");
  const [method, setMethod] = useState<DemoMethod>("demo_card");
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const payButtonRef = useRef<HTMLButtonElement>(null);
  const sheetPayRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchOrder = useCallback(async () => {
    try {
      const { order } = await ordersApi.get(orderId);
      setLoad({ kind: "ready", order });
    } catch (err) {
      setLoad(err instanceof ApiRequestError && err.status === 404 ? { kind: "missing" } : { kind: "error" });
    }
  }, [orderId]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  // Keep the native <dialog> in sync with the phase.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const shouldOpen = phase !== "closed" && phase !== "confirmed";
    if (shouldOpen && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!shouldOpen && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [phase]);

  useEffect(() => {
    if (phase === "select") sheetPayRef.current?.focus();
    if (phase === "confirmed") successRef.current?.focus();
  }, [phase]);

  async function open() {
    if (phase !== "closed") return;
    setFailMessage(null);
    setPhase("opening");
    setStep("Securing your payment…");
    await wait(stepMs());
    if (!alive.current) return;
    setStep("Connecting securely…");
    await wait(stepMs());
    if (!alive.current) return;
    setStep("");
    setPhase("select");
  }

  function close() {
    setPhase("closed");
    setStep("");
    requestAnimationFrame(() => payButtonRef.current?.focus());
  }

  async function attempt(outcome: "success" | "failure") {
    if (phase !== "select" || load.kind !== "ready") return;
    setPhase("processing");
    setStep("Securing your payment…");
    const call =
      outcome === "success"
        ? ordersApi.confirmDemoPayment(orderId, method)
        : ordersApi.failDemoPayment(orderId, method);
    try {
      await wait(stepMs());
      if (!alive.current) return;
      setStep("Processing…");
      const [{ order }] = await Promise.all([call, wait(stepMs() * 1.3)]);
      if (!alive.current) return;
      setLoad({ kind: "ready", order });
      if (outcome === "success" && order.paymentStatus === "PAID") {
        setStep("Payment confirmed");
        await wait(stepMs());
        if (!alive.current) return;
        setPhase("confirmed");
      } else {
        setFailMessage("The demo payment didn't go through. Your order is saved and nothing was charged.");
        setStep("");
        setPhase("failed");
      }
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiRequestError && err.code === "already_paid") {
        await fetchOrder();
        setPhase("confirmed");
        return;
      }
      setFailMessage(
        err instanceof ApiRequestError && err.code === "not_payable"
          ? err.message
          : "We couldn't reach the demo payment service. Your order is saved. Try again.",
      );
      setStep("");
      setPhase("failed");
    }
  }

  // ---------- page states ----------

  if (load.kind === "loading") {
    return (
      <main className="pay">
        <DemoBanner />
        <div className="pay__inner">
          <div className="pay__skeleton" aria-hidden="true" />
          <p className="sr-only" role="status">
            Loading your order
          </p>
        </div>
      </main>
    );
  }

  if (load.kind === "missing" || load.kind === "error") {
    return (
      <main className="pay">
        <DemoBanner />
        <div className="pay__inner">
          <div className="pay__state" role={load.kind === "error" ? "alert" : undefined}>
            <h1 className="pay__state-title">{load.kind === "missing" ? "Order not found" : "Something went wrong"}</h1>
            <p>
              {load.kind === "missing"
                ? "We couldn't find this order in your account."
                : "We couldn't load this order. Check your connection and try again."}
            </p>
            {load.kind === "error" ? (
              <button type="button" className="pay__button" onClick={() => void fetchOrder()}>
                Try again
              </button>
            ) : (
              <Link to="/orders" className="pay__button">
                Your orders
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  const order = load.order;
  const amount = formatINR(order.grandTotal.amount);
  const paid = order.paymentStatus === "PAID";

  if (paid && phase !== "processing") {
    return (
      <main className="pay">
        <DemoBanner />
        <div className="pay__inner">
          <section className="pay__result" aria-labelledby="pay-success" data-testid="payment-success">
            <ResultMark kind="success" />
            <h1 id="pay-success" className="pay__result-title" tabIndex={-1} ref={successRef}>
              Payment successful
            </h1>
            <p className="pay__result-lede">Thank you. Your demo payment has been recorded against this order.</p>
            <dl className="pay__facts">
              <div>
                <dt>Order number</dt>
                <dd data-testid="paid-order-number">{order.orderNumber}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd data-testid="paid-status">Paid (demo)</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd className="price">{amount}</dd>
              </div>
            </dl>
            <div className="pay__actions">
              <Link to={`/orders/${order.id}`} className="pay__button">
                View order
              </Link>
              <Link to="/products" className="pay__button pay__button--ghost">
                Continue shopping
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  // A just-paid order (canPay now false) stays on the sheet until the
  // confirmation step finishes; only a never-payable order lands here.
  if (!order.payment.canPay && !paid) {
    // Manual mode (route inert) or a cancelled order: no customer payment path.
    return (
      <main className="pay">
        <DemoBanner />
        <div className="pay__inner">
          <div className="pay__state" data-testid="payment-unavailable">
            <h1 className="pay__state-title">Online payment isn't available</h1>
            <p>
              {order.status === "cancelled"
                ? "This order was cancelled, so it can't be paid."
                : "Payment for this order will be confirmed by our team."}
            </p>
            <Link to={`/orders/${order.id}`} className="pay__button">
              View order
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const busy = phase === "opening" || phase === "processing";

  return (
    <main className="pay">
      <DemoBanner />
      <div className="pay__inner">
        <p className="pay__eyebrow">Order {order.orderNumber}</p>
        <h1 className="pay__title">Complete your payment</h1>

        <section className="pay__card" aria-labelledby="pay-summary">
          <h2 id="pay-summary" className="pay__card-title">
            Payment summary
          </h2>
          <ul className="pay__items">
            {order.items.map((i) => (
              <li key={i.id}>
                <span className="pay__item-name">{i.name}</span>
                <span className="pay__item-qty">× {i.quantity}</span>
                <span className="pay__item-total price">{formatINR(i.lineTotal.amount)}</span>
              </li>
            ))}
          </ul>
          <dl className="pay__sums">
            <div>
              <dt>Subtotal</dt>
              <dd className="price">{formatINR(order.subtotal.amount)}</dd>
            </div>
            {order.discountTotal.amount !== "0.00" ? (
              <div className="pay__sums-saving">
                <dt>Savings</dt>
                <dd className="price">−{formatINR(order.discountTotal.amount)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Shipping</dt>
              <dd className="price">
                {order.shippingTotal.amount === "0.00" ? "Free" : formatINR(order.shippingTotal.amount)}
              </dd>
            </div>
            <div className="pay__sums-total">
              <dt>Total</dt>
              <dd className="price" data-testid="pay-total">
                {amount}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            ref={payButtonRef}
            className={`pay__button pay__open${busy ? " is-pressed" : ""}`}
            onClick={() => void open()}
            aria-disabled={phase !== "closed"}
            aria-haspopup="dialog"
            data-testid="open-demo-payment"
          >
            {phase === "opening" ? (
              <>
                <span className="pay__spinner" aria-hidden="true" />
                Opening…
              </>
            ) : (
              `Pay ${amount} (Demo)`
            )}
          </button>
          <p className="pay__fine">Simulated payment. No real money is charged and no card or bank details are needed.</p>
        </section>
      </div>

      {/* ---------- the sheet ---------- */}
      <dialog
        ref={dialogRef}
        className={`pay-sheet pay-sheet--${phase}`}
        aria-labelledby={`${uid}-sheet-title`}
        onCancel={(e) => {
          e.preventDefault(); // Escape closes only when nothing is in flight
          if (!busy) close();
        }}
        data-testid="demo-sheet"
      >
        <header className="pay-sheet__head">
          <div className="pay-sheet__brand">
            <span className="pay-sheet__wordmark">HEYRAH</span>
            <span className="pay-sheet__test" data-testid="sheet-demo-badge">
              DEMO / TEST MODE
            </span>
          </div>
          <h2 id={`${uid}-sheet-title`} className="pay-sheet__amount price">
            {amount}
          </h2>
          <p className="pay-sheet__order">Order {order.orderNumber}</p>
          {!busy ? (
            <button type="button" className="pay-sheet__close" onClick={close} aria-label="Close demo payment">
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </header>

        <div className="pay-sheet__body">
          {/* Present from open so every step is announced. */}
          <p className="sr-only" role="status" aria-live="polite" data-testid="sheet-status">
            {step}
          </p>

          {busy || phase === "confirmed" ? (
            <div className="pay-sheet__progress" aria-hidden="true">
              <ProgressMark done={step === "Payment confirmed"} />
              <p className="pay-sheet__step" key={step}>
                {step}
              </p>
            </div>
          ) : null}

          {phase === "select" ? (
            <div className="pay-sheet__select">
              <fieldset className="pay-sheet__methods">
                <legend>Choose a demo method</legend>
                {METHODS.map((m) => (
                  <label key={m.id} className={`pay-sheet__method${method === m.id ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name={`${uid}-method`}
                      value={m.id}
                      checked={method === m.id}
                      onChange={() => setMethod(m.id)}
                    />
                    <span className="pay-sheet__method-body">
                      <span className="pay-sheet__method-label">{m.label}</span>
                      <span className="pay-sheet__method-hint">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                ref={sheetPayRef}
                className="pay__button pay-sheet__pay"
                onClick={() => void attempt("success")}
                data-testid="demo-pay"
              >
                Pay {amount} (Demo)
              </button>
              <button
                type="button"
                className="pay-sheet__fail"
                onClick={() => void attempt("failure")}
                data-testid="demo-fail"
              >
                Simulate payment failure
              </button>
            </div>
          ) : null}

          {phase === "failed" ? (
            <div className="pay-sheet__failed" role="alert" data-testid="payment-failed">
              <ResultMark kind="failure" />
              <h3 className="pay-sheet__failed-title">Payment unsuccessful</h3>
              <p>{failMessage}</p>
              <div className="pay-sheet__failed-actions">
                <button
                  type="button"
                  className="pay__button"
                  onClick={() => {
                    setFailMessage(null);
                    setPhase("select");
                  }}
                  data-testid="demo-retry"
                  autoFocus
                >
                  Try again
                </button>
                <button type="button" className="pay__button pay__button--ghost" onClick={close}>
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="pay-sheet__foot">Simulated for demonstration. No real payment is processed.</footer>
      </dialog>
    </main>
  );
}

function DemoBanner() {
  return (
    <div className="pay-banner" role="note" data-testid="demo-banner">
      <span className="pay-banner__tag">DEMO / TEST MODE</span>
      <span>This is a payment simulator. No real money is charged.</span>
    </div>
  );
}

/** Indeterminate ring while working; ring closes into a check when confirmed. */
function ProgressMark({ done }: { done: boolean }) {
  return (
    <svg className={`pay-mark${done ? " is-done" : ""}`} viewBox="0 0 52 52" aria-hidden="true" focusable="false">
      <circle className="pay-mark__track" cx="26" cy="26" r="23" />
      <circle className="pay-mark__arc" cx="26" cy="26" r="23" />
      {done ? <path className="pay-mark__check" d="M16 27l7 7 13-15" /> : null}
    </svg>
  );
}

function ResultMark({ kind }: { kind: "success" | "failure" }) {
  return (
    <svg className={`pay-result-mark pay-result-mark--${kind}`} viewBox="0 0 52 52" aria-hidden="true" focusable="false">
      <circle className="pay-result-mark__ring" cx="26" cy="26" r="23" />
      {kind === "success" ? (
        <path className="pay-result-mark__glyph" d="M16 27l7 7 13-15" />
      ) : (
        <path className="pay-result-mark__glyph" d="M18 18l16 16M34 18L18 34" />
      )}
    </svg>
  );
}
