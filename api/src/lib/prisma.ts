import { PrismaClient } from "@prisma/client";

/**
 * Single PrismaClient instance for the whole process (ARCHITECTURE §3).
 * Repositories use this client; nothing else touches the database directly.
 */
export const prisma = new PrismaClient();
