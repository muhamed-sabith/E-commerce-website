import { useMemo } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import "./header.css";

/**
 * Storefront shell: brand header with category navigation + search,
 * routed content below. Category links come from the live API; the account
 * control reflects the session state (server-restored, never guessed).
 */
export function Header({ categories }: { categories: { slug: string; name: string }[] }) {
  const { user, restoring, logout } = useAuth();

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
          </nav>
        </div>
      </header>
      <Outlet />
    </>
  );
}

export function useCategoryLinks(activeCategories: { slug: string; name: string }[]) {
  return useMemo(() => activeCategories, [activeCategories]);
}
