import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { catalogApi } from "../api/catalog";
import type { ProductDetail as ProductDetailData, ProductListItem } from "../api/catalog";
import { AddToBagButton } from "../cart/AddToBagButton";
import { ProductCard } from "../components/ProductCard";
import { formatINR } from "../lib/format";
import { useHead } from "../lib/head";
import { useStore } from "../lib/store";
import { SaveToggle } from "../wishlist/SaveToggle";
import "./product-detail.css";

type LoadState = { kind: "loading" } | { kind: "error"; notFound: boolean } | { kind: "ready"; data: ProductDetailData };

/**
 * Product detail: portrait gallery with keyboard-operable thumbnails,
 * pricing (original struck through, saving named), stock in words, add to
 * bag + save, description, details, and a "more from" rail of real products
 * in the same category. Head tags follow the product (the server injected
 * the same values on first load).
 */
export function ProductDetailPage() {
  const { slug = "" } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [activeImage, setActiveImage] = useState(0);
  const [related, setRelated] = useState<ProductListItem[]>([]);
  const store = useStore();

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setActiveImage(0);
    setRelated([]);
    catalogApi
      .getProduct(slug)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: "ready", data });
        catalogApi
          .listProducts({ category: [data.categorySlug], sort: "newest", page_size: 5 })
          .then((r) => !cancelled && setRelated(r.items.filter((p) => p.id !== data.id).slice(0, 4)))
          .catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", notFound: err instanceof Error && /API 404/.test(err.message) });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const p = state.kind === "ready" ? state.data : null;
  useHead(
    p
      ? { title: `${p.name} | HEYRAH`, description: p.description.slice(0, 155), canonicalPath: `/product/${p.slug}` }
      : state.kind === "error"
        ? { title: "Product not found | HEYRAH", robots: "noindex, follow" }
        : null,
  );

  if (state.kind === "loading") {
    return (
      <main className="pdp">
        <div className="pdp__inner">
          <div className="pdp__layout pdp__skeleton" aria-hidden="true">
            <div className="pdp__skeleton-media" />
            <div className="pdp__skeleton-text" />
          </div>
          <p className="sr-only" role="status">
            Loading product…
          </p>
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="pdp">
        <div className="pdp__inner pdp__state">
          <h1>{state.notFound ? "Product not found" : "This piece couldn't load"}</h1>
          <p>{state.notFound ? "This piece may have been retired or is no longer available." : "Check your connection and try again."}</p>
          <Link to="/products" className="pdp__cta">
            Browse the collection
          </Link>
        </div>
      </main>
    );
  }

  const d = state.data;
  const discounted = d.finalPrice.amount !== d.price.amount;
  const outOfStock = d.availability === "out_of_stock";
  const image = d.images[activeImage];
  const freeFrom = store && Number(store.shipping.freeThreshold.amount) > 0 ? store.shipping.freeThreshold.amount : null;

  return (
    <main className="pdp">
      <div className="pdp__inner">
        <nav className="pdp__breadcrumb" aria-label="Breadcrumb">
          <Link to="/products">The Collection</Link>
          <span aria-hidden="true"> / </span>
          <Link to={`/category/${d.categorySlug}`}>{d.categoryName}</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">{d.name}</span>
        </nav>

        <div className="pdp__layout">
          <section className="pdp__gallery" aria-label="Product images">
            <div className="pdp__stage">
              {image ? <img src={image.src} alt={image.alt} width="900" height="1200" fetchPriority="high" /> : <span className="pdp__noimage">HEYRAH</span>}
            </div>
            {d.images.length > 1 ? (
              <div className="pdp__thumbs" role="group" aria-label="Choose image">
                {d.images.map((img, i) => (
                  <button
                    key={img.src}
                    type="button"
                    aria-pressed={i === activeImage}
                    aria-label={`Show image ${i + 1} of ${d.images.length}`}
                    className={i === activeImage ? "pdp__thumb is-active" : "pdp__thumb"}
                    onClick={() => setActiveImage(i)}
                  >
                    <img src={img.src} alt="" width="90" height="120" loading="lazy" />
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="pdp__info" aria-labelledby="pdp-name">
            <p className="pdp__category">
              <Link to={`/category/${d.categorySlug}`}>{d.categoryName}</Link>
            </p>
            <h1 className="pdp__name" id="pdp-name">
              {d.name}
            </h1>

            <p className="pdp__price price">
              <span className="pdp__final">
                {discounted ? <span className="sr-only">Now </span> : null}
                {formatINR(d.finalPrice.amount)}
              </span>
              {discounted ? (
                <>
                  <span className="sr-only">, was </span>
                  <s className="price-strike">{formatINR(d.price.amount)}</s>
                </>
              ) : null}
              {d.discount.type !== "none" ? (
                <span className="pdp__badge">
                  {d.discount.type === "percent" ? `${Number(d.discount.value.amount)}% off` : `${formatINR(d.discount.value.amount)} off`}
                </span>
              ) : null}
            </p>

            <p className={outOfStock ? "pdp__stock is-out" : "pdp__stock"} data-testid="availability">
              {outOfStock ? "Out of stock" : "In stock"}
            </p>

            <div className="pdp__actions">
              <AddToBagButton key={d.id} productId={d.id} productName={d.name} available={!outOfStock} />
              <SaveToggle productId={d.id} productName={d.name} />
            </div>

            <ul className="pdp__assure">
              <li>{freeFrom ? `Free shipping from ${formatINR(freeFrom)}` : "Shipping shown before you pay"}</li>
              <li>Price and stock confirmed at checkout</li>
              <li>
                <Link to="/help#orders">Track every order in your account</Link>
              </li>
            </ul>

            <div className="pdp__description">
              <h2>Description</h2>
              <p>{d.description}</p>
            </div>

            {d.specifications.length > 0 ? (
              <div className="pdp__specs">
                <h2>Details</h2>
                <dl>
                  {d.specifications.map((s) => (
                    <div key={s.key} className="pdp__spec-row">
                      <dt>{s.key}</dt>
                      <dd>{s.value}</dd>
                    </div>
                  ))}
                  <div className="pdp__spec-row">
                    <dt>SKU</dt>
                    <dd className="pdp__sku">{d.sku}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="pdp__sku">SKU {d.sku}</p>
            )}
          </section>
        </div>

        {related.length > 0 ? (
          <section className="pdp__related" aria-labelledby="related-h">
            <div className="pdp__related-head">
              <h2 id="related-h">More {d.categoryName.toLowerCase()}</h2>
              <Link to={`/category/${d.categorySlug}`}>View all</Link>
            </div>
            <div className="pdp__related-grid">
              {related.map((r) => (
                <ProductCard key={r.id} product={r} headingLevel={3} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
