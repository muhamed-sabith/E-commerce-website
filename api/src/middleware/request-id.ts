import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Attaches a request id to every request (REQUIREMENTS §14 observability):
 * response header + structured log line, so support/debug can trace a call.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  res.on("finish", () => {
    console.log(`[${id}] ${req.method} ${req.originalUrl} → ${res.statusCode}`);
  });
  next();
}
