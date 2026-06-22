import { Link } from "react-router-dom";
import { formatINR } from "../lib/format";
import type { ProductListItem } from "../api/catalog";
import "./product-card.css";

/**
 * Product card (DESIGN_SYSTEM §5): image-first, name, INR price with
 * strikethrough when discounted, availability state as text + color.
 */
export function ProductCard({ product }: { product: ProductListItem }) {
  const discounted = product.finalPrice.amount !== product.price.amount;

  return (
    <Link to={`/product/${product.slug}`} className="product-card">
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
          <span className="price-strike">{formatINR(product.price.amount)}</span>
          <span className="product-card__final">{formatINR(product.finalPrice.amount)}</span>
          {discounted ? <span className="product-card__badge">Sale</span> : null}
        </p>
        <p className={product.inStock ? "product-card__stock" : "product-card__stock is-out"}>
          {product.inStock ? "In stock" : "Out of stock"}
        </p>
      </div>
    </Link>
  );
}
