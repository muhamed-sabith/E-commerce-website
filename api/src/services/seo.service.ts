import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { computeFinalPrice } from "./catalog.service.js";
import { PAGE_SLUGS, PAGE_TITLES, type PageSlug } from "./store-pages.service.js";

/**
 * Public SEO data (REQUIREMENTS §14, ARCHITECTURE §2): the facts a crawler
 * needs for a public route, built from real catalog rows only — title,
 * description, canonical URL, Open Graph image, JSON-LD — plus the sitemap
 * and robots.txt. The web server injects this into the HTML shell before
 * any JavaScript runs, so crawlers that don't execute JS still see it.
 *
 * Nothing private ever comes out of here: active products and active
 * categories only, no stock counts beyond in-stock/out-of-stock, no ids.
 */

export const SITE_NAME = "HEYRAH";
export const TAGLINE = "Wings of Style";

export function siteUrl(): string {
  return (env.PUBLIC_SITE_URL ?? env.API_ALLOWED_ORIGIN).replace(/\/+$/, "");
}

const abs = (p: string) => `${siteUrl()}${p.startsWith("/") ? p : `/${p}`}`;

/** Route kinds that must never be indexed (private or per-visitor). */
const PRIVATE_PREFIXES = ["/login", "/register", "/account", "/cart", "/checkout", "/payment", "/orders", "/wishlist", "/admin"];

export function isPrivatePath(p: string): boolean {
  return PRIVATE_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export interface PageMeta {
  status: 200 | 404;
  title: string;
  description: string;
  /** Absolute canonical URL, or null for pages that shouldn't have one (noindex). */
  canonical: string | null;
  robots: "index, follow" | "noindex, nofollow" | "noindex, follow";
  ogType: "website" | "product";
  image: string | null;
  jsonLd: object[];
  /** Plain-text fallback content for the shell's <noscript>/pre-render block. */
  heading: string;
  summary: string;
  links: { href: string; label: string }[];
}

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1).replace(/\s+\S*$/, "")}…`;
};

const DEFAULT_DESCRIPTION =
  "HEYRAH — Wings of Style. Kurtas, dresses, outerwear, accessories and footwear, with honest pricing in INR and secure online checkout.";

function base(over: Partial<PageMeta>): PageMeta {
  return {
    status: 200,
    title: `${SITE_NAME} — ${TAGLINE}`,
    description: DEFAULT_DESCRIPTION,
    canonical: null,
    robots: "index, follow",
    ogType: "website",
    image: null,
    jsonLd: [],
    heading: SITE_NAME,
    summary: "",
    links: [],
    ...over,
  };
}

function organization() {
  return { "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, slogan: TAGLINE, url: siteUrl() };
}

function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) })),
  };
}

async function activeCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, slug: true, updatedAt: true },
  });
}

/**
 * Meta for one path. `path` is the pathname only (query handled by the
 * caller: catalog filter/search/page variants canonicalize to their base).
 */
export async function metaForPath(rawPath: string, search: URLSearchParams = new URLSearchParams()): Promise<PageMeta> {
  const p = rawPath.replace(/\/+$/, "") || "/";

  if (isPrivatePath(p)) {
    return base({ robots: "noindex, nofollow", title: `${SITE_NAME}`, heading: SITE_NAME });
  }

  if (p === "/") {
    const cats = await activeCategories();
    return base({
      canonical: abs("/"),
      jsonLd: [organization(), { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: siteUrl() }],
      heading: `${SITE_NAME} — ${TAGLINE}`,
      summary: DEFAULT_DESCRIPTION,
      links: [{ href: "/products", label: "Shop the collection" }, ...cats.map((c) => ({ href: `/category/${c.slug}`, label: c.name }))],
    });
  }

  if (p === "/products") {
    // Search, filter, sort and pagination variants are useful to share but are
    // not separate documents: they canonicalize to /products and, when a search
    // or filter is applied, ask not to be indexed (followable, so products are
    // still discovered).
    const variant = ["q", "category", "min_price", "max_price", "in_stock", "sort", "page"].some((k) => search.has(k));
    const cats = await activeCategories();
    return base({
      title: `The Collection | ${SITE_NAME}`,
      description: "Browse the full HEYRAH collection — kurtas, dresses, outerwear, accessories and footwear — priced in INR.",
      canonical: abs("/products"),
      robots: variant ? "noindex, follow" : "index, follow",
      jsonLd: [breadcrumbs([{ name: "Home", path: "/" }, { name: "The Collection", path: "/products" }])],
      heading: "The Collection",
      links: cats.map((c) => ({ href: `/category/${c.slug}`, label: c.name })),
    });
  }

  if (p === "/help") {
    return base({
      title: `Help & information | ${SITE_NAME}`,
      description: "How ordering, payment, shipping, order tracking and your HEYRAH account work.",
      canonical: abs("/help"),
      heading: "Help & information",
    });
  }

  const info = /^\/(privacy|terms|returns|shipping-policy|contact)$/.exec(p);
  if (info) {
    const slug = (info[1] === "shipping-policy" ? "shipping" : info[1]) as PageSlug;
    const row = await prisma.storePage.findUnique({ where: { slug }, select: { body: true } });
    // Unpublished pages exist (honest "not published yet" state) but are not indexed.
    return base({
      title: `${PAGE_TITLES[slug]} | ${SITE_NAME}`,
      description: row ? clip(row.body, 155) : `${PAGE_TITLES[slug]} for HEYRAH.`,
      canonical: row ? abs(p) : null,
      robots: row ? "index, follow" : "noindex, follow",
      heading: PAGE_TITLES[slug],
      summary: row ? clip(row.body, 300) : "",
    });
  }

  const cat = /^\/category\/([a-z0-9-]{1,90})$/.exec(p);
  if (cat) {
    const c = await prisma.category.findFirst({ where: { slug: cat[1], isActive: true }, select: { name: true, slug: true } });
    if (!c) return notFound();
    const products = await prisma.product.findMany({
      where: { category: { slug: c.slug }, status: "active" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 24,
      select: { name: true, slug: true },
    });
    const variant = search.has("page") || search.has("sort");
    return base({
      title: `${c.name} | ${SITE_NAME}`,
      description: clip(`Shop ${c.name.toLowerCase()} at HEYRAH — ${products.slice(0, 3).map((x) => x.name).join(", ")}${products.length > 3 ? " and more" : ""}. Prices in INR.`, 160),
      canonical: abs(`/category/${c.slug}`),
      robots: variant ? "noindex, follow" : "index, follow",
      jsonLd: [breadcrumbs([{ name: "Home", path: "/" }, { name: "The Collection", path: "/products" }, { name: c.name, path: `/category/${c.slug}` }])],
      heading: c.name,
      links: products.map((x) => ({ href: `/product/${x.slug}`, label: x.name })),
    });
  }

  const prod = /^\/product\/([a-z0-9-]{1,140})$/.exec(p);
  if (prod) {
    const row = await prisma.product.findFirst({
      where: { slug: prod[1], status: "active", category: { isActive: true } },
      include: {
        category: { select: { name: true, slug: true } },
        images: { orderBy: { position: "asc" }, select: { filePath: true } },
      },
    });
    if (!row) return notFound();
    const final = computeFinalPrice(row.price, row.discountType, row.discountValue).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const images = row.images.map((i) => abs(`/assets/${i.filePath}`));
    const inStock = row.stockQuantity > 0;
    const url = abs(`/product/${row.slug}`);
    const desc = clip(row.description, 155);
    return base({
      title: `${row.name} | ${SITE_NAME}`,
      description: desc,
      canonical: url,
      ogType: "product",
      image: images[0] ?? null,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: row.name,
          description: clip(row.description, 500),
          sku: row.sku,
          ...(images.length ? { image: images } : {}),
          category: row.category.name,
          brand: { "@type": "Brand", name: SITE_NAME },
          offers: {
            "@type": "Offer",
            url,
            priceCurrency: "INR",
            price: final.toFixed(2),
            availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            // No itemCondition: product condition isn't recorded in verified product data.
          },
        },
        breadcrumbs([
          { name: "Home", path: "/" },
          { name: row.category.name, path: `/category/${row.category.slug}` },
          { name: row.name, path: `/product/${row.slug}` },
        ]),
      ],
      heading: row.name,
      summary: `${row.category.name} · ₹${Number(final).toLocaleString("en-IN", { minimumFractionDigits: 2 })} · ${inStock ? "In stock" : "Out of stock"}. ${clip(row.description, 300)}`,
      links: [{ href: `/category/${row.category.slug}`, label: `More ${row.category.name}` }],
    });
  }

  return notFound();
}

function notFound(): PageMeta {
  return base({
    status: 404,
    title: `Page not found | ${SITE_NAME}`,
    description: "This page doesn't exist. Browse the HEYRAH collection instead.",
    robots: "noindex, follow",
    heading: "Page not found",
    links: [{ href: "/products", label: "Browse the collection" }],
  });
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Public, canonical URLs only: home, collection, help, active categories, active products. */
export async function sitemapXml(): Promise<string> {
  const [cats, products, pages] = await Promise.all([
    activeCategories(),
    prisma.product.findMany({
      where: { status: "active", category: { isActive: true } },
      orderBy: { id: "asc" },
      select: { slug: true, updatedAt: true },
    }),
    prisma.storePage.findMany({ select: { slug: true, updatedAt: true } }),
  ]);
  const pagePath = (s: string) => (s === "shipping" ? "/shipping-policy" : `/${s}`);
  const urls: { loc: string; lastmod?: Date }[] = [
    { loc: abs("/") },
    { loc: abs("/products") },
    { loc: abs("/help") },
    ...pages
      .filter((pg) => (PAGE_SLUGS as readonly string[]).includes(pg.slug))
      .map((pg) => ({ loc: abs(pagePath(pg.slug)), lastmod: pg.updatedAt })),
    ...cats.map((c) => ({ loc: abs(`/category/${c.slug}`), lastmod: c.updatedAt })),
    ...products.map((p) => ({ loc: abs(`/product/${p.slug}`), lastmod: p.updatedAt })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`)
  .join("\n")}
</urlset>
`;
}

export function robotsTxt(): string {
  return `User-agent: *
${PRIVATE_PREFIXES.map((p) => `Disallow: ${p}`).join("\n")}
Disallow: /api/

Sitemap: ${abs("/sitemap.xml")}
`;
}
