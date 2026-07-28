import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, Route, Routes, useLocation, useParams } from "react-router-dom";
import { catalogApi } from "./api/catalog";
import type { CategorySummary } from "./api/catalog";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { CartProvider } from "./cart/CartContext";
import { WishlistProvider } from "./wishlist/WishlistContext";
import { Header } from "./components/Header";
import { HomePage } from "./pages/HomePage";
import { CatalogPage } from "./pages/CatalogPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { PRIVATE_HEAD, useHead } from "./lib/head";
import "./styles/tokens.css";

/*
 * Code splitting: the public shopping path (home, catalog, product) ships in
 * the entry bundle; account, checkout, payment, help and the entire admin
 * module load on demand.
 */
const named = <T extends Record<string, unknown>>(load: () => Promise<T>, key: keyof T) =>
  lazy(async () => ({ default: (await load())[key] as React.ComponentType }));

const CartPage = named(() => import("./pages/CartPage"), "CartPage");
const WishlistPage = named(() => import("./pages/WishlistPage"), "WishlistPage");
const AddressesPage = named(() => import("./pages/AddressesPage"), "AddressesPage");
const CheckoutPage = named(() => import("./pages/CheckoutPage"), "CheckoutPage");
const DemoPaymentPage = named(() => import("./pages/DemoPaymentPage"), "DemoPaymentPage");
const OrdersPage = named(() => import("./pages/OrdersPage"), "OrdersPage");
const OrderDetailPage = named(() => import("./pages/OrdersPage"), "OrderDetailPage");
const LoginPage = named(() => import("./pages/LoginPage"), "LoginPage");
const RegisterPage = named(() => import("./pages/RegisterPage"), "RegisterPage");
const AccountPage = named(() => import("./pages/AccountPage"), "AccountPage");
const HelpPage = named(() => import("./pages/HelpPage"), "HelpPage");
const PolicyPage = lazy(async () => ({ default: (await import("./pages/PolicyPage")).PolicyPage }));
const AdminPagesPage = named(() => import("./admin/PagesPage"), "AdminPagesPage");

const AdminLayout = named(() => import("./admin/AdminLayout"), "AdminLayout");
const AdminDashboardPage = named(() => import("./admin/DashboardPage"), "AdminDashboardPage");
const AdminProductsPage = named(() => import("./admin/ProductsPage"), "AdminProductsPage");
const AdminProductNewPage = named(() => import("./admin/ProductEditPage"), "AdminProductNewPage");
const AdminProductEditPage = named(() => import("./admin/ProductEditPage"), "AdminProductEditPage");
const AdminCategoriesPage = named(() => import("./admin/CategoriesPage"), "AdminCategoriesPage");
const AdminInventoryPage = named(() => import("./admin/InventoryPage"), "AdminInventoryPage");
const AdminOrdersPage = named(() => import("./admin/OrdersPage"), "AdminOrdersPage");
const AdminOrderDetailPage = named(() => import("./admin/OrdersPage"), "AdminOrderDetailPage");
const AdminUsersPage = named(() => import("./admin/UsersPage"), "AdminUsersPage");
const AdminSettingsPage = named(() => import("./admin/SettingsPage"), "AdminSettingsPage");

function PageFallback() {
  return (
    <p className="page-loading" role="status">
      Loading…
    </p>
  );
}

/** Private, per-visitor pages: never indexed, no canonical. */
function Private({ title, children, protect = true }: { title: string; children: ReactNode; protect?: boolean }) {
  useHead(PRIVATE_HEAD(title));
  return protect ? <ProtectedRoute>{children}</ProtectedRoute> : <>{children}</>;
}

/**
 * Storefront + admin route trees. AuthProvider restores the session once at
 * load (server is the authority). Category data feeds the header, footer,
 * catalog shortcuts and category landings.
 */
export function App() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .listCategories()
      .then((r) => {
        if (!cancelled) setCategories(r.items);
      })
      .catch(() => {
        // Nav renders without category links; pages handle their own states.
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // New page → top of page (in-page #anchors keep their own scrolling).
  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {/* Admin tree: its own shell; the server authorizes every request. */}
              <Route path="/admin" element={<Private title="Admin" protect={false}><AdminLayout /></Private>}>
                <Route index element={<AdminDashboardPage />} />
                <Route path="products" element={<AdminProductsPage />} />
                <Route path="products/new" element={<AdminProductNewPage />} />
                <Route path="products/:id" element={<AdminProductEditPage />} />
                <Route path="categories" element={<AdminCategoriesPage />} />
                <Route path="inventory" element={<AdminInventoryPage />} />
                <Route path="orders" element={<AdminOrdersPage />} />
                <Route path="orders/:id" element={<AdminOrderDetailPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="pages" element={<AdminPagesPage />} />
                <Route path="*" element={<AdminNotFound />} />
              </Route>
              <Route element={<Header categories={categories} />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/products" element={<CatalogPage heading="The Collection" categories={categories} />} />
                <Route
                  path="/category/:slug"
                  element={<CategoryLanding categories={categories} loaded={categoriesLoaded} />}
                />
                <Route path="/product/:slug" element={<ProductDetailPage />} />
                <Route path="/help" element={<Suspended><HelpPage /></Suspended>} />
                <Route path="/privacy" element={<Suspended><PolicyPage slug="privacy" /></Suspended>} />
                <Route path="/terms" element={<Suspended><PolicyPage slug="terms" /></Suspended>} />
                <Route path="/returns" element={<Suspended><PolicyPage slug="returns" /></Suspended>} />
                <Route path="/shipping-policy" element={<Suspended><PolicyPage slug="shipping" /></Suspended>} />
                <Route path="/contact" element={<Suspended><PolicyPage slug="contact" /></Suspended>} />
                <Route path="/cart" element={<Private title="Your bag" protect={false}><Suspended><CartPage /></Suspended></Private>} />
                <Route path="/checkout" element={<Private title="Checkout"><Suspended><CheckoutPage /></Suspended></Private>} />
                <Route path="/payment/demo/:orderId" element={<Private title="Payment"><Suspended><DemoPaymentPage /></Suspended></Private>} />
                <Route path="/orders" element={<Private title="Your orders"><Suspended><OrdersPage /></Suspended></Private>} />
                <Route path="/orders/:orderId" element={<Private title="Order"><Suspended><OrderDetailPage /></Suspended></Private>} />
                <Route path="/wishlist" element={<Private title="Wishlist"><Suspended><WishlistPage /></Suspended></Private>} />
                <Route path="/account/addresses" element={<Private title="Addresses"><Suspended><AddressesPage /></Suspended></Private>} />
                <Route path="/login" element={<Private title="Sign in" protect={false}><Suspended><LoginPage /></Suspended></Private>} />
                <Route path="/register" element={<Private title="Create an account" protect={false}><Suspended><RegisterPage /></Suspended></Private>} />
                <Route path="/account" element={<Private title="Your account"><Suspended><AccountPage /></Suspended></Private>} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}

/** Lazy pages inside the storefront shell suspend here, so the header stays put. */
function Suspended({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

/**
 * Category landing = the catalog scoped to that category (§2.4). Unknown or
 * inactive slugs are a not-found page once the category list has loaded.
 */
function CategoryLanding({ categories, loaded }: { categories: CategorySummary[]; loaded: boolean }) {
  const { slug = "" } = useParams();
  const category = categories.find((c) => c.slug === slug);
  if (loaded && categories.length > 0 && !category) return <NotFoundPage />;
  return <CatalogPage key={slug} heading={category ? category.name : "Collection"} categorySlug={slug} />;
}

function AdminNotFound() {
  return (
    <div className="adm-page">
      <h1 className="adm-head__title">Page not found</h1>
      <p>
        <Link to="/admin">Back to the dashboard</Link>
      </p>
    </div>
  );
}

function NotFoundPage() {
  useHead({ title: "Page not found | HEYRAH", robots: "noindex, follow" });
  return (
    <main className="notfound">
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist or has moved.</p>
      <p className="notfound__links">
        <Link to="/products" className="notfound__cta">
          Browse the collection
        </Link>
        <Link to="/">Go to the homepage</Link>
      </p>
    </main>
  );
}
