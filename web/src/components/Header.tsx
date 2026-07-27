import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCart } from "../cart/CartContext";
import { MergeNotice } from "../cart/MergeNotice";
import { useStore } from "../lib/store";
import { formatINR } from "../lib/format";
import { useWishlist } from "../wishlist/WishlistContext";
import { Footer } from "./Footer";
import "./header.css";

/**
 * Storefront shell. A one-line information strip (real shipping rule from
 * the API, nothing invented), a compact teal header — the official
 * monogram, category navigation, search, wishlist, account, bag — and the
 * footer. Below 900px the categories, account links and search move into a
 * drawer: a modal <dialog> (focus trap + Escape + inert page), opened from a
 * Menu button that gets focus back when it closes.
 */
export function Header({ categories }: { categories: { slug: string; name: string }[] }) {
  const { user, restoring, logout } = useAuth();
  const { cart, announcement } = useCart();
  const { announcement: wishlistAnnouncement } = useWishlist();
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // No number until the server has answered: never show a guessed count.
  const count = cart ? cart.itemCount : null;

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get("q");
    const q = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    setDrawerOpen(false);
    navigate(q ? `/products?q=${encodeURIComponent(q)}` : "/products");
  };

  // Close the drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const d = drawerRef.current;
    if (!d) return;
    if (drawerOpen && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      // Start in the search field: the most common reason to open the menu.
      d.querySelector<HTMLElement>("input[type=search]")?.focus();
    } else if (!drawerOpen && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
      menuButtonRef.current?.focus();
    }
  }, [drawerOpen]);

  const freeFrom = store && Number(store.shipping.freeThreshold.amount) > 0 ? formatINR(store.shipping.freeThreshold.amount) : null;
  const shippingLine = store
    ? freeFrom
      ? `Free shipping on orders from ${freeFrom}, otherwise ${formatINR(store.shipping.flatRate.amount)}`
      : "Free shipping on every order"
    : null;
  const shippingShort = store ? (freeFrom ? `Free shipping from ${freeFrom}` : "Free shipping on every order") : null;

  const accountLinks = restoring ? null : user ? (
    <>
      {user.role === "ADMIN" ? (
        <Link to="/admin" className="site-header__link">
          Admin
        </Link>
      ) : null}
      <Link to="/account" className="site-header__link site-header__link--name">
        {user.name}
      </Link>
      <button type="button" className="site-header__logout" onClick={() => void logout()}>
        Sign out
      </button>
    </>
  ) : (
    <Link to="/login" className="site-header__link">
      Sign in
    </Link>
  );

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <p className="site-strip" data-testid="info-strip">
        {shippingLine ? (
          <>
            <span className="site-strip__long">{shippingLine}</span>
            <span className="site-strip__short" aria-hidden="true">
              {shippingShort}
            </span>
            <Link to="/help#shipping">Shipping details</Link>
          </>
        ) : (
          <span>
            <Link to="/help">Ordering, payment and shipping</Link>
          </span>
        )}
      </p>
      <header className="site-header">
        <div className="site-header__inner">
          <button
            type="button"
            className="site-header__menu"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            aria-controls="site-drawer"
            onClick={() => setDrawerOpen(true)}
            ref={menuButtonRef}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M3 6h14M3 10h14M3 14h14" />
            </svg>
            <span>Menu</span>
          </button>

          <Link to="/" className="site-header__brand" aria-label="HEYRAH home">
            <img src="/brand-mark.webp" alt="" width="196" height="122" className="site-header__mark brand-art" />
            <span className="site-header__wordmark" aria-hidden="true">
              HEYRAH
            </span>
          </Link>

          <nav aria-label="Categories" className="site-header__nav">
            <NavLink to="/products" end className={({ isActive }) => (isActive ? "site-header__link is-active" : "site-header__link")}>
              All
            </NavLink>
            {categories.map((c) => (
              <NavLink
                key={c.slug}
                to={`/category/${c.slug}`}
                className={({ isActive }) => (isActive ? "site-header__link is-active" : "site-header__link")}
              >
                {c.name}
              </NavLink>
            ))}
          </nav>

          <div className="site-header__tools">
            <form className="site-header__search" role="search" onSubmit={search}>
              <input
                type="search"
                name="q"
                placeholder="Search"
                aria-label="Search products"
                className="site-header__search-input"
                defaultValue={new URLSearchParams(location.search).get("q") ?? ""}
                key={location.search}
                maxLength={200}
              />
              <button type="submit" className="site-header__search-btn" aria-label="Submit search">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <circle cx="9" cy="9" r="5.5" />
                  <path d="M13.2 13.2 17 17" />
                </svg>
              </button>
            </form>

            <nav aria-label="Account" className="site-header__account-nav">
              <span className="site-header__account">{accountLinks}</span>
              <NavLink
                to="/wishlist"
                className={({ isActive }) => (isActive ? "site-header__link site-header__wish is-active" : "site-header__link site-header__wish")}
                data-testid="header-wishlist"
              >
                Wishlist
              </NavLink>
              <NavLink
                to="/cart"
                className={({ isActive }) => (isActive ? "site-header__bag is-active" : "site-header__bag")}
                aria-label={count === null ? "Bag" : `Bag, ${count} ${count === 1 ? "item" : "items"}`}
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

      <dialog
        id="site-drawer"
        ref={drawerRef}
        className="site-drawer"
        aria-label="Menu"
        onCancel={(e) => {
          e.preventDefault();
          setDrawerOpen(false);
        }}
        onClick={(e) => {
          // Backdrop click (the dialog element itself, outside the panel) closes.
          if (e.target === e.currentTarget) setDrawerOpen(false);
        }}
      >
        <div className="site-drawer__panel">
          <div className="site-drawer__top">
            <span className="site-drawer__title">HEYRAH</span>
            <button type="button" className="site-drawer__close" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
          </div>
          <form className="site-drawer__search" role="search" onSubmit={search}>
            <label htmlFor="drawer-q" className="sr-only">
              Search products
            </label>
            <input id="drawer-q" type="search" name="q" placeholder="Search the collection" maxLength={200} />
            <button type="submit" className="site-drawer__go">
              Search
            </button>
          </form>
          <nav aria-label="Shop" className="site-drawer__nav">
            <ul>
              <li>
                <Link to="/products">The Collection</Link>
              </li>
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link to={`/category/${c.slug}`}>{c.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Your account" className="site-drawer__nav site-drawer__nav--quiet">
            <ul>
              {user ? (
                <>
                  <li>
                    <Link to="/account">Account</Link>
                  </li>
                  <li>
                    <Link to="/orders">Orders</Link>
                  </li>
                  {user.role === "ADMIN" ? (
                    <li>
                      <Link to="/admin">Admin</Link>
                    </li>
                  ) : null}
                </>
              ) : (
                <li>
                  <Link to="/login">Sign in</Link>
                </li>
              )}
              <li>
                <Link to="/wishlist">Wishlist</Link>
              </li>
              <li>
                <Link to="/help">Help & information</Link>
              </li>
              {user ? (
                <li>
                  <button
                    type="button"
                    className="site-drawer__signout"
                    onClick={() => {
                      setDrawerOpen(false);
                      void logout();
                    }}
                  >
                    Sign out
                  </button>
                </li>
              ) : null}
            </ul>
          </nav>
        </div>
      </dialog>

      {/* Shared polite live regions: present before any change so every
          bag/wishlist update is announced. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="cart-announcer">
        {announcement}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="wishlist-announcer">
        {wishlistAnnouncement}
      </p>
      <MergeNotice />
      <div id="main" tabIndex={-1} className="site-main">
        <Outlet />
      </div>
      <Footer categories={categories} />
    </>
  );
}
