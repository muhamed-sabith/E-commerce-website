import type { ErrorRequestHandler, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

/**
 * Typed application error — services throw this; the renderer maps it to
 * the contract's error envelope (docs/API_CONTRACT.md §6).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Optional machine-readable detail (e.g. which cart lines failed). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 404 falls in line with the envelope; unknown ids/slug never leak. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "unknown_resource", message: "Resource not found" },
  });
}

/** Database unreachable / connection-level failures (Prisma client + engine). */
function isDatabaseUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P1001 can't reach server, P1002 timeout, P1008 operation timeout, P1017 server closed connection, P2024 pool timeout
    return ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(err.code);
  }
  return false;
}

/** Zod issues without echoed input values (`received` can contain what was typed). */
function safeIssues(err: ZodError) {
  return err.issues.map((i) => {
    const { path, message, code } = i;
    return { path, message, code };
  });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  void _next;
  const requestId = res.locals.requestId as string | undefined;

  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "validation_failed", message: "Validation failed", details: safeIssues(err) } });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }
  // body-parser: malformed JSON / oversized body — client errors, not crashes.
  const status = (err as { status?: number; type?: string }).status;
  const type = (err as { type?: string }).type;
  if (status === 400 && type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "validation_failed", message: "The request body isn't valid JSON." } });
    return;
  }
  if (status === 413 && type === "entity.too.large") {
    res.status(413).json({ error: { code: "payload_too_large", message: "The request body is too large." } });
    return;
  }

  if (isDatabaseUnavailable(err)) {
    log.error("database unavailable", { requestId, method: req.method, path: req.originalUrl.split("?")[0], err });
    res.status(503).set("Retry-After", "5").json({
      error: { code: "service_unavailable", message: "The store is temporarily unavailable. Please try again shortly.", requestId },
    });
    return;
  }

  log.error("unhandled error", { requestId, method: req.method, path: req.originalUrl.split("?")[0], err });
  res.status(500).json({
    error: {
      code: "internal_error",
      // Production never exposes internals (no stack, SQL, or driver text).
      message: env.NODE_ENV === "production" ? "Something went wrong on our side. Please try again." : err instanceof Error ? err.message : String(err),
      ...(requestId ? { requestId } : {}),
    },
  });
};
