import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import type { WishlistItem } from "../api/customer";
import { AddToBagButton } from "../cart/AddToBagButton";
import { formatINR } from "../lib/format";
import { useWishlist } from "../wishlist/WishlistContext";
import "../wishlist/wishlist.css";

/**
 * Wishlist page (REQUIREMENTS §2.9). Live prices and availability from the
 * server; unavailable pieces stay listed, flagged in words, and can't be
 * added to the bag. Guarded by ProtectedRoute — guests are sent to sign in.
 */
export function WishlistPage() {
  const { wishlist, status, refresh } = useWishlist();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const heading = (
    <h1 className="wishlist__title" tabIndex={-1} ref={headingRef}>
      Wishlist
    </h1>
  );

  if ((status === "loading" || status === "guest") && !wishlist) {
    return (
      <main className="wishlist">
        <div className="wishlist__inner">
          {heading}
          <div className="wishlist__skeleton" aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
          <p className="sr-only" role="status">
            Loading your wishlist
          </p>
        </div>
      </main>
    );
  }

  if (status === "error" && !wishlist) {
    return (
      <main className="wishlist">
        <div className="wishlist__inner">
          {heading}
          <div className="wishlist__state" role="alert">
            <p>We couldn't load your wishlist. Check your connection and try again.</p>
            <button type="button" className="wishlist__button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  const items = wishlist?.items ?? [];

  return (
    <main className="wishlist">
      <div className="wishlist__inner">
        {heading}
        {items.length === 0 ? (
          <div className="wishlist__empty" data-testid="empty-wishlist">
            <p className="wishlist__empty-lede">Nothing saved yet.</p>
            <p>Save pieces you love and they'll wait here, with today's price.</p>
            <Link to="/products" className="wishlist__button">
              Explore the collection
            </Link>
          </div>
        ) : (
          <>
            <p className="wishlist__lede">
              {items.length} saved {items.length === 1 ? "piece" : "pieces"}. Prices and
              availability are always current.
            </p>
            <ul className="wishlist__grid">
              {items.map((item) => (
                <WishCard
                  key={item.id}
                  item={item}
                  onRemoved={() => headingRef.current?.focus()}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

function stateLabel(item: WishlistItem): string {
  if (item.availability === "unavailable") return "No longer available";
  if (item.availability === "out_of_stock") return "Out of stock";
  return "In stock";
}

function WishCard({ item, onRemoved }: { item: WishlistItem; onRemoved: () => void }) {
  const { remove, pending } = useWishlist();
  const [error, setError] = useState<string | null>(null);
  const busy = pending.has(item.product.id);
  const discounted = item.finalPrice.amount !== item.price.amount;
  const hasPage = item.product.slug !== "";
  const href = `/product/${item.product.slug}`;

  async function handleRemove() {
    if (busy) return;
    setError(null);
    try {
      await remove(item.product.id);
      onRemoved();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Couldn't remove this piece. Try again.",
      );
    }
  }

  const media = item.product.image ? (
    <img
      src={item.product.image.src}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = "none";
        e.currentTarget.parentElement?.classList.add("is-fallback");
      }}
    />
  ) : null;

  return (
    <li
      className={`wish-card${item.purchasable ? "" : " is-unavailable"}`}
      data-testid="wish-card"
      aria-busy={busy}
    >
      {hasPage ? (
        <Link to={href} className={`wish-card__media${media ? "" : " is-fallback"}`} tabIndex={-1} aria-hidden="true">
          {media}
        </Link>
      ) : (
        <div className={`wish-card__media${media ? "" : " is-fallback"}`} aria-hidden="true">
          {media}
        </div>
      )}

      <div className="wish-card__body">
        <p className="wish-card__category">{item.product.categoryName}</p>
        <h2 className="wish-card__name">
          {hasPage ? <Link to={href}>{item.product.name}</Link> : item.product.name}
        </h2>
        <p className="wish-card__price price" data-testid="wish-price">
          {discounted ? (
            <>
              <span className="sr-only">Was </span>
              <s className="wish-card__was">{formatINR(item.price.amount)}</s>
              <span className="sr-only">, now </span>
            </>
          ) : null}
          <span className={`wish-card__now${discounted ? " is-sale" : ""}`}>
            {formatINR(item.finalPrice.amount)}
          </span>
        </p>
        <p
          className={`wish-card__state${item.purchasable ? "" : " is-out"}`}
          data-testid="wish-availability"
        >
          {stateLabel(item)}
        </p>
      </div>

      <div className="wish-card__actions">
        <AddToBagButton
          productId={item.product.id}
          productName={item.product.name}
          available={item.purchasable}
          variant="compact"
        />
        <button
          type="button"
          className="wish-card__remove"
          onClick={() => void handleRemove()}
          aria-disabled={busy}
          aria-label={`Remove ${item.product.name} from wishlist`}
        >
          Remove
        </button>
        {error ? (
          <p className="wish-card__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}
