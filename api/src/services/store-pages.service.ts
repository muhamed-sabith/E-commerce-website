import { z } from "zod";
import { recordAdminAction } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../middleware/error.js";

/**
 * Policy and contact pages (launch blockers). The text is the business's
 * to write — this service never supplies any. Each page is unpublished
 * until an admin saves it; the storefront then shows it verbatim as plain
 * paragraphs (escaped by React; no HTML is accepted or rendered).
 */

export const PAGE_SLUGS = ["privacy", "terms", "returns", "shipping", "contact"] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

export const PAGE_TITLES: Record<PageSlug, string> = {
  privacy: "Privacy policy",
  terms: "Terms of service",
  returns: "Returns & refunds",
  shipping: "Shipping policy",
  contact: "Contact us",
};

export function parseSlug(raw: unknown): PageSlug {
  if (typeof raw === "string" && (PAGE_SLUGS as readonly string[]).includes(raw)) return raw as PageSlug;
  throw new ApiError(404, "unknown_resource", "Page not found");
}

export const pageUpdateSchema = z
  .object({
    body: z
      .string({ required_error: "Write the page text", invalid_type_error: "Write the page text" })
      .transform((s) => s.replace(/\r\n/g, "\n").trim())
      .pipe(
        z
          .string()
          .min(20, "Write at least a couple of sentences")
          .max(20_000, "Keep it under 20,000 characters")
          // eslint-disable-next-line no-control-regex
          .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), "The text contains invalid characters"),
      ),
  })
  .strict();

function view(slug: PageSlug, row: { body: string; updatedAt: Date } | null) {
  return {
    slug,
    title: PAGE_TITLES[slug],
    published: row !== null,
    body: row?.body ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export const storePageService = {
  /** Public: one page (published or not — the UI says which). */
  async get(slug: PageSlug) {
    const row = await prisma.storePage.findUnique({ where: { slug }, select: { body: true, updatedAt: true } });
    return view(slug, row);
  },

  /** Public: which pages exist, for footer/sitemap. */
  async publishedSlugs(): Promise<PageSlug[]> {
    const rows = await prisma.storePage.findMany({ select: { slug: true } });
    const set = new Set(rows.map((r) => r.slug));
    return PAGE_SLUGS.filter((s) => set.has(s));
  },

  async list() {
    const rows = await prisma.storePage.findMany({ select: { slug: true, body: true, updatedAt: true } });
    const by = new Map(rows.map((r) => [r.slug, r]));
    return { items: PAGE_SLUGS.map((s) => view(s, by.get(s) ?? null)) };
  },

  async save(actorId: bigint, slug: PageSlug, body: string) {
    await prisma.$transaction(async (tx) => {
      await tx.storePage.upsert({
        where: { slug },
        create: { slug, title: PAGE_TITLES[slug], body, updatedBy: actorId },
        update: { body, updatedBy: actorId },
      });
      await recordAdminAction(tx, { actorId, action: "page.update", targetType: "page", targetId: slug, details: { length: body.length } });
    });
    return this.get(slug);
  },

  async unpublish(actorId: bigint, slug: PageSlug) {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.storePage.deleteMany({ where: { slug } });
      if (deleted.count > 0) {
        await recordAdminAction(tx, { actorId, action: "page.unpublish", targetType: "page", targetId: slug });
      }
    });
    return this.get(slug);
  },
};
