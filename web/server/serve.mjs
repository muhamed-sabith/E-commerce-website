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
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
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

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt"]);
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;
const acceptsGzip = (req) => /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));

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

export function createWebServer({
  dist,
  apiOrigin,
  browserApiOrigin = "",
  fetchImpl = fetch,
  metaTimeoutMs = 1500,
  trustUpstreamProxy = false,
}) {
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

  function proxy(req, res, requestId) {
    const headers = { ...req.headers, host: api.host, "x-request-id": requestId };
    // Forwarding chain: by default this server is the edge, so a client-sent
    // X-Forwarded-For is discarded (it would let anyone spoof their IP past
    // the API's rate limits). Behind a TLS proxy/load balancer set
    // TRUST_UPSTREAM_PROXY=1 to keep the chain that proxy built.
    const prior = trustUpstreamProxy ? req.headers["x-forwarded-for"] : undefined;
    headers["x-forwarded-for"] = prior ? `${prior}, ${req.socket.remoteAddress}` : req.socket.remoteAddress;
    headers["x-forwarded-proto"] = (trustUpstreamProxy && req.headers["x-forwarded-proto"]) || "http";
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

  function staticFile(urlPath, req, res) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return false;
    }
    const file = path.resolve(dist, "." + rel);
    if (!file.startsWith(distRoot) || file === shellPath) return false;
    // Source maps are never served from production builds.
    if (file.endsWith(".map")) return false;
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    const ext = path.extname(file);
    const type = TYPES[ext] ?? "application/octet-stream";
    const headers = {
      ...sec,
      "Content-Type": type,
      // Hashed build output is immutable; anything else revalidates.
      "Cache-Control": rel.startsWith("/static/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      Vary: "Accept-Encoding",
    };
    if (COMPRESSIBLE.has(ext) && acceptsGzip(req)) {
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip" });
      res.end(req.method === "HEAD" ? undefined : gzipCached(file));
      return true;
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
    return true;
  }

  const gzipCache = new Map();
  function gzipCached(file) {
    let buf = gzipCache.get(file);
    if (!buf) {
      buf = gzipSync(readFileSync(file));
      gzipCache.set(file, buf);
    }
    return buf;
  }

  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://local");
    } catch {
      res.writeHead(400, { ...sec, "Content-Type": "text/plain" });
      res.end("Bad request");
      return;
    }
    const incoming = req.headers["x-request-id"];
    const requestId = trustUpstreamProxy && typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", requestId);
    if (url.pathname === "/healthz-web") {
      res.writeHead(200, { ...sec, "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("ok");
      return;
    }
    if (PROXIED.some((r) => r.test(url.pathname))) return proxy(req, res, requestId);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...sec, Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const redirect = canonicalRedirect(url.pathname, url.search);
    if (redirect) {
      res.writeHead(301, { ...sec, Location: redirect });
      res.end();
      return;
    }
    if (path.extname(url.pathname) && staticFile(url.pathname, req, res)) return;

    const m = await meta(url.pathname + url.search);
    const html = renderShell(shell, m);
    const gzip = acceptsGzip(req);
    res.writeHead(m.status === 404 ? 404 : 200, {
      ...sec,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      Vary: "Accept-Encoding",
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      ...(m.robots.startsWith("noindex") ? { "X-Robots-Tag": m.robots } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : gzip ? gzipSync(html) : html);
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
    trustUpstreamProxy: process.env.TRUST_UPSTREAM_PROXY === "1",
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;
  server.listen(port, () => console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", msg: "listening", service: "heyrah-web", port })));
  // Graceful stop: finish in-flight requests, then exit (bounded).
  const stop = (signal) => {
    console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", msg: "shutting down", service: "heyrah-web", signal }));
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
