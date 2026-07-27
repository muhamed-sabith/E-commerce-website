import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import "./footer.css";

const POLICY_LINKS: { slug: "privacy" | "terms" | "returns" | "shipping" | "contact"; href: string; label: string }[] = [
  { slug: "contact", href: "/contact", label: "Contact us" },
  { slug: "shipping", href: "/shipping-policy", label: "Shipping policy" },
  { slug: "returns", href: "/returns", label: "Returns & refunds" },
  { slug: "privacy", href: "/privacy", label: "Privacy policy" },
  { slug: "terms", href: "/terms", label: "Terms of service" },
];

/**
 * Footer: shop, account and information links — every one a real route.
 * Policy and contact links appear only once the business has published that
 * page (admin → Pages); nothing points at an empty page.
 */
export function Footer({ categories }: { categories: { slug: string; name: string }[] }) {
  const store = useStore();
  const published = new Set(store?.pages ?? []);
  const policies = POLICY_LINKS.filter((p) => published.has(p.slug));

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <img src="/brand-lockup.webp" alt="HEYRAH, Wings of Style" width="276" height="236" className="site-footer__lockup brand-art" loading="lazy" />
        </div>
        <nav aria-label="Shop" className="site-footer__col">
          <h2>Shop</h2>
          <ul>
            <li>
              <Link to="/products">The Collection</Link>
            </li>
            <li>
              <Link to="/products?sort=newest">New in</Link>
            </li>
            {categories.map((c) => (
              <li key={c.slug}>
                <Link to={`/category/${c.slug}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account" className="site-footer__col">
          <h2>Account</h2>
          <ul>
            <li>
              <Link to="/account">Account</Link>
            </li>
            <li>
              <Link to="/orders">Orders</Link>
            </li>
            <li>
              <Link to="/wishlist">Wishlist</Link>
            </li>
            <li>
              <Link to="/cart">Bag</Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Information" className="site-footer__col">
          <h2>Information</h2>
          <ul>
            <li>
              <Link to="/help">Help & information</Link>
            </li>
            {policies.map((p) => (
              <li key={p.slug}>
                <Link to={p.href}>{p.label}</Link>
              </li>
            ))}
            <li>
              <Link to="/help#about">About HEYRAH</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="site-footer__base">
        <p>© {new Date().getFullYear()} HEYRAH. Prices in Indian rupees.</p>
      </div>
    </footer>
  );
}
