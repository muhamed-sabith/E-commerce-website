import { Link } from "react-router-dom";
import { AddToBagButton } from "../cart/AddToBagButton";
import { formatINR } from "../lib/format";
import { SaveToggle } from "../wishlist/SaveToggle";
import type { ProductListItem } from "../api/catalog";
import "./product-card.css";

/**
 * Product card: portrait image first, then category, name, price (with the
 * original struck through and the saving named when discounted), and stock
 * stated in words. Save and Add to bag are siblings of the product link
 * (no nested interactive elements), so each is reachable on its own.
 */
export function ProductCard({ product, headingLevel = 2 }: { product: ProductListItem; headingLevel?: 2 | 3 }) {
  const discounted = product.finalPrice.amount !== product.price.amount;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const saving =
    product.discount.type === "percent"
      ? `${Number(product.discount.value.amount)}% off`
      : product.discount.type === "fixed"
        ? `${formatINR(product.discount.value.amount)} off`
        : null;

  return (
    <article className="product-card">
      <div className="product-card__save">
        <SaveToggle productId={product.id} productName={product.name} variant="compact" />
      </div>
      <Link to={`/product/${product.slug}`} className="product-card__link">
        <div className={`${product.image ? "product-card__media" : "product-card__media is-fallback"}${product.inStock ? "" : " is-out"}`}>
          {product.image ? (
            <img
              src={product.image.src}
              alt={product.image.alt}
              loading="lazy"
              decoding="async"
              width="900"
              height="1200"
              className="product-card__img"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement?.classList.add("is-fallback");
              }}
            />
          ) : null}
          {saving ? <span className="product-card__flag">{saving}</span> : null}
        </div>
        <div className="product-card__body">
          <p className="product-card__category">{product.categoryName}</p>
          <Heading className="product-card__name">{product.name}</Heading>
          <p className="product-card__price price">
            <span className="product-card__final">
              {discounted ? <span className="sr-only">Now </span> : null}
              {formatINR(product.finalPrice.amount)}
            </span>
            {discounted ? (
              <>
                <span className="sr-only">, was </span>
                <s className="price-strike">{formatINR(product.price.amount)}</s>
              </>
            ) : null}
          </p>
          <p className={product.inStock ? "product-card__stock" : "product-card__stock is-out"}>
            {product.inStock ? "In stock" : "Out of stock"}
          </p>
        </div>
      </Link>
      <div className="product-card__actions">
        <AddToBagButton productId={product.id} productName={product.name} available={product.inStock} variant="compact" />
      </div>
    </article>
  );
}
