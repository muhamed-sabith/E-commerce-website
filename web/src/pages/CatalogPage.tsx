import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { catalogApi } from "../api/catalog";
import type { CategorySummary, CatalogSort, ProductListResult } from "../api/catalog";
import { ProductCard } from "../components/ProductCard";
import { useHead } from "../lib/head";
import "./catalog.css";

const SORT_OPTIONS: { value: CatalogSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "name_asc", label: "Name: A to Z" },
  { value: "name_desc", label: "Name: Z to A" },
];

type LoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: ProductListResult };

/**
 * Catalog listing: search + category + price + availability filters,
 * numeric sort, pagination. Every state change lives in the URL
 * (REQUIREMENTS §6): shareable, bookmarkable, back-button safe.
 *
 * On a category landing (`/category/:slug`) that category is the page's
 * fixed scope: it is always sent to the API, the category facet is replaced
 * by a link back to the whole collection, and the canonical is the landing.
 */
export function CatalogPage({
  heading,
  categorySlug,
  categories: navCategories = [],
}: {
  heading?: string;
  categorySlug?: string;
  categories?: CategorySummary[];
}) {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();

  const q = params.get("q") ?? "";
  const queryCategories = params.getAll("category");
  const categories = categorySlug ? [categorySlug] : queryCategories;
  const minPrice = params.get("min_price") ?? "";
  const maxPrice = params.get("max_price") ?? "";
  const inStock = params.get("in_stock") === "true";
  const sortParam = params.get("sort") as CatalogSort | null;
  const page = Number(params.get("page") ?? "1") || 1;
  // When the shopper hasn't chosen, the server applies the store default and says which.
  const sort: CatalogSort = sortParam ?? ((state.kind === "ready" ? state.data.sort : "newest") as CatalogSort);

  const title = heading ?? "The Collection";
  useHead({
    title: q ? `Search: ${q} | HEYRAH` : `${title} | HEYRAH`,
    description: categorySlug
      ? `Shop ${title.toLowerCase()} at HEYRAH. Prices in INR.`
      : "Browse the full HEYRAH collection — kurtas, dresses, outerwear, accessories and footwear — priced in INR.",
    canonicalPath: categorySlug ? `/category/${categorySlug}` : "/products",
    robots: params.toString() ? "noindex, follow" : "index, follow",
  });

  const key = `${categorySlug ?? ""}|${params.toString()}`;
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    catalogApi
      .listProducts({
        q: q || undefined,
        category: categories.length ? categories : undefined,
        min_price: minPrice || undefined,
        max_price: maxPrice || undefined,
        in_stock: inStock || undefined,
        sort: sortParam ?? undefined,
        page,
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
    // `key` covers every URL input above.
  }, [key]);

  const updateParams = (mutate: (p: URLSearchParams) => void, keepPage = false) => {
    const next = new URLSearchParams(params);
    mutate(next);
    // Changing sort/filter/search resets the page (§7.3).
    if (!keepPage) next.delete("page");
    setParams(next);
  };

  const activeFilters =
    (categorySlug ? 0 : queryCategories.length) + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) + (inStock ? 1 : 0);
  const anyParams = params.toString().length > 0;

  return (
    <main className="catalog">
      <div className="catalog__inner">
        <div className="catalog__head">
          {categorySlug ? (
            <nav className="catalog__crumbs" aria-label="Breadcrumb">
              <Link to="/products">The Collection</Link>
              <span aria-hidden="true"> / </span>
              <span aria-current="page">{title}</span>
            </nav>
          ) : null}
          <h1 className="catalog__title">{title}</h1>
          {q ? (
            <p className="catalog__subtitle">
              Results for “{q}”.{" "}
              <Link to={categorySlug ? `/category/${categorySlug}` : "/products"} className="catalog__clear">
                Clear search
              </Link>
            </p>
          ) : null}
          {!categorySlug && navCategories.length > 0 ? (
            <nav className="catalog__chips" aria-label="Categories">
              {navCategories.map((c) => (
                <Link key={c.slug} to={`/category/${c.slug}`} className="catalog__chip">
                  {c.name}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>

        <div className="catalog__layout">
          <div className="catalog__filter-bar">
            <button
              type="button"
              className="catalog__filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls={filtersId}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </button>
          </div>
          <aside id={filtersId} className={filtersOpen ? "catalog__filters is-open" : "catalog__filters"} aria-label="Filters">
            {categorySlug ? (
              <FilterSection title="Category">
                <p className="catalog__scope">
                  Showing {title}. <Link to={`/products${q ? `?q=${encodeURIComponent(q)}` : ""}`}>Browse every category</Link>
                </p>
              </FilterSection>
            ) : (
              <FilterSection title="Category">
                <CategoryChecks
                  selected={queryCategories}
                  onToggle={(slug, checked) =>
                    updateParams((p) => {
                      const next = p.getAll("category").filter((s) => s !== slug);
                      p.delete("category");
                      for (const s of checked ? [...next, slug] : next) p.append("category", s);
                    })
                  }
                />
              </FilterSection>
            )}

            <FilterSection title="Price">
              <div className="catalog__price-row">
                <label>
                  Min ₹
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={minPrice}
                    onChange={(e) =>
                      updateParams((p) => {
                        if (e.target.value) p.set("min_price", e.target.value);
                        else p.delete("min_price");
                      })
                    }
                  />
                </label>
                <label>
                  Max ₹
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={maxPrice}
                    onChange={(e) =>
                      updateParams((p) => {
                        if (e.target.value) p.set("max_price", e.target.value);
                        else p.delete("max_price");
                      })
                    }
                  />
                </label>
              </div>
            </FilterSection>

            <FilterSection title="Availability">
              <label className="catalog__check">
                <input
                  type="checkbox"
                  checked={inStock}
                  onChange={(e) =>
                    updateParams((p) => {
                      if (e.target.checked) p.set("in_stock", "true");
                      else p.delete("in_stock");
                    })
                  }
                />
                In stock only
              </label>
            </FilterSection>

            {anyParams ? (
              <button type="button" className="catalog__reset" onClick={() => setParams(new URLSearchParams())}>
                Clear all filters
              </button>
            ) : null}
          </aside>

          <section className="catalog__results" aria-label="Products">
            <div className="catalog__toolbar">
              <p className="catalog__count" data-testid="result-count" aria-live="polite">
                {state.kind === "ready" ? `Showing ${state.data.items.length} of ${state.data.totalItems}` : ""}
              </p>
              <label className="catalog__sort">
                Sort
                <select value={sort} onChange={(e) => updateParams((p) => p.set("sort", e.target.value))}>
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {state.kind === "loading" ? <ProductGridSkeleton /> : null}
            {state.kind === "error" ? (
              <div className="catalog__state" role="alert">
                <p>The collection couldn't load. Check your connection and try again.</p>
                <button type="button" onClick={() => setParams(new URLSearchParams(params))}>
                  Try again
                </button>
              </div>
            ) : null}
            {state.kind === "ready" ? (
              state.data.items.length === 0 ? (
                <div className="catalog__state" data-testid="empty-state">
                  <p>{q ? `Nothing matches “${q}” with these filters.` : "No products match these filters."}</p>
                  <button type="button" onClick={() => setParams(new URLSearchParams())}>
                    Reset filters
                  </button>
                </div>
              ) : (
                <>
                  <div className="catalog__grid" data-testid="product-grid">
                    {state.data.items.map((p) => (
                      <ProductCard key={p.id} product={p} />
                    ))}
                  </div>
                  <Pagination
                    page={state.data.page}
                    totalPages={state.data.totalPages}
                    onPage={(n) =>
                      updateParams((p) => {
                        if (n > 1) p.set("page", String(n));
                        else p.delete("page");
                      }, true)
                    }
                  />
                </>
              )
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (n: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="catalog__pagination" aria-label="Pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="catalog__filter-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function CategoryChecks({ selected, onToggle }: { selected: string[]; onToggle: (slug: string, checked: boolean) => void }) {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    catalogApi
      .listCategories()
      .then((r) => {
        if (!cancelled) setCategories(r.items);
      })
      .catch(() => {
        /* filters stay empty; listing still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="catalog__checks">
      {categories.map((c) => (
        <label key={c.slug} className="catalog__check">
          <input type="checkbox" checked={selected.includes(c.slug)} onChange={(e) => onToggle(c.slug, e.target.checked)} />
          {c.name} <span className="catalog__check-count">({c.productCount})</span>
        </label>
      ))}
    </div>
  );
}

function ProductGridSkeleton() {
  return (
    <div className="catalog__grid" aria-hidden="true" data-testid="grid-skeleton">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="catalog__skeleton-card" />
      ))}
    </div>
  );
}
