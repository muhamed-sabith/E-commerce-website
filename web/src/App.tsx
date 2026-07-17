import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useParams } from "react-router-dom";
import { catalogApi } from "./api/catalog";
import type { CategorySummary } from "./api/catalog";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { CartProvider } from "./cart/CartContext";
import { CartPage } from "./pages/CartPage";
import { WishlistProvider } from "./wishlist/WishlistContext";
import { WishlistPage } from "./pages/WishlistPage";
import { AddressesPage } from "./pages/AddressesPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { DemoPaymentPage } from "./pages/DemoPaymentPage";
import { OrderDetailPage, OrdersPage } from "./pages/OrdersPage";
import { Header } from "./components/Header";
import { CatalogPage } from "./pages/CatalogPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AccountPage } from "./pages/AccountPage";
import { AdminLayout } from "./admin/AdminLayout";
import { AdminDashboardPage } from "./admin/DashboardPage";
import { AdminProductsPage } from "./admin/ProductsPage";
import { AdminProductEditPage, AdminProductNewPage } from "./admin/ProductEditPage";
import { AdminCategoriesPage } from "./admin/CategoriesPage";
import { AdminInventoryPage } from "./admin/InventoryPage";
import { AdminOrderDetailPage, AdminOrdersPage } from "./admin/OrdersPage";
import { AdminUsersPage } from "./admin/UsersPage";
import { AdminSettingsPage } from "./admin/SettingsPage";
import "./styles/tokens.css";

/**
 * Storefront shell — routes + brand header fed by the live category API.
 * AuthProvider restores the session once at load (server is the authority).
 */
export function App() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .listCategories()
      .then((r) => {
        if (!cancelled) setCategories(r.items);
      })
      .catch(() => {
        // Nav simply renders without category links; pages handle their
        // own loading/error states.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll to top on navigation — small thing, big premium feel.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <AuthProvider>
      <CartProvider>
      <WishlistProvider>
      <Routes>
        {/* Admin tree: its own shell; the server authorizes every request. */}
        <Route path="/admin" element={<AdminLayout />}>
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
          <Route path="*" element={<AdminNotFound />} />
        </Route>
        <Route element={<Header categories={categories} />}>
          <Route path="/" element={<CatalogPage heading="The Collection" />} />
          <Route path="/products" element={<CatalogPage heading="The Collection" />} />
          <Route
            path="/category/:slug"
            element={
              <CategoryLandingWrapper categories={categories} />
            }
          />
          <Route path="/product/:slug" element={<ProductDetailPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route
            path="/checkout"
            element={
              <ProtectedRoute>
                <CheckoutPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payment/demo/:orderId"
            element={
              <ProtectedRoute>
                <DemoPaymentPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute>
                <OrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <ProtectedRoute>
                <OrderDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wishlist"
            element={
              <ProtectedRoute>
                <WishlistPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account/addresses"
            element={
              <ProtectedRoute>
                <AddressesPage />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}

/** Category landing = catalog pre-filtered by that category (§2.4). */
function CategoryLandingWrapper({ categories }: { categories: CategorySummary[] }) {
  const { slug } = useParams();
  const category = categories.find((c) => c.slug === slug);
  return <CatalogPage key={slug} heading={category ? category.name : "Collection"} />;
}

function AdminNotFound() {
  return (
    <div className="adm-page">
      <h1 className="adm-head__title">Page not found</h1>
      <p>
        <a href="/admin">Back to the dashboard</a>
      </p>
    </div>
  );
}

function NotFoundPage() {
  return (
    <main className="notfound">
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <a href="/products">Back to the collection</a>
    </main>
  );
}
