// HEYRAH web server (production). Zero dependencies: node:http only.
//
// The storefront is a React SPA (ARCHITECTURE §2). This server is the
// "serving layer" that keeps it crawlable without changing the stack:
//   • every HTML response is the built shell with route-specific <title>,
//     description, canonical, robots, Open Graph/Twitter tags and JSON-LD
//     injected server-side (from GET /api/v1/seo/meta — real catalog data),
//     plus a <noscript> summary with real links for crawlers that don't run JS;
//   • unknown/retired products and categories answer HTTP 404;
//   • /api/*, /assets/products/*, /sitemap.xml and /robots.txt are proxied to
//     the API, so the browser talks to one origin (cookies stay first-party);
//   • security headers (CSP, frame-ancestors, nosniff, referrer, permissions).
import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const PROXIED = [/^\/api\//, /^\/assets\/products\//, /^\/sitemap\.xml$/, /^\/robots\.txt$/];

const FALLBACK_META = {
  status: 200,
  title: "HEYRAH — Wings of Style",
  description:
    "HEYRAH — Wings of Style. Kurtas, dresses, outerwear, accessories and footwear, with honest pricing in INR and secure online checkout.",
  canonical: null,
  robots: "index, follow",
  ogType: "website",
  image: null,
  jsonLd: [],
  heading: "HEYRAH",
  summary: "",
  links: [],
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON for an inline data block: `<` escaped so content can't close the tag. */
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Build the <head> tags for a page. Exported for tests. */
export function headTags(meta) {
  const t = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta name="robots" content="${esc(meta.robots)}" />`,
  ];
  if (meta.canonical) t.push(`<link rel="canonical" href="${esc(meta.canonical)}" />`);
  t.push(
    `<meta property="og:site_name" content="HEYRAH" />`,
    `<meta property="og:type" content="${esc(meta.ogType)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
  );
  if (meta.canonical) t.push(`<meta property="og:url" content="${esc(meta.canonical)}" />`);
  if (meta.image) t.push(`<meta property="og:image" content="${esc(meta.image)}" />`);
  t.push(
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
  );
  for (const block of meta.jsonLd ?? []) {
    t.push(`<script type="application/ld+json">${jsonForScript(block)}</script>`);
  }
  return t.join("\n    ");
}

/** Plain HTML for visitors/crawlers without JavaScript. Exported for tests. */
export function noscriptBlock(meta) {
  const links = (meta.links ?? [])
    .map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`)
    .join("");
  return `<noscript><main class="noscript"><h1>${esc(meta.heading)}</h1>${
    meta.summary ? `<p>${esc(meta.summary)}</p>` : ""
  }${links ? `<ul>${links}</ul>` : ""}<p>Enable JavaScript to shop HEYRAH.</p></main></noscript>`;
}

/** Inject into the built shell between the markers in index.html. */
export function renderShell(html, meta) {
  return html
    .replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, `<!--seo:start-->\n    ${headTags(meta)}\n    <!--seo:end-->`)
    .replace("<!--app:noscript-->", noscriptBlock(meta));
}

export function securityHeaders(apiOrigin) {
  const connect = ["'self'"];
  if (apiOrigin) connect.push(apiOrigin);
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src ${connect.join(" ")}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/**
 * Canonical path rules: no trailing slash (except "/"), lowercase product
 * and category paths, single slashes. Returns the redirect target or null.
 */
export function canonicalRedirect(urlPath, search) {
  let p = urlPath.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (/^\/(product|category|products)(\/|$)/i.test(p)) p = p.toLowerCase();
  return p !== urlPath ? `${p || "/"}${search}` : null;
}

export function createWebServer({ dist, apiOrigin, browserApiOrigin = "", fetchImpl = fetch, metaTimeoutMs = 1500 }) {
  const shellPath = path.join(dist, "index.html");
  const shell = readFileSync(shellPath, "utf8");
  const api = new URL(apiOrigin);
  const sec = securityHeaders(browserApiOrigin);
  const distRoot = path.resolve(dist) + path.sep;

  async function meta(urlPathWithSearch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), metaTimeoutMs);
    try {
      const res = await fetchImpl(`${apiOrigin}/api/v1/seo/meta?path=${encodeURIComponent(urlPathWithSearch)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`meta ${res.status}`);
      return { ...FALLBACK_META, ...(await res.json()) };
    } catch {
      // The API is unreachable: serve the generic shell (never a broken page).
      return FALLBACK_META;
    } finally {
      clearTimeout(timer);
    }
  }

  function proxy(req, res) {
    const headers = { ...req.headers, host: api.host };
    const prior = req.headers["x-forwarded-for"];
    headers["x-forwarded-for"] = prior ? `${prior}, ${req.socket.remoteAddress}` : req.socket.remoteAddress;
    headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] ?? "http";
    const upstream = http.request(
      { hostname: api.hostname, port: api.port || 80, path: req.url, method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "bad_gateway", message: "The store is temporarily unavailable." } }));
    });
    req.pipe(upstream);
  }

  function staticFile(urlPath, res) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return false;
    }
    const file = path.resolve(dist, "." + rel);
    if (!file.startsWith(distRoot) || file === shellPath) return false;
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    res.writeHead(200, {
      ...sec,
      "Content-Type": type,
      // Hashed build output is immutable; anything else revalidates.
      "Cache-Control": rel.startsWith("/static/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    });
    createReadStream(file).pipe(res);
    return true;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === "/healthz-web") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (PROXIED.some((r) => r.test(url.pathname))) return proxy(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const redirect = canonicalRedirect(url.pathname, url.search);
    if (redirect) {
      res.writeHead(301, { Location: redirect });
      res.end();
      return;
    }
    if (path.extname(url.pathname) && staticFile(url.pathname, res)) return;

    const m = await meta(url.pathname + url.search);
    const html = renderShell(shell, m);
    res.writeHead(m.status === 404 ? 404 : 200, {
      ...sec,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      ...(m.robots.startsWith("noindex") ? { "X-Robots-Tag": m.robots } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : html);
  });
}

// Run when executed directly (node server/serve.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const port = Number(process.env.PORT ?? 8080);
  const server = createWebServer({
    dist: process.env.WEB_DIST ?? path.join(here, "..", "dist"),
    apiOrigin: process.env.API_ORIGIN ?? "http://localhost:4000",
    browserApiOrigin: process.env.BROWSER_API_ORIGIN ?? "",
  });
  server.listen(port, () => console.log(`[heyrah-web] serving on http://localhost:${port}`));
}
