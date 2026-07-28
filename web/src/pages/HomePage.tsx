import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { catalogApi, type CategorySummary, type ProductListItem } from "../api/catalog";
import { ProductCard } from "../components/ProductCard";
import { useHead } from "../lib/head";
import { formatINR } from "../lib/format";
import { useStore } from "../lib/store";
import "./home.css";

/**
 * Homepage. Every section is backed by real data or real capability:
 *   1. brand opening — the official lockup, the tagline, two real paths in;
 *   2. new in — the newest active products (sorted by created date);
 *   3. shop by category — live categories with live product counts and a
 *      cover image taken from that category's newest product;
 *   4. under ₹1,000 — a price-bounded edit, only shown when it has items;
 *   5. how HEYRAH works — facts the system enforces (server-side prices,
 *      configured shipping rule, order tracking, payment mode);
 *   6. a short brand note, clearly provisional until business copy exists.
 * No ratings, reviews, customer counts, or delivery promises.
 */

type Rail = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: ProductListItem[] };

interface CategoryTile extends CategorySummary {
  cover: { src: string; alt: string } | null;
}

export function HomePage() {
  useHead({
    title: "HEYRAH — Wings of Style",
    description:
      "HEYRAH — Wings of Style. Kurtas, dresses, outerwear, accessories and footwear, with honest pricing in INR and secure online checkout.",
    canonicalPath: "/",
  });
  const store = useStore();
  const [newIn, setNewIn] = useState<Rail>({ kind: "loading" });
  const [edit, setEdit] = useState<Rail>({ kind: "loading" });
  const [tiles, setTiles] = useState<CategoryTile[] | null>(null);

  useEffect(() => {
    let live = true;
    catalogApi
      .listProducts({ sort: "newest", in_stock: true, page_size: 8 })
      .then((r) => live && setNewIn({ kind: "ready", items: r.items }))
      .catch(() => live && setNewIn({ kind: "error" }));
    catalogApi
      .listProducts({ max_price: "1000", in_stock: true, sort: "price_desc", page_size: 12 })
      .then((r) => live && setEdit({ kind: "ready", items: r.items }))
      .catch(() => live && setEdit({ kind: "error" }));
    catalogApi
      .listCategories()
      .then(async (r) => {
        const withCovers = await Promise.all(
          r.items
            .filter((c) => c.productCount > 0)
            .map(async (c) => {
              const first = await catalogApi.listProducts({ category: [c.slug], sort: "newest", page_size: 1 }).catch(() => null);
              return { ...c, cover: first?.items[0]?.image ?? null };
            }),
        );
        if (live) setTiles(withCovers);
      })
      .catch(() => live && setTiles([]));
    return () => {
      live = false;
    };
  }, []);

  // The price edit shouldn't repeat what "New in" already shows.
  const newIds = new Set(newIn.kind === "ready" ? newIn.items.map((p) => p.id) : []);
  const editRail: Rail =
    edit.kind === "ready" ? { kind: "ready", items: edit.items.filter((p) => !newIds.has(p.id)).slice(0, 4) } : edit;

  return (
    <main className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__inner">
          <img src="/brand-lockup.webp" alt="" width="276" height="236" className="home-hero__lockup brand-art" fetchPriority="high" />
          <div className="home-hero__copy">
            <h1 id="home-title" className="home-hero__title">
              <span className="sr-only">HEYRAH. </span>Wings of Style
            </h1>
            <p className="home-hero__lede">
              Kurtas, dresses and outerwear with considered finishing, alongside the accessories and footwear that complete them.
            </p>
            <div className="home-hero__actions">
              <Link to="/products" className="home-btn home-btn--gold">
                Shop the collection
              </Link>
              <a href="#new-in" className="home-btn home-btn--ghost">
                See what's new
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" id="new-in" aria-labelledby="new-in-h" tabIndex={-1}>
        <div className="home-section__head">
          <h2 id="new-in-h">New in</h2>
          <Link to="/products?sort=newest" className="home-more">
            View all new pieces
          </Link>
        </div>
        <RailView rail={newIn} empty="New pieces will appear here as they arrive." testId="rail-new" />
      </section>

      {tiles === null || tiles.length > 0 ? (
        <section className="home-section home-section--tint" aria-labelledby="cats-h">
          <div className="home-section__head">
            <h2 id="cats-h">Shop by category</h2>
          </div>
          {tiles === null ? (
            <div className="home-cats" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="home-cat home-cat--skeleton" />
              ))}
            </div>
          ) : (
            <ul className="home-cats" data-testid="category-tiles">
              {tiles.map((c) => (
                <li key={c.slug}>
                  <Link to={`/category/${c.slug}`} className="home-cat">
                    <span className="home-cat__media">
                      {c.cover ? <img src={c.cover.src} alt="" loading="lazy" width="900" height="1200" /> : null}
                    </span>
                    <span className="home-cat__label">
                      <span className="home-cat__name">{c.name}</span>
                      <span className="home-cat__count">
                        {c.productCount} {c.productCount === 1 ? "piece" : "pieces"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {editRail.kind === "ready" && editRail.items.length === 0 ? null : (
        <section className="home-section" aria-labelledby="edit-h">
          <div className="home-section__head">
            <h2 id="edit-h">Under {formatINR("1000")}</h2>
            <Link to="/products?max_price=1000&sort=price_asc" className="home-more">
              Shop everything under {formatINR("1000")}
            </Link>
          </div>
          <RailView rail={editRail} empty="" testId="rail-edit" />
        </section>
      )}

      <section className="home-section home-trust" aria-labelledby="trust-h">
        <h2 id="trust-h" className="home-trust__title">
          How HEYRAH works
        </h2>
        <ul className="home-trust__list">
          <li>
            <h3>Prices you can trust</h3>
            <p>Every price, discount and total is calculated by our servers at checkout, and your order keeps exactly what you paid.</p>
          </li>
          <li>
            <h3>Shipping, stated plainly</h3>
            <p>
              {store
                ? Number(store.shipping.freeThreshold.amount) > 0
                  ? `${formatINR(store.shipping.flatRate.amount)} per order, free from ${formatINR(store.shipping.freeThreshold.amount)}. You see the shipping charge before you place an order.`
                  : "Shipping is free on every order. You see the full total before you place an order."
                : "You see the shipping charge and the full total before you place an order."}
            </p>
          </li>
          <li>
            <h3>Follow every order</h3>
            <p>Your account shows each order's status, from placed to delivered, with the address and items exactly as ordered.</p>
          </li>
          <li>
            <h3>Saved for later</h3>
            <p>Keep pieces in your wishlist with today's price and availability, and your bag stays with you when you sign in.</p>
          </li>
        </ul>
        <p className="home-trust__more">
          <Link to="/help">Ordering, payment and shipping, explained</Link>
        </p>
      </section>

      <section className="home-about" aria-labelledby="about-h">
        <div className="home-about__inner">
          <h2 id="about-h">About HEYRAH</h2>
          <p>
            HEYRAH is a women's fashion label built around one idea, Wings of Style: clothes that carry you lightly, made to be worn often and kept for
            years.
          </p>
          <p className="home-about__note">Our full story is being written. Until then, the collection speaks for itself.</p>
        </div>
      </section>
    </main>
  );
}

function RailView({ rail, empty, testId }: { rail: Rail; empty: string; testId: string }) {
  if (rail.kind === "loading") {
    return (
      <div className="home-rail" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="home-rail__skeleton" />
        ))}
      </div>
    );
  }
  if (rail.kind === "error") {
    return (
      <p className="home-rail__state" role="status">
        These pieces couldn't load. <Link to="/products">Browse the full collection</Link>
      </p>
    );
  }
  if (rail.items.length === 0) {
    return empty ? <p className="home-rail__state">{empty}</p> : null;
  }
  return (
    <div className="home-rail" data-testid={testId}>
      {rail.items.map((p) => (
        <ProductCard key={p.id} product={p} headingLevel={3} />
      ))}
    </div>
  );
}
