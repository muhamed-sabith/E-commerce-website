import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { adminApi, type AdminOrderDetail } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, type OrderStatus } from "../api/orders";
import { countryName } from "../addresses/validation";
import { formatINR } from "../lib/format";
import {
  ConfirmDialog,
  dateTimeFmt,
  Empty,
  Loading,
  LoadError,
  OrderStatusBadge,
  PageHeader,
  Pagination,
  PaymentBadge,
  useLoad,
  usePageParam,
} from "./ui";

/**
 * Orders (REQUIREMENTS §3.9): list with search (order number, customer
 * name or email), status + payment filters, newest first; detail with the
 * immutable purchase snapshot, the full audit trail, and the only two
 * actions an admin has — the next ladder step and manual payment.
 */

const STATUSES: OrderStatus[] = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

export function AdminOrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = usePageParam();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const payment = params.get("payment") ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const { state, reload } = useLoad(() => adminApi.listOrders({ q, status, payment, page }), [q, status, payment, page]);

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    setParams(next);
  };
  const filtered = Boolean(q || status || payment);

  return (
    <div className="adm-page">
      <PageHeader title="Orders" />
      <div className="adm-toolbar">
        <form
          role="search"
          className="adm-search"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            update((p) => (draft.trim() ? p.set("q", draft.trim()) : p.delete("q")));
          }}
        >
          <label htmlFor="ord-q" className="sr-only">
            Search orders
          </label>
          <input id="ord-q" type="search" placeholder="Order number, name, or email" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="adm-btn adm-btn--secondary">
            Search
          </button>
        </form>
        <label className="adm-select">
          <span>Status</span>
          <select value={status} onChange={(e) => update((p) => (e.target.value ? p.set("status", e.target.value) : p.delete("status")))}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-select">
          <span>Payment</span>
          <select value={payment} onChange={(e) => update((p) => (e.target.value ? p.set("payment", e.target.value) : p.delete("payment")))}>
            <option value="">All</option>
            <option value="PENDING_PAYMENT">{PAYMENT_STATUS_LABEL.PENDING_PAYMENT}</option>
            <option value="PAID">{PAYMENT_STATUS_LABEL.PAID}</option>
          </select>
        </label>
      </div>

      {state.kind === "loading" ? <Loading label="Loading orders…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" && state.data.items.length === 0 ? (
        <Empty title={filtered ? "No orders match" : "No orders yet"}>
          {filtered ? (
            <button type="button" className="adm-btn adm-btn--secondary" onClick={() => setParams(new URLSearchParams())}>
              Clear filters
            </button>
          ) : (
            "Orders appear here as soon as customers check out."
          )}
        </Empty>
      ) : null}
      {state.kind === "ready" && state.data.items.length > 0 ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--stack">
              <caption className="sr-only">Orders, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Placed</th>
                  <th scope="col" className="adm-num">
                    Total
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Payment</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((o) => (
                  <tr key={o.id}>
                    <th scope="row" data-label="Order">
                      <Link to={`/admin/orders/${o.id}`} className="adm-rowlink adm-mono-num">
                        {o.orderNumber}
                      </Link>
                      <span className="adm-sub">
                        {o.itemCount} {o.itemCount === 1 ? "item" : "items"}
                      </span>
                    </th>
                    <td data-label="Customer">
                      {o.customer.name}
                      <span className="adm-sub">{o.customer.email}</span>
                    </td>
                    <td data-label="Placed">{dateTimeFmt.format(new Date(o.placedAt))}</td>
                    <td data-label="Total" className="adm-num">
                      {formatINR(o.grandTotal.amount)}
                    </td>
                    <td data-label="Status">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td data-label="Payment">
                      <PaymentBadge status={o.paymentStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={state.data.page} totalPages={state.data.total_pages} totalItems={state.data.total_items} noun="order" />
        </>
      ) : null}
    </div>
  );
}

// ---------- detail ----------

const NEXT_LABEL: Record<OrderStatus, string> = {
  pending: "",
  confirmed: "Confirm order",
  shipped: "Mark as shipped",
  delivered: "Mark as delivered",
  cancelled: "Cancel order",
};

export function AdminOrderDetailPage() {
  const { id = "" } = useParams();
  const { state, reload, set } = useLoad(async () => (await adminApi.getOrder(id)).order, [id]);
  const [flash, setFlash] = useState("");
  const [dialog, setDialog] = useState<"cancel" | "pay" | null>(null);

  if (state.kind === "loading") return <div className="adm-page"><Loading label="Loading order…" /></div>;
  if (state.kind === "error") {
    return (
      <div className="adm-page">
        <PageHeader title={state.status === 404 ? "Order not found" : "Order"} back={{ to: "/admin/orders", label: "Orders" }} />
        {state.status === 404 ? <p>Check the order number and try again.</p> : <LoadError message={state.message} onRetry={() => void reload()} />}
      </div>
    );
  }
  const o = state.data;

  return (
    <div className="adm-page">
      <PageHeader
        title={`Order ${o.orderNumber}`}
        back={{ to: "/admin/orders", label: "Orders" }}
        lede={
          <span className="adm-head__meta">
            <span>Placed {dateTimeFmt.format(new Date(o.placedAt))}</span>
            <OrderStatusBadge status={o.status} />
            <PaymentBadge status={o.paymentStatus} />
          </span>
        }
      />
      <p className="adm-flash" role="status" aria-live="polite">
        {flash}
      </p>

      <div className="adm-split adm-split--wide">
        <div className="adm-stack">
          <section className="adm-panel" aria-labelledby="items-h">
            <div className="adm-panel__head">
              <h2 id="items-h">Items</h2>
              <span className="adm-sub">Prices as charged at checkout</span>
            </div>
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack adm-table--flush">
                <caption className="sr-only">Ordered items</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="adm-num">
                      Unit price
                    </th>
                    <th scope="col" className="adm-num">
                      Qty
                    </th>
                    <th scope="col" className="adm-num">
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.id}>
                      <th scope="row" data-label="Item">
                        <span className="adm-rowtitle">{i.name}</span>
                        <span className="adm-sub">{i.sku}</span>
                      </th>
                      <td data-label="Unit price" className="adm-num">
                        {formatINR(i.finalPrice.amount)}
                        {i.discount.amount !== "0.00" ? <span className="adm-sub adm-strike">{formatINR(i.unitPrice.amount)}</span> : null}
                      </td>
                      <td data-label="Qty" className="adm-num">
                        {i.quantity}
                      </td>
                      <td data-label="Line total" className="adm-num">
                        {formatINR(i.lineTotal.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="adm-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatINR(o.subtotal.amount)}</dd>
              </div>
              {o.discountTotal.amount !== "0.00" ? (
                <div>
                  <dt>Discounts</dt>
                  <dd>−{formatINR(o.discountTotal.amount)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Shipping</dt>
                <dd>{o.shippingTotal.amount === "0.00" ? "Free" : formatINR(o.shippingTotal.amount)}</dd>
              </div>
              <div className="adm-totals__grand">
                <dt>Total</dt>
                <dd>{formatINR(o.grandTotal.amount)}</dd>
              </div>
            </dl>
          </section>

          <section className="adm-panel" aria-labelledby="hist-h">
            <h2 id="hist-h">History</h2>
            <ol className="adm-timeline">
              {[...o.timeline].reverse().map((t) => (
                <li key={t.id}>
                  <span className="adm-timeline__what">{describe(t)}</span>
                  <span className="adm-sub">
                    {dateTimeFmt.format(new Date(t.at))}, {who(t)}
                  </span>
                  {t.note ? <span className="adm-timeline__note">{t.note}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="adm-stack">
          <OrderActions
            order={o}
            onOpenCancel={() => setDialog("cancel")}
            onOpenPay={() => setDialog("pay")}
            onChanged={(next, message) => {
              set(next);
              setFlash(message);
            }}
          />

          <section className="adm-panel" aria-labelledby="cust-h">
            <h2 id="cust-h">Customer</h2>
            <p className="adm-rowtitle">{o.customer.name}</p>
            <p>
              <a href={`mailto:${o.customer.email}`}>{o.customer.email}</a>
            </p>
            {o.customer.isBlocked ? <span className="adm-badge adm-badge--blocked">Blocked</span> : null}
            <p>
              <Link to={`/admin/users?q=${encodeURIComponent(o.customer.email)}`}>Customer record</Link>
            </p>
          </section>

          <section className="adm-panel" aria-labelledby="ship-h">
            <h2 id="ship-h">Ships to</h2>
            <address className="adm-address">
              {o.shipping.receiverName}
              <br />
              {o.shipping.line1}
              {o.shipping.line2 ? (
                <>
                  <br />
                  {o.shipping.line2}
                </>
              ) : null}
              <br />
              {o.shipping.city}, {o.shipping.state} {o.shipping.postalCode}
              <br />
              {countryName(o.shipping.countryCode)}
              <br />
              {o.shipping.phone}
            </address>
            <p className="adm-sub">As entered at checkout. Later address-book edits don't change it.</p>
          </section>
        </div>
      </div>

      {dialog === "cancel" ? (
        <NoteDialog
          title={`Cancel order ${o.orderNumber}?`}
          confirmLabel="Cancel order"
          busyLabel="Cancelling…"
          cancelLabel="Keep order"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async (note) => {
            const { order } = await adminApi.setOrderStatus(o.id, "cancelled", note);
            set(order);
            setFlash(`Order cancelled. ${o.itemCount} ${o.itemCount === 1 ? "unit" : "units"} returned to stock.`);
            setDialog(null);
          }}
        >
          <p>
            All {o.itemCount} {o.itemCount === 1 ? "unit goes" : "units go"} back into stock and the order can't be reopened.
          </p>
          {o.paymentStatus === "PAID" ? <p className="adm-field__error">This order is paid. Arrange the refund outside HEYRAH; it isn't automatic.</p> : null}
        </NoteDialog>
      ) : null}

      {dialog === "pay" ? (
        <NoteDialog
          title={`Mark ${o.orderNumber} as paid?`}
          confirmLabel={`Confirm ${formatINR(o.grandTotal.amount)} received`}
          busyLabel="Confirming…"
          cancelLabel="Not yet"
          tone="primary"
          noteLabel="Payment reference"
          onClose={() => setDialog(null)}
          onConfirm={async (note) => {
            const { order } = await adminApi.confirmPayment(o.id, note);
            set(order);
            setFlash("Payment confirmed.");
            setDialog(null);
          }}
        >
          <p>Only confirm once the money has arrived. This can't be reversed from the admin.</p>
        </NoteDialog>
      ) : null}
    </div>
  );
}

function OrderActions({
  order: o,
  onOpenCancel,
  onOpenPay,
  onChanged,
}: {
  order: AdminOrderDetail;
  onOpenCancel: () => void;
  onOpenPay: () => void;
  onChanged: (o: AdminOrderDetail, message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forward = o.actions.nextStatuses.filter((s) => s !== "cancelled");
  const canCancel = o.actions.nextStatuses.includes("cancelled");

  async function advance(to: OrderStatus) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { order } = await adminApi.setOrderStatus(o.id, to);
      onChanged(order, `Order marked ${ORDER_STATUS_LABEL[to].toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't update the order.");
    } finally {
      setBusy(false);
    }
  }

  const nothing = forward.length === 0 && !canCancel && !o.actions.canConfirmPayment;

  return (
    <section className="adm-panel adm-panel--accent" aria-labelledby="act-h">
      <h2 id="act-h">Next step</h2>
      {nothing ? (
        <p className="adm-panel__note">
          {o.status === "cancelled" ? "This order was cancelled. Its stock has been returned." : "This order is complete. There's nothing left to do."}
        </p>
      ) : null}
      <div className="adm-actions-col">
        {forward.map((s) => (
          <button key={s} type="button" className="adm-btn adm-btn--primary" onClick={() => void advance(s)} aria-disabled={busy}>
            {busy ? "Updating…" : NEXT_LABEL[s]}
          </button>
        ))}
        {o.actions.canConfirmPayment ? (
          <button type="button" className="adm-btn adm-btn--gold" onClick={onOpenPay}>
            Confirm payment received
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" className="adm-btn adm-btn--danger-outline" onClick={onOpenCancel}>
            Cancel order
          </button>
        ) : null}
      </div>
      {o.actions.canConfirmPayment && o.paymentMode === "demo" ? (
        <p className="adm-field__hint">The store runs in demo payment mode: customers can also complete a test payment themselves.</p>
      ) : null}
      {error ? (
        <p className="adm-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Confirmation dialog with an optional note (stored in the order history). */
function NoteDialog({
  noteLabel = "Note for the order history",
  onConfirm,
  ...rest
}: {
  title: string;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  tone: "danger" | "primary";
  noteLabel?: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: (note?: string) => Promise<void>;
}) {
  const uid = useId();
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog
      {...rest}
      onConfirm={async () => {
        try {
          await onConfirm(note.trim() || undefined);
        } catch (err) {
          throw new Error(err instanceof ApiRequestError ? err.message : "Couldn't complete that. Try again.");
        }
      }}
    >
      {rest.children}
      <div className="adm-field">
        <label htmlFor={`${uid}-note`}>
          {noteLabel} <span className="adm-optional">optional</span>
        </label>
        <input id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </div>
    </ConfirmDialog>
  );
}

function describe(t: AdminOrderDetail["timeline"][number]): string {
  if (t.kind === "payment") {
    if (t.to === "PAID") return "Payment confirmed";
    return "Payment attempt failed";
  }
  if (t.from === null) return "Order placed";
  return `${ORDER_STATUS_LABEL[t.from as OrderStatus] ?? t.from} → ${ORDER_STATUS_LABEL[t.to as OrderStatus] ?? t.to}`;
}

function who(t: AdminOrderDetail["timeline"][number]): string {
  if (t.actorType === "ADMIN") return t.actorName ? `by ${t.actorName} (admin)` : "by an admin";
  if (t.actorType === "USER") return "by the customer";
  return "by the system";
}
