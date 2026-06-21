import type { ErrorRequestHandler, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env.js";

/**
 * Typed application error — services throw this; the renderer maps it to
 * the contract's error envelope (docs/API_CONTRACT.md §6).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
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

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  void _next;
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: "Validation failed",
        details: err.issues,
      },
    });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error("[error] unhandled:", err);
  res.status(500).json({
    error: {
      code: "internal_error",
      message:
        env.NODE_ENV === "production"
          ? "Internal server error"
          : err instanceof Error
            ? err.message
            : String(err),
    },
  });
};
