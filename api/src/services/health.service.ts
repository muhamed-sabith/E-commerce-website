import { prisma } from "../lib/prisma.js";

export type DatabaseHealth = "up" | "down";

/**
 * Liveness of the PostgreSQL connection — a real roundtrip, not a flag.
 * Services are the only layer that owns business logic (ARCHITECTURE §3);
 * this health check lives here for the same reason.
 */
export async function checkDatabase(): Promise<DatabaseHealth> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}
