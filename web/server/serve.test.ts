// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { canonicalRedirect, createWebServer, headTags, noscriptBlock, renderShell } from "./serve.mjs";

/**
 * Production web server: meta injection, 404 status, canonical redirects,
 * security headers, static files, and the API proxy — exercised over real
 * HTTP against a fake API.
 */

const SHELL = `<!doctype html><html><head><!--seo:start--><title>x</title><!--seo:end--></head><body><div id="root"></div><!--app:noscript--></body></html>`;

const product = {
  status: 200,
  title: `Silk "Slip" <Dress> | HEYRAH`,
  description: "Bias-cut silk & more",
  canonical: "https://heyrah.example/product/silk-slip-dress",
  robots: "index, follow",
  ogType: "product",
  image: "https://heyrah.example/assets/products/seed/a.webp",
  jsonLd: [{ "@type": "Product", name: "</script><script>alert(1)</script>" }],
  heading: "Silk Slip Dress",
  summary: "Dresses, ₹4,590.00, in stock.",
  links: [{ href: "/category/dresses", label: "More Dresses" }],
};

let api: http.Server;
let web: http.Server;
let base = "";
let apiHits: string[] = [];

beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "heyrah-web-"));
  writeFileSync(path.join(dist, "index.html"), SHELL);
  mkdirSync(path.join(dist, "static"));
  writeFileSync(path.join(dist, "static", "app-abc.js"), "console.log(1)");
  writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");

  api = http.createServer((req, res) => {
    apiHits.push(`${req.method} ${req.url}`);
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/v1/seo/meta") {
      const p = url.searchParams.get("path") ?? "/";
      res.setHeader("Content-Type", "application/json");
      if (p.startsWith("/product/silk")) return res.end(JSON.stringify(product));
      if (p.startsWith("/cart")) return res.end(JSON.stringify({ ...product, robots: "noindex, nofollow", canonical: null, jsonLd: [] }));
      return res.end(JSON.stringify({ status: 404, title: "Page not found | HEYRAH", description: "d", canonical: null, robots: "noindex, follow", ogType: "website", image: null, jsonLd: [], heading: "Page not found", summary: "", links: [] }));
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Set-Cookie", "heyrah_session=abc; HttpOnly");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () =>
      res.end(JSON.stringify({ proxied: req.url, method: req.method, body, fwd: req.headers["x-forwarded-for"] ?? null, rid: req.headers["x-request-id"] ?? null })),
    );
  });
  await new Promise<void>((r) => api.listen(0, r));
  const apiPort = (api.address() as { port: number }).port;

  writeFileSync(path.join(dist, "static", "app-abc.js.map"), "{}");
  web = createWebServer({ dist, apiOrigin: `http://127.0.0.1:${apiPort}` });
  await new Promise<void>((r) => web.listen(0, r));
  base = `http://127.0.0.1:${(web.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise((r) => web.close(r));
  await new Promise((r) => api.close(r));
});

describe("head + noscript rendering", () => {
  it("escapes values and neutralises </script> inside JSON-LD", () => {
    const tags = headTags(product);
    expect(tags).toContain("<title>Silk &quot;Slip&quot; &lt;Dress&gt; | HEYRAH</title>");
    expect(tags).toContain('<link rel="canonical" href="https://heyrah.example/product/silk-slip-dress" />');
    expect(tags).toContain('<meta property="og:type" content="product" />');
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(tags).not.toContain("</script><script>");
    expect(tags).toContain("\\u003c/script>");
    expect(noscriptBlock(product)).toContain('<a href="/category/dresses">More Dresses</a>');
  });

  it("omits canonical and og:url when the page has none", () => {
    const tags = headTags({ ...product, canonical: null, image: null });
    expect(tags).not.toContain("canonical");
    expect(tags).not.toContain("og:url");
    expect(tags).toContain('content="summary"');
  });

  it("replaces only the marked region", () => {
    const out = renderShell(SHELL, product);
    expect(out).not.toContain("<title>x</title>");
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain("<noscript>");
  });
});

describe("canonical redirects", () => {
  it("normalises trailing slashes, double slashes, and casing on catalog paths", () => {
    expect(canonicalRedirect("/products/", "")).toBe("/products");
    expect(canonicalRedirect("/Product/Silk-Slip-Dress", "?a=1")).toBe("/product/silk-slip-dress?a=1");
    expect(canonicalRedirect("//category//dresses", "")).toBe("/category/dresses");
    expect(canonicalRedirect("/", "")).toBeNull();
    expect(canonicalRedirect("/product/silk-slip-dress", "")).toBeNull();
  });
});

describe("HTTP behaviour", () => {
  it("serves product pages with injected meta, 200, and security headers", async () => {
    const res = await fetch(`${base}/product/silk-slip-dress`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<link rel="canonical" href="https://heyrah.example/product/silk-slip-dress" />');
    expect(html).toContain('"@type":"Product"');
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("answers 404 for unknown pages, with noindex", async () => {
    const res = await fetch(`${base}/product/gone`);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, follow");
    expect(await res.text()).toContain("Page not found | HEYRAH");
  });

  it("private pages get X-Robots-Tag noindex", async () => {
    const res = await fetch(`${base}/cart`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("redirects non-canonical variants with 301", async () => {
    const res = await fetch(`${base}/products/?q=linen`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/products?q=linen");
  });

  it("serves hashed static files as immutable and blocks path traversal", async () => {
    const js = await fetch(`${base}/static/app-abc.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(js.headers.get("content-type")).toContain("text/javascript");
    const trav = await fetch(`${base}/static/..%2f..%2f..%2fetc%2fpasswd`);
    expect(trav.headers.get("content-type")).toContain("text/html");
  });

  it("proxies the API (method, body, cookies, forwarded-for), images, sitemap, robots", async () => {
    apiHits = [];
    const post = await fetch(`${base}/api/v1/cart/items`, { method: "POST", body: '{"qty":1}', headers: { "Content-Type": "application/json" } });
    const body = await post.json();
    expect(body).toMatchObject({ proxied: "/api/v1/cart/items", method: "POST", body: '{"qty":1}' });
    expect(body.fwd).toBeTruthy();
    expect(post.headers.get("set-cookie")).toContain("heyrah_session=abc");
    for (const p of ["/assets/products/seed/a.webp", "/sitemap.xml", "/robots.txt"]) {
      await fetch(`${base}${p}`);
    }
    expect(apiHits).toEqual(["POST /api/v1/cart/items", "GET /assets/products/seed/a.webp", "GET /sitemap.xml", "GET /robots.txt"]);
  });

  it("drops client-supplied X-Forwarded-For (edge mode) and forwards a request id", async () => {
    const res = await fetch(`${base}/api/v1/whoami`, { headers: { "X-Forwarded-For": "6.6.6.6" } });
    const body = await res.json();
    expect(body.fwd).not.toContain("6.6.6.6");
    expect(body.rid).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-request-id")).toBe(body.rid);
  });

  it("gzips HTML and static assets when asked, never serves source maps", async () => {
    const html = await fetch(`${base}/product/silk-slip-dress`, { headers: { "Accept-Encoding": "gzip" } });
    expect(html.headers.get("content-encoding")).toBe("gzip");
    expect(await html.text()).toContain("<title>"); // fetch decompresses transparently
    const js = await fetch(`${base}/static/app-abc.js`, { headers: { "Accept-Encoding": "gzip" } });
    expect(js.headers.get("content-encoding")).toBe("gzip");
    expect(js.headers.get("vary")).toBe("Accept-Encoding");
    const map = await fetch(`${base}/static/app-abc.js.map`);
    expect(map.headers.get("content-type")).toContain("text/html");
    expect(await map.text()).not.toBe("{}");
  });

  it("health and non-page responses carry security headers", async () => {
    const h = await fetch(`${base}/healthz-web`);
    expect(await h.text()).toBe("ok");
    expect(h.headers.get("x-content-type-options")).toBe("nosniff");
    expect(h.headers.get("cache-control")).toBe("no-store");
    const post = await fetch(`${base}/products`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("x-frame-options")).toBe("DENY");
  });

  it("falls back to the generic shell if the API is down", async () => {
    const dist = mkdtempSync(path.join(tmpdir(), "heyrah-web-"));
    writeFileSync(path.join(dist, "index.html"), SHELL);
    const lonely = createWebServer({ dist, apiOrigin: "http://127.0.0.1:1", metaTimeoutMs: 300 });
    await new Promise<void>((r) => lonely.listen(0, r));
    const port = (lonely.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/products`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>HEYRAH — Wings of Style</title>");
    await new Promise((r) => lonely.close(r));
  });
});
