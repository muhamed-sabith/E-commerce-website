import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { catalogApi } from "../api/catalog";
import type { ProductDetail as ProductDetailData } from "../api/catalog";
import { AddToBagButton } from "../cart/AddToBagButton";
import { formatINR } from "../lib/format";
import { SaveToggle } from "../wishlist/SaveToggle";
import "./product-detail.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: ProductDetailData };

/**
 * Product detail — gallery, pricing (with strikethrough + discount),
 * specifications, availability. All data is backend-sourced; out-of-stock
 * disables the purchase path with clear labeling (REQUIREMENTS §2.8).
 */
export function ProductDetailPage() {
  const { slug = "" } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setActiveImage(0);
    catalogApi
      .getProduct(slug)
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.kind === "loading") {
    return (
      <main className="pdp">
        <div className="pdp__inner pdp__skeleton" aria-hidden="true" />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="pdp">
        <div className="pdp__inner pdp__state">
          <h1>Product not found</h1>
          <p>This piece may have been retired or is no longer available.</p>
          <Link to="/products" className="pdp__cta">
            Browse the collection
          </Link>
        </div>
      </main>
    );
  }

  const p = state.data;
  const discounted = p.finalPrice.amount !== p.price.amount;
  const outOfStock = p.availability === "out_of_stock";

  return (
    <main className="pdp">
      <div className="pdp__inner">
        <nav className="pdp__breadcrumb" aria-label="Breadcrumb">
          <Link to="/products">Collection</Link>
          <span aria-hidden="true"> / </span>
          <Link to={`/category/${p.categorySlug}`}>{p.categoryName}</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">{p.name}</span>
        </nav>

        <div className="pdp__layout">
          <section className="pdp__gallery" aria-label="Product images">
            <div className="pdp__stage">
              <img src={p.images[activeImage]?.src} alt={p.images[activeImage]?.alt} />
            </div>
            {p.images.length > 1 ? (
              <div className="pdp__thumbs" role="tablist" aria-label="Choose image">
                {p.images.map((img, i) => (
                  <button
                    key={img.src}
                    type="button"
                    role="tab"
                    aria-selected={i === activeImage}
                    className={i === activeImage ? "pdp__thumb is-active" : "pdp__thumb"}
                    onClick={() => setActiveImage(i)}
                  >
                    <img src={img.src} alt="" />
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="pdp__info">
            <p className="pdp__category">{p.categoryName}</p>
            <h1 className="pdp__name">{p.name}</h1>
            <p className="pdp__sku">SKU {p.sku}</p>

            <p className="pdp__price price">
              {discounted ? (
                <>
                  <span className="sr-only">Was </span>
                  <s className="price-strike">{formatINR(p.price.amount)}</s>
                  <span className="sr-only">, now </span>
                </>
              ) : null}
              <span className="pdp__final">{formatINR(p.finalPrice.amount)}</span>
              {p.discount.type !== "none" ? (
                <span className="pdp__badge">
                  {p.discount.type === "percent"
                    ? `${Number(p.discount.value.amount)}% off`
                    : `${formatINR(p.discount.value.amount)} off`}
                </span>
              ) : null}
            </p>

            <p className={outOfStock ? "pdp__stock is-out" : "pdp__stock"} data-testid="availability">
              {outOfStock ? "Out of stock" : "In stock"}
            </p>

            <div className="pdp__actions">
              <AddToBagButton
                key={p.id}
                productId={p.id}
                productName={p.name}
                available={!outOfStock}
              />
              <SaveToggle productId={p.id} productName={p.name} />
            </div>

            <div className="pdp__description">
              <h2>Description</h2>
              <p>{p.description}</p>
            </div>

            {p.specifications.length > 0 ? (
              <div className="pdp__specs">
                <h2>Details</h2>
                <dl>
                  {p.specifications.map((s) => (
                    <div key={s.key} className="pdp__spec-row">
                      <dt>{s.key}</dt>
                      <dd>{s.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
