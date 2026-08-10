import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

/**
 * Admin bootstrap (REQUIREMENTS §11.5, §3.11): the only supported path for
 * creating ADMIN accounts in v1. Never exposed through the API — run from
 * the server operator's shell:
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npm run bootstrap:admin
 *
 * Idempotent: an existing row with the same email is promoted, never
 * duplicated. The password comes from the environment, never a prompt log.
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = (process.env.ADMIN_NAME ?? "HEYRAH Admin").trim();

  if (!email || !email.includes("@")) {
    console.error("[bootstrap:admin] ADMIN_EMAIL must be a valid email address");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("[bootstrap:admin] ADMIN_PASSWORD must be at least 10 characters");
    process.exit(1);
  }
  // Production admins need a real password: no template/example values.
  if (process.env.NODE_ENV === "production" && (password.length < 14 || /replace-me|change-me|example|password|admin/i.test(password))) {
    console.error("[bootstrap:admin] in production ADMIN_PASSWORD must be 14+ characters and not a template/example value");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", passwordHash, name },
    create: { email, passwordHash, name, role: "ADMIN" },
  });

  console.log(`[bootstrap:admin] ready: ${admin.email} (role ADMIN, id ${admin.id})`);
}

main()
  .catch((err) => {
    console.error("[bootstrap:admin] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
