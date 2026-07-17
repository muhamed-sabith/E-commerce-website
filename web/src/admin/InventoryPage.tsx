import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminApi, type StockItem } from "../api/admin";
import { StockAdjustForm } from "./ProductAssets";
import { Empty, Loading, LoadError, PageHeader, Pagination, ProductStatusBadge, StockBadge, useLoad, usePageParam } from "./ui";

/**
 * Inventory (REQUIREMENTS §3.5–§3.8): server-computed stock state per
 * product, filters for low / out of stock, and an inline audited
 * adjustment per row. The browser never decides what "low" means.
 */

const FILTERS = [
  { value: "all", label: "All" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export function AdminInventoryPage() {
  const [params, setParams] = useSearchParams();
  const page = usePageParam();
  const rawFilter = params.get("filter");
  const filter: Filter = rawFilter === "low" || rawFilter === "out" ? rawFilter : "all";
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState("");

  const { state, reload } = useLoad(() => adminApi.inventory({ filter, q, page }), [filter, q, page]);

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    setParams(next);
  };

  return (
    <div className="adm-page">
      <PageHeader
        title="Inventory"
        lede={state.kind === "ready" ? `Low stock means ${state.data.lowStockThreshold} units or fewer, unless a product sets its own alert.` : undefined}
      />
      <p className="adm-flash" role="status" aria-live="polite">
        {flash}
      </p>

      <div className="adm-toolbar">
        <div className="adm-tabs" role="group" aria-label="Filter by stock">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={filter === f.value ? "adm-tab is-active" : "adm-tab"}
              aria-pressed={filter === f.value}
              onClick={() => update((p) => (f.value === "all" ? p.delete("filter") : p.set("filter", f.value)))}
            >
              {f.label}
              {state.kind === "ready" ? <span className="adm-tab__n">{state.data.counts[f.value]}</span> : null}
            </button>
          ))}
        </div>
        <form
          role="search"
          className="adm-search"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            update((p) => (draft.trim() ? p.set("q", draft.trim()) : p.delete("q")));
          }}
        >
          <label htmlFor="inv-q" className="sr-only">
            Search inventory
          </label>
          <input id="inv-q" type="search" placeholder="Name or SKU" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="adm-btn adm-btn--secondary">
            Search
          </button>
        </form>
      </div>

      {state.kind === "loading" ? <Loading label="Loading inventory…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" && state.data.items.length === 0 ? (
        <Empty title={filter === "out" ? "Nothing is out of stock" : filter === "low" ? "Nothing is running low" : q ? "No products match" : "No products yet"} />
      ) : null}
      {state.kind === "ready" && state.data.items.length > 0 ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--stack">
              <caption className="sr-only">Stock levels{filter !== "all" ? `, ${FILTERS.find((f) => f.value === filter)?.label}` : ""}</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" className="adm-num">
                    In stock
                  </th>
                  <th scope="col">Stock state</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Adjust</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((item) => (
                  <InventoryRow
                    key={item.id}
                    item={item}
                    open={open === item.id}
                    onToggle={() => setOpen((o) => (o === item.id ? null : item.id))}
                    onDone={(message) => {
                      setFlash(message);
                      setOpen(null);
                      void reload(true);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={state.data.page} totalPages={state.data.total_pages} totalItems={state.data.total_items} noun="product" />
        </>
      ) : null}
    </div>
  );
}

function InventoryRow({ item, open, onToggle, onDone }: { item: StockItem; open: boolean; onToggle: () => void; onDone: (m: string) => void }) {
  const panelId = `adj-${item.id}`;
  return (
    <>
      <tr className={open ? "is-open" : undefined}>
        <th scope="row" data-label="Product">
          <Link to={`/admin/products/${item.id}`} className="adm-rowlink">
            {item.name}
          </Link>
          <span className="adm-sub">
            {item.sku}, {item.categoryName}
          </span>
        </th>
        <td data-label="In stock" className="adm-num adm-big">
          {item.stockQuantity}
        </td>
        <td data-label="Stock state">
          <StockBadge state={item.stockState} />
          {item.lowStockThreshold !== null ? <span className="adm-sub">Alert at {item.lowStockThreshold}</span> : null}
        </td>
        <td data-label="Status">
          <ProductStatusBadge status={item.status} />
          {!item.purchasable && item.status === "active" ? <span className="adm-sub">Not purchasable</span> : null}
        </td>
        <td className="adm-actions">
          <button type="button" className="adm-btn adm-btn--secondary adm-btn--sm" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
            {open ? "Close" : "Adjust"}
            <span className="sr-only"> stock for {item.name}</span>
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="adm-subrow" id={panelId}>
          <td colSpan={5}>
            <StockAdjustForm compact productId={item.id} productName={item.name} current={item.stockQuantity} onDone={(_s, m) => onDone(m)} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
