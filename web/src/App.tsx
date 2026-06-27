import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useParams } from "react-router-dom";
import { catalogApi } from "./api/catalog";
import type { CategorySummary } from "./api/catalog";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { CartProvider } from "./cart/CartContext";
import { CartPage } from "./pages/CartPage";
import { Header } from "./components/Header";
import { CatalogPage } from "./pages/CatalogPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AccountPage } from "./pages/AccountPage";
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
      <Routes>
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

function NotFoundPage() {
  return (
    <main className="notfound">
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <a href="/products">Back to the collection</a>
    </main>
  );
}
