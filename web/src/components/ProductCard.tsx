import { Link } from "react-router-dom";
import { AddToBagButton } from "../cart/AddToBagButton";
import { formatINR } from "../lib/format";
import { SaveToggle } from "../wishlist/SaveToggle";
import type { ProductListItem } from "../api/catalog";
import "./product-card.css";

/**
 * Product card (DESIGN_SYSTEM §5): image-first, name, INR price with
 * strikethrough when discounted, availability state as text + color.
 * The link and the add-to-bag action are siblings (a button can't live
 * inside an anchor), so both stay independently keyboard reachable.
 */
export function ProductCard({ product }: { product: ProductListItem }) {
  const discounted = product.finalPrice.amount !== product.price.amount;

  return (
    <article className="product-card">
      <div className="product-card__save">
        <SaveToggle productId={product.id} productName={product.name} variant="compact" />
      </div>
      <Link to={`/product/${product.slug}`} className="product-card__link">
        <div className="product-card__media">
          {product.image ? (
            <img
              src={product.image.src}
              alt={product.image.alt}
              loading="lazy"
              className="product-card__img"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement?.classList.add("is-fallback");
              }}
            />
          ) : null}
        </div>
        <div className="product-card__body">
          <p className="product-card__category">{product.categoryName}</p>
          <h3 className="product-card__name">{product.name}</h3>
          <p className="product-card__price price">
            {discounted ? (
              <>
                <span className="sr-only">Was </span>
                <s className="price-strike">{formatINR(product.price.amount)}</s>
                <span className="sr-only">, now </span>
              </>
            ) : null}
            <span className="product-card__final">{formatINR(product.finalPrice.amount)}</span>
            {discounted ? <span className="product-card__badge">Sale</span> : null}
          </p>
          <p className={product.inStock ? "product-card__stock" : "product-card__stock is-out"}>
            {product.inStock ? "In stock" : "Out of stock"}
          </p>
        </div>
      </Link>
      <div className="product-card__actions">
        <AddToBagButton
          productId={product.id}
          productName={product.name}
          available={product.inStock}
          variant="compact"
        />
      </div>
    </article>
  );
}
