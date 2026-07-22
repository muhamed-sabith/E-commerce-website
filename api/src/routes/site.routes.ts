import { Router, type Request, type Response, type NextFunction } from "express";
import { metaForPath, robotsTxt, sitemapXml } from "../services/seo.service.js";
import { getSettings } from "../services/settings.service.js";
import { paymentService } from "../services/payment.service.js";
import { parseSlug, storePageService } from "../services/store-pages.service.js";

/**
 * Public, read-only site data.
 *   GET /api/v1/store         — facts the storefront may state (shipping rule, payment mode, brand)
 *   GET /api/v1/seo/meta?path= — per-route meta + JSON-LD for the web server's HTML injection
 *   GET /sitemap.xml, /robots.txt — mounted at the root by app.ts
 * Everything here is derived from real rows/config; no claims are invented.
 */

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function createSiteRouter(payments = paymentService): Router {
  const r = Router();

  r.get(
    "/store",
    wrap(async (_req, res) => {
      const s = await getSettings();
      res.set("Cache-Control", "public, max-age=60");
      res.json({
        brand: { name: "HEYRAH", tagline: "Wings of Style" },
        currency: "INR",
        shipping: { flatRate: { amount: s.shippingFlatRate.toFixed(2) }, freeThreshold: { amount: s.shippingFreeThreshold.toFixed(2) } },
        paymentMode: payments.mode,
        pages: await storePageService.publishedSlugs(),
      });
    }),
  );

  r.get(
    "/pages/:slug",
    wrap(async (req, res) => {
      res.set("Cache-Control", "public, max-age=60");
      res.json({ page: await storePageService.get(parseSlug(req.params.slug)) });
    }),
  );

  r.get(
    "/seo/meta",
    wrap(async (req, res) => {
      const raw = typeof req.query.path === "string" ? req.query.path : "/";
      // Only a same-site path is accepted; anything else is treated as "/".
      let url: URL;
      try {
        url = new URL(raw.startsWith("/") ? raw : "/", "http://local");
      } catch {
        url = new URL("/", "http://local");
      }
      const meta = await metaForPath(url.pathname.slice(0, 300), url.searchParams);
      res.set("Cache-Control", "public, max-age=60");
      res.json(meta);
    }),
  );

  return r;
}

export const rootSeoRouter = Router();
rootSeoRouter.get(
  "/sitemap.xml",
  wrap(async (_req, res) => {
    res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(await sitemapXml());
  }),
);
rootSeoRouter.get("/robots.txt", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(robotsTxt());
});
