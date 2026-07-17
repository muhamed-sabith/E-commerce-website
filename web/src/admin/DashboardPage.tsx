import { Link } from "react-router-dom";
import { adminApi, type Dashboard } from "../api/admin";
import { ORDER_STATUS_LABEL, type OrderStatus } from "../api/orders";
import { formatINR } from "../lib/format";
import { dateTimeFmt, Empty, Loading, LoadError, OrderStatusBadge, PageHeader, PaymentBadge, useLoad } from "./ui";

/**
 * Dashboard (REQUIREMENTS §3.2): real numbers only. Every figure comes from
 * GET /admin/dashboard (aggregated in SQL); zero is shown as zero.
 */

const STATUSES: OrderStatus[] = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

export function AdminDashboardPage() {
  const { state, reload } = useLoad(() => adminApi.dashboard(), []);

  return (
    <div className="adm-page">
      <PageHeader title="Dashboard" lede="Today at HEYRAH, from live store data." />
      {state.kind === "loading" ? <Loading label="Loading the dashboard…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" ? <DashboardBody d={state.data} /> : null}
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  return (
    <>
      <section aria-labelledby="dash-money" className="adm-figures">
        <h2 id="dash-money" className="sr-only">
          Orders and revenue
        </h2>
        <Figure label="Orders today" value={String(d.orders.today)} detail={`${formatINR(d.revenue.todayOrderValue.amount)} placed today`} />
        <Figure label="Paid revenue" value={formatINR(d.revenue.paid.amount)} detail="Paid orders, excluding cancelled" />
        <Figure
          label="Awaiting payment"
          value={formatINR(d.revenue.awaitingPayment.amount)}
          detail={`${d.revenue.awaitingPaymentCount} ${d.revenue.awaitingPaymentCount === 1 ? "order" : "orders"}${d.paymentMode === "manual" ? " to confirm" : ""}`}
          to={d.revenue.awaitingPaymentCount > 0 ? "/admin/orders?payment=PENDING_PAYMENT" : undefined}
        />
        <Figure label="All orders" value={String(d.orders.total)} detail="Since the store opened" />
      </section>

      <section className="adm-panel" aria-labelledby="dash-status">
        <div className="adm-panel__head">
          <h2 id="dash-status">Orders by status</h2>
        </div>
        <ul className="adm-statusbar">
          {STATUSES.map((s) => (
            <li key={s}>
              <Link to={`/admin/orders?status=${s}`} className="adm-statusbar__item">
                <span className="adm-statusbar__n">{d.orders.byStatus[s] ?? 0}</span>
                <span className="adm-statusbar__label">{ORDER_STATUS_LABEL[s]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="adm-split">
        <section className="adm-panel" aria-labelledby="dash-recent">
          <div className="adm-panel__head">
            <h2 id="dash-recent">Recent orders</h2>
            <Link to="/admin/orders">All orders</Link>
          </div>
          {d.recentOrders.length === 0 ? (
            <Empty title="No orders yet">Orders appear here as soon as customers check out.</Empty>
          ) : (
            <ul className="adm-list">
              {d.recentOrders.map((o) => (
                <li key={o.id} className="adm-list__row">
                  <div className="adm-list__main">
                    <Link to={`/admin/orders/${o.id}`} className="adm-list__title">
                      {o.orderNumber}
                    </Link>
                    <span className="adm-list__meta">
                      {o.customer.name}, {dateTimeFmt.format(new Date(o.placedAt))}
                    </span>
                  </div>
                  <div className="adm-list__side">
                    <span className="adm-num">{formatINR(o.grandTotal.amount)}</span>
                    <span className="adm-list__badges">
                      <OrderStatusBadge status={o.status} />
                      <PaymentBadge status={o.paymentStatus} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="adm-panel" aria-labelledby="dash-stock">
          <div className="adm-panel__head">
            <h2 id="dash-stock">Stock to watch</h2>
            <Link to="/admin/inventory">Inventory</Link>
          </div>
          <p className="adm-panel__note">
            {d.inventory.outOfStockCount} out of stock, {d.inventory.lowStockCount} low (at or below {d.inventory.lowStockThreshold} units unless a
            product sets its own threshold).
          </p>
          {d.inventory.outOfStock.length === 0 && d.inventory.lowStock.length === 0 ? (
            <Empty title="Every product is well stocked" />
          ) : (
            <ul className="adm-list">
              {[...d.inventory.outOfStock, ...d.inventory.lowStock].map((p) => (
                <li key={p.id} className="adm-list__row">
                  <div className="adm-list__main">
                    <Link to={`/admin/products/${p.id}`} className="adm-list__title">
                      {p.name}
                    </Link>
                    <span className="adm-list__meta">{p.sku}</span>
                  </div>
                  <div className="adm-list__side">
                    <span className={p.stockQuantity === 0 ? "adm-stock adm-stock--out" : "adm-stock adm-stock--low"}>
                      {p.stockQuantity === 0 ? "Out of stock" : `${p.stockQuantity} left`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {d.inventory.outOfStockCount + d.inventory.lowStockCount > d.inventory.outOfStock.length + d.inventory.lowStock.length ? (
            <p className="adm-panel__more">
              <Link to="/admin/inventory?filter=low">See every low-stock product</Link>
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

function Figure({ label, value, detail, to }: { label: string; value: string; detail: string; to?: string }) {
  const body = (
    <>
      <span className="adm-figure__label">{label}</span>
      <span className="adm-figure__value">{value}</span>
      <span className="adm-figure__detail">{detail}</span>
    </>
  );
  return to ? (
    <Link to={to} className="adm-figure adm-figure--link">
      {body}
    </Link>
  ) : (
    <div className="adm-figure">{body}</div>
  );
}
