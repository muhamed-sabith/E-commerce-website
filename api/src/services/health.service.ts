import { prisma } from "../lib/prisma.js";

export type DatabaseHealth = "up" | "down";

/**
 * Liveness of the PostgreSQL connection — a real roundtrip, not a flag,
 * bounded so a hung database can't hang the health check (the Docker
 * healthcheck times out at 3 s). Services own this logic (ARCHITECTURE §3).
 */
export async function checkDatabase(timeoutMs = 2000): Promise<DatabaseHealth> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("health check timed out")), timeoutMs);
      }),
    ]);
    return "up";
  } catch {
    return "down";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
