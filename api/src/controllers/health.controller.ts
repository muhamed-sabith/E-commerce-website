import type { Request, Response } from "express";
import { checkDatabase } from "../services/health.service.js";

/**
 * GET /healthz — Express is running + PostgreSQL is reachable (§6/§8).
 * 200 + `database: "up"` when healthy, 503 + degraded otherwise, so the
 * Docker healthcheck can gate on it.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  const database = await checkDatabase();
  res.status(database === "up" ? 200 : 503).json({
    status: database === "up" ? "ok" : "degraded",
    service: "heyrah-api",
    database,
    timestamp: new Date().toISOString(),
  });
}
