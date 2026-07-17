import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminApi } from "../api/admin";
import { formatINR } from "../lib/format";
import { Empty, Loading, LoadError, PageHeader, Pagination, ProductStatusBadge, StockBadge, useLoad, usePageParam } from "./ui";

/** Product list: search by name/SKU, status filter, pagination — all in the URL. */
export function AdminProductsPage() {
  const [params, setParams] = useSearchParams();
  const page = usePageParam();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const categoryId = params.get("category_id") ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const { state, reload } = useLoad(() => adminApi.listProducts({ q, status, category_id: categoryId || undefined, page }), [q, status, categoryId, page]);

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    setParams(next);
  };

  return (
    <div className="adm-page">
      <PageHeader
        title="Products"
        actions={
          <Link to="/admin/products/new" className="adm-btn adm-btn--primary">
            Add product
          </Link>
        }
      />

      <div className="adm-toolbar">
        <form
          role="search"
          className="adm-search"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            update((p) => (draft.trim() ? p.set("q", draft.trim()) : p.delete("q")));
          }}
        >
          <label htmlFor="prod-q" className="sr-only">
            Search products
          </label>
          <input id="prod-q" type="search" placeholder="Name or SKU" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="adm-btn adm-btn--secondary">
            Search
          </button>
        </form>
        <label className="adm-select">
          <span>Status</span>
          <select value={status} onChange={(e) => update((p) => (e.target.value ? p.set("status", e.target.value) : p.delete("status")))}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        {categoryId ? (
          <button type="button" className="adm-chip" onClick={() => update((p) => p.delete("category_id"))}>
            Filtered to one category <span aria-hidden="true">×</span>
            <span className="sr-only">, remove filter</span>
          </button>
        ) : null}
      </div>

      {state.kind === "loading" ? <Loading label="Loading products…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" && state.data.items.length === 0 ? (
        <Empty title={q || status || categoryId ? "No products match" : "No products yet"}>
          {q || status || categoryId ? (
            <button type="button" className="adm-btn adm-btn--secondary" onClick={() => setParams(new URLSearchParams())}>
              Clear filters
            </button>
          ) : (
            <Link to="/admin/products/new" className="adm-btn adm-btn--primary">
              Add the first product
            </Link>
          )}
        </Empty>
      ) : null}
      {state.kind === "ready" && state.data.items.length > 0 ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--stack">
              <caption className="sr-only">Products</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="adm-num">
                    Price
                  </th>
                  <th scope="col" className="adm-num">
                    Stock
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" data-label="Product">
                      <div className="adm-prodcell">
                        {p.image ? (
                          <img
                            src={p.image.src}
                            alt=""
                            className="adm-thumb"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.visibility = "hidden";
                            }}
                          />
                        ) : (
                          <span className="adm-thumb adm-thumb--none" aria-hidden="true" />
                        )}
                        <span>
                          <Link to={`/admin/products/${p.id}`} className="adm-rowlink">
                            {p.name}
                          </Link>
                          <span className="adm-sub">{p.sku}</span>
                        </span>
                      </div>
                    </th>
                    <td data-label="Category">{p.categoryName}</td>
                    <td data-label="Price" className="adm-num">
                      {formatINR(p.finalPrice.amount)}
                      {p.finalPrice.amount !== p.price.amount ? <span className="adm-sub adm-strike">{formatINR(p.price.amount)}</span> : null}
                    </td>
                    <td data-label="Stock" className="adm-num">
                      <span className="adm-stockcell">
                        {p.stockQuantity}
                        {p.stockState !== "in_stock" ? <StockBadge state={p.stockState} /> : null}
                      </span>
                    </td>
                    <td data-label="Status">
                      <ProductStatusBadge status={p.status} />
                    </td>
                  </tr>
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
