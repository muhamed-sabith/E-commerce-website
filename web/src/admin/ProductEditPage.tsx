import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { adminApi, STOCK_REASON_LABEL, type AdminCategory, type AdminProduct } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { formatINR } from "../lib/format";
import { ImageManager, StockAdjustForm } from "./ProductAssets";
import { ProductForm } from "./ProductForm";
import { ConfirmDialog, dateTimeFmt, Loading, LoadError, PageHeader, ProductStatusBadge, StockBadge, useLoad } from "./ui";

/** /admin/products/new — create, then continue on the product page to add images. */
export function AdminProductNewPage() {
  const navigate = useNavigate();
  const { state, reload } = useLoad(() => adminApi.listCategories(), []);
  return (
    <div className="adm-page adm-page--narrow">
      <PageHeader title="Add product" back={{ to: "/admin/products", label: "Products" }} lede="New products start inactive. Add images on the next screen, then set it active." />
      {state.kind === "loading" ? <Loading /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" ? (
        <ProductForm
          mode="create"
          categories={state.data.items}
          onCancel={() => navigate("/admin/products")}
          onSubmit={async (input) => {
            const { product } = await adminApi.createProduct(input);
            navigate(`/admin/products/${product.id}`, { state: { flash: `${product.name} created. Add an image to put it on sale.` } });
          }}
        />
      ) : null}
    </div>
  );
}

/** /admin/products/:id — edit, images, stock, and archive/delete. */
export function AdminProductEditPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, reload, set } = useLoad(
    async () => {
      const [p, c] = await Promise.all([adminApi.getProduct(id), adminApi.listCategories()]);
      return { product: p.product, categories: c.items };
    },
    [id],
  );
  const location = useLocation();
  const [flash, setFlash] = useState<string>(() => {
    const f = (location.state as { flash?: unknown } | null)?.flash;
    return typeof f === "string" ? f : "";
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formKey, setFormKey] = useState(0);

  if (state.kind === "loading") return <div className="adm-page"><Loading label="Loading product…" /></div>;
  if (state.kind === "error") {
    return (
      <div className="adm-page">
        <PageHeader title={state.status === 404 ? "Product not found" : "Product"} back={{ to: "/admin/products", label: "Products" }} />
        {state.status === 404 ? <p>It may have been deleted.</p> : <LoadError message={state.message} onRetry={() => void reload()} />}
      </div>
    );
  }

  const { product: p, categories } = state.data;
  const update = (product: AdminProduct, categoriesNext: AdminCategory[] = categories) => set({ product, categories: categoriesNext });

  return (
    <div className="adm-page">
      <PageHeader
        title={p.name}
        back={{ to: "/admin/products", label: "Products" }}
        lede={
          <span className="adm-head__meta">
            <span>{p.sku}</span>
            <ProductStatusBadge status={p.status} />
            <StockBadge state={p.stockState} />
            {p.status === "active" ? (
              <Link to={`/product/${p.slug}`} target="_blank" rel="noopener">
                View in store<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            ) : null}
          </span>
        }
      />
      <p className="adm-flash" role="status" aria-live="polite">
        {flash}
      </p>

      <div className="adm-split adm-split--wide">
        <div>
          <ProductForm
            key={formKey}
            mode="edit"
            product={p}
            categories={categories}
            onCancel={() => setFormKey((k) => k + 1)}
            onSubmit={async (input) => {
              const { product } = await adminApi.updateProduct(p.id, input);
              update(product);
              setFlash("Changes saved.");
              setFormKey((k) => k + 1);
            }}
          />
        </div>
        <div className="adm-stack">
          <ImageManager
            productId={p.id}
            productName={p.name}
            images={p.images}
            isActive={p.status === "active"}
            onChange={(images) => update({ ...p, images })}
          />

          <section className="adm-panel" aria-labelledby="stock-h">
            <div className="adm-panel__head">
              <h2 id="stock-h">Stock</h2>
              <span className="adm-num adm-big">{p.stockQuantity}</span>
            </div>
            <p className="adm-panel__note">
              Low-stock alert at {p.effectiveLowStockThreshold} {p.lowStockThreshold === null ? "(store default)" : "(this product)"}. Every change is recorded with your
              name.
            </p>
            <StockAdjustForm
              productId={p.id}
              productName={p.name}
              current={p.stockQuantity}
              onDone={(_stock, message) => {
                setFlash(message);
                void adminApi.getProduct(p.id).then(({ product }) => update(product));
              }}
            />
            {p.stockHistory.length > 0 ? (
              <details className="adm-history">
                <summary>Recent stock changes</summary>
                <ul>
                  {p.stockHistory.map((h) => (
                    <li key={h.id}>
                      <span className={h.delta > 0 ? "adm-delta adm-delta--up" : "adm-delta adm-delta--down"}>
                        {h.delta > 0 ? "+" : "−"}
                        {Math.abs(h.delta)}
                      </span>
                      <span>{STOCK_REASON_LABEL[h.reason] ?? h.reason}</span>
                      <span className="adm-sub">
                        → {h.resultingQuantity}, {dateTimeFmt.format(new Date(h.at))}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="adm-panel adm-panel--quiet" aria-labelledby="danger-h">
            <h2 id="danger-h">{p.deletion === "archive" ? "Archive product" : "Delete product"}</h2>
            <p className="adm-panel__note">
              {p.deletion === "archive"
                ? p.status === "archived"
                  ? "Archived: hidden from the store and kept for order history."
                  : `This product has ${p.orderLineCount > 0 ? "orders" : "stock history"}, so it can only be archived. It disappears from the store; past orders keep their details.`
                : "Never ordered, so it can be deleted permanently along with its images."}
            </p>
            {p.status !== "archived" || p.deletion === "delete" ? (
              <button type="button" className="adm-btn adm-btn--danger-outline" onClick={() => setConfirmDelete(true)}>
                {p.deletion === "archive" ? "Archive product" : "Delete product"}
              </button>
            ) : null}
          </section>
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title={p.deletion === "archive" ? `Archive ${p.name}?` : `Delete ${p.name}?`}
          confirmLabel={p.deletion === "archive" ? "Archive product" : "Delete product"}
          busyLabel={p.deletion === "archive" ? "Archiving…" : "Deleting…"}
          cancelLabel="Keep product"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              const { result } = await adminApi.deleteProduct(p.id);
              if (result === "deleted") {
                navigate("/admin/products", { replace: true });
              } else {
                const { product } = await adminApi.getProduct(p.id);
                update(product);
                setFlash(`${p.name} archived.`);
                setConfirmDelete(false);
              }
            } catch (err) {
              throw new Error(err instanceof ApiRequestError ? err.message : "Couldn't complete that. Try again.");
            }
          }}
        >
          <p>
            {p.deletion === "archive"
              ? "It will be hidden everywhere in the store. Orders that include it stay exactly as they are. You can set it active again later."
              : "The product and its images are removed permanently. This can't be undone."}
          </p>
          <p className="adm-sub">Current price {formatINR(p.finalPrice.amount)}, {p.stockQuantity} in stock.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
