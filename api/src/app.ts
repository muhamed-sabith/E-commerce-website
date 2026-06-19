import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { requestId } from "./middleware/request-id.js";
import { healthRouter } from "./routes/health.routes.js";
import { v1Router } from "./routes/index.js";

/**
 * Application factory — exported without listen() so tests (and future
 * tooling) can drive the same stack the server runs.
 */
export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");

  app.use(requestId);
  // Cookie-bearing CORS: exactly the web origin, nothing wildcarded.
  app.use(cors({ origin: env.API_ALLOWED_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  // Cookie foundation for server-side sessions (config in config/session.ts;
  // session middleware + auth routes land in the authentication phase).
  app.use(cookieParser());

  app.use(healthRouter);
  app.use("/api/v1", v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
