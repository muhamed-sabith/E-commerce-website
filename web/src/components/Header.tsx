import { useMemo } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCart } from "../cart/CartContext";
import { MergeNotice } from "../cart/MergeNotice";
import { useWishlist } from "../wishlist/WishlistContext";
import "./header.css";

/**
 * Storefront shell: brand header with category navigation + search,
 * routed content below. Category links come from the live API; the account
 * control reflects the session state (server-restored, never guessed). The
 * bag count is the server's itemCount — never a local tally.
 */
export function Header({ categories }: { categories: { slug: string; name: string }[] }) {
  const { user, restoring, logout } = useAuth();
  const { cart, announcement } = useCart();
  const { announcement: wishlistAnnouncement } = useWishlist();
  // No number until the server has answered: never show a guessed count.
  const count = cart ? cart.itemCount : null;

  const account = useMemo(() => {
    if (restoring) {
      return <span className="site-header__account-muted">Account</span>;
    }
    if (!user) {
      return (
        <Link to="/login" className="site-header__link">
          Sign in
        </Link>
      );
    }
    return (
      <span className="site-header__account">
        {user.role === "ADMIN" ? (
          <Link to="/admin" className="site-header__link">
            Admin
          </Link>
        ) : null}
        <Link to="/account" className="site-header__link">
          {user.name}
        </Link>
        <button
          type="button"
          className="site-header__logout"
          onClick={() => {
            void logout();
          }}
        >
          Sign out
        </button>
      </span>
    );
  }, [user, restoring, logout]);

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="site-header__brand" aria-label="HEYRAH home">
            HEYRAH
          </Link>

          <nav aria-label="Categories" className="site-header__nav">
            {categories.map((c) => (
              <NavLink
                key={c.slug}
                to={`/category/${c.slug}`}
                className={({ isActive }) =>
                  isActive ? "site-header__link is-active" : "site-header__link"
                }
              >
                {c.name}
              </NavLink>
            ))}
          </nav>

          <div className="site-header__tools">
          <form
            className="site-header__search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("q");
              const q = typeof value === "string" ? value.trim() : "";
              window.location.assign(q ? `/products?q=${encodeURIComponent(q)}` : "/products");
            }}
          >
            <input
              type="search"
              name="q"
              placeholder="Search"
              aria-label="Search products"
              className="site-header__search-input"
            />
            <button type="submit" className="site-header__search-btn" aria-label="Submit search">
              Search
            </button>
          </form>

          <nav aria-label="Account" className="site-header__account-nav">
            {account}
            <NavLink
              to="/wishlist"
              className={({ isActive }) =>
                isActive ? "site-header__link is-active" : "site-header__link"
              }
              data-testid="header-wishlist"
            >
              Wishlist
            </NavLink>
            <NavLink
              to="/cart"
              className={({ isActive }) =>
                isActive ? "site-header__bag is-active" : "site-header__bag"
              }
              aria-label={
                count === null ? "Bag" : `Bag, ${count} ${count === 1 ? "item" : "items"}`
              }
              data-testid="header-bag"
            >
              <span aria-hidden="true">Bag</span>
              {count === null ? null : (
                <span className="site-header__bag-count" aria-hidden="true" data-testid="bag-count">
                  {count}
                </span>
              )}
            </NavLink>
          </nav>
          </div>
        </div>
      </header>
      {/* Shared polite live region: present before any cart change so every
          add/update/remove is announced (a11y skill §6). */}
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="cart-announcer">
        {announcement}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="wishlist-announcer">
        {wishlistAnnouncement}
      </p>
      <MergeNotice />
      <Outlet />
    </>
  );
}
