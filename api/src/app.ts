import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env, trustProxyHops } from "./config/env.js";
import { UPLOAD_ROOT } from "./lib/images.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { requestId } from "./middleware/request-id.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { healthRouter } from "./routes/health.routes.js";
import { createV1Router } from "./routes/index.js";
import { rootSeoRouter } from "./routes/site.routes.js";
import type { PaymentService } from "./services/payment.service.js";

/**
 * Application factory — exported without listen() so tests (and future
 * tooling) can drive the same stack the server runs.
 */
/**
 * `options.payments` lets tests build the same stack in a specific payment
 * mode; the server always uses the environment-configured service.
 */
export function createApp(options: { payments?: PaymentService } = {}): express.Express {
  const app = express();

  app.disable("x-powered-by");

  // Trust exactly TRUST_PROXY_HOPS reverse proxies for req.ip (compose: 1,
  // the web server) so rate limiters key on the real client. Never `true`:
  // that would honour any client-supplied X-Forwarded-For.
  app.set("trust proxy", trustProxyHops);

  app.use(requestId);
  app.use(securityHeaders);
  // Cookie-bearing CORS: exactly the web origin, nothing wildcarded.
  app.use(cors({ origin: env.API_ALLOWED_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  // Cookie foundation for server-side sessions (options in config/session.ts;
  // session store in lib/session.ts, identity in middleware/auth.ts).
  app.use(cookieParser());

  // Admin-uploaded product images (re-encoded WebP, generated names). Read
  // only, no directory listing, no dotfiles; nosniff + a deny-all CSP so a
  // stored file can never execute as a document.
  app.use(
    "/assets/products",
    express.static(path.join(UPLOAD_ROOT, "products"), {
      dotfiles: "deny",
      index: false,
      redirect: false,
      fallthrough: true,
      maxAge: "7d",
      immutable: true,
      setHeaders(res) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      },
    }),
  );

  app.use(healthRouter);
  app.use(rootSeoRouter);
  app.use("/api/v1", createV1Router(options.payments));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
