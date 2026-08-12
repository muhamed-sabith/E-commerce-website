import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/logger.js";

/**
 * Attaches a request id to every request (REQUIREMENTS §14 observability):
 * `X-Request-Id` response header + one access-log line per request. An
 * upstream id (from the web server/proxy) is reused when it's a plain
 * token, so a request can be traced across both services.
 *
 * The access log records method, path (no query string — searches and
 * filters can contain personal text), status, duration and the request id.
 * Never headers, cookies, or bodies.
 */
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
  const started = process.hrtime.bigint();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    log.info("request", {
      requestId: id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
    });
  });
  next();
}
