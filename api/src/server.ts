import type { Server } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { ensureUploadRoot } from "./lib/storage.js";
import { configureLogger, log } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

/**
 * Process entry. Order matters:
 *   1. config/env.ts already validated the environment (exits on failure);
 *   2. the upload root must exist and be writable;
 *   3. the database must answer (bounded retries — containers start in any
 *      order) — otherwise exit non-zero with a clear message, never serve;
 *   4. listen; on SIGTERM/SIGINT stop accepting, let in-flight requests
 *      finish (bounded), disconnect Prisma, exit 0.
 * Migrations are NOT run here: deploys run `prisma migrate deploy` explicitly.
 */

configureLogger({ format: env.LOG_FORMAT ?? (env.NODE_ENV === "production" ? "json" : "pretty") });

const DB_ATTEMPTS = 10;
const DB_DELAY_MS = 2000;
const SHUTDOWN_GRACE_MS = 10_000;

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= DB_ATTEMPTS; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      log.warn("database not reachable yet", { attempt, of: DB_ATTEMPTS, err: (err as Error).message });
      if (attempt === DB_ATTEMPTS) throw new Error(`database unreachable after ${DB_ATTEMPTS} attempts`);
      await new Promise((r) => setTimeout(r, DB_DELAY_MS));
    }
  }
}

async function main() {
  await ensureUploadRoot();
  await waitForDatabase();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    log.info("listening", { port: env.PORT, env: env.NODE_ENV, paymentMode: env.PAYMENT_MODE });
  });
  // Slow-client protection; keep-alive just above typical proxy idle timeouts.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    const force = setTimeout(() => {
      log.error("shutdown grace period exceeded; exiting");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    server.close((err) => {
      server.closeIdleConnections?.();
      void prisma
        .$disconnect()
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(force);
          process.exit(err ? 1 : 0);
        });
    });
    server.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  log.error("unhandled promise rejection", { err: reason });
});

main().catch(async (err) => {
  log.error("startup failed", { err });
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
