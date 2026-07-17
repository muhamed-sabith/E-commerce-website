import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { markNavigation } from "./ui";
import "./admin.css";

/**
 * Admin shell (REQUIREMENTS §3, DESIGN_SYSTEM §6). A dedicated layout, not
 * the storefront header: a teal sidebar with the wordmark, the operator's
 * identity and sign-out, and a light content area. On narrow screens the
 * sidebar collapses behind a menu button (focus moves into the menu, Escape
 * closes it and returns focus).
 *
 * The role check here is UX only: it avoids rendering admin chrome for a
 * customer. Every /api/v1/admin request is authorized server-side.
 */

const NAV = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/categories", label: "Categories" },
  { to: "/admin/inventory", label: "Inventory" },
  { to: "/admin/users", label: "Customers" },
  { to: "/admin/settings", label: "Settings" },
];

export function AdminLayout() {
  const { user, restoring, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close the mobile menu on navigation. Focus moves to the new page heading
  // when it mounts (PageHeader), which also covers pages that load first.
  useEffect(() => {
    setOpen(false);
    markNavigation();
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    navRef.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (restoring) {
    return (
      <main className="adm-gate">
        <p role="status">Checking your session…</p>
      </main>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== "ADMIN") {
    return (
      <main className="adm-gate">
        <h1>This area is for HEYRAH staff</h1>
        <p>Your account doesn't have access to the admin tools.</p>
        <Link to="/products" className="adm-btn adm-btn--primary">
          Back to the collection
        </Link>
      </main>
    );
  }

  return (
    <div className={open ? "adm adm--menu-open" : "adm"}>
      <a href="#adm-main" className="adm-skip">
        Skip to content
      </a>
      <aside className="adm-side">
        <div className="adm-side__top">
          <Link to="/admin" className="adm-side__brand" aria-label="HEYRAH admin, dashboard">
            HEYRAH
            <span className="adm-side__brand-sub">Admin</span>
          </Link>
          <button
            type="button"
            className="adm-side__toggle"
            aria-expanded={open}
            aria-controls="adm-nav"
            onClick={() => setOpen((o) => !o)}
            ref={toggleRef}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>

        <nav id="adm-nav" className="adm-side__nav" aria-label="Admin" ref={navRef}>
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={({ isActive }) => (isActive ? "adm-nav is-active" : "adm-nav")}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="adm-side__foot">
            <p className="adm-side__who">
              <span className="adm-side__name">{user.name}</span>
              <span className="adm-side__email">{user.email}</span>
            </p>
            <div className="adm-side__links">
              <Link to="/products" className="adm-side__link">
                View store
              </Link>
              <button
                type="button"
                className="adm-side__link"
                onClick={() => {
                  void logout().then(() => navigate("/login", { replace: true }));
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </nav>
      </aside>

      <main id="adm-main" className="adm-main">
        <Outlet />
      </main>
    </div>
  );
}
