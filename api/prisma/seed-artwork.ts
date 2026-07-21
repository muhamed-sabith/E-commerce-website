import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { UPLOAD_ROOT } from "../src/lib/images.js";

/**
 * Development/demo product artwork. Real product photography doesn't exist
 * yet, and nothing is downloaded from anywhere. Each seeded product gets two
 * honest placeholder images — a quiet fabric-toned plate with the product
 * name and category, clearly not a photograph — generated here and written
 * through the same WebP pipeline as admin uploads, into the uploads tree the
 * API already serves at /assets/products.
 *
 * Paths: products/seed/<sku>-<n>.webp (the `seed` folder keeps generated
 * artwork apart from admin uploads, which use products/<id>/<uuid>.webp).
 */

/** Tone per category: restrained, within the brand palette family. */
const TONES: Record<string, { bg: string; ink: string; rule: string }> = {
  kurtas: { bg: "#efe6dc", ink: "#0d3b3f", rule: "#c9a24b" },
  dresses: { bg: "#f3e9e4", ink: "#0d3b3f", rule: "#c9a24b" },
  outerwear: { bg: "#e4e8e4", ink: "#0d3b3f", rule: "#a88a4a" },
  accessories: { bg: "#f6f0e6", ink: "#10555a", rule: "#c9a24b" },
  footwear: { bg: "#ebe6df", ink: "#0d3b3f", rule: "#a88a4a" },
  default: { bg: "#f1f0ec", ink: "#0d3b3f", rule: "#c9a24b" },
};

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Break a product name into at most 3 lines of ~16 chars for the plate. */
function lines(name: string): string[] {
  const words = name.replace(/\s+-\s+/g, " – ").split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 16 && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}

function plate(name: string, category: string, variant: 1 | 2): string {
  const t = TONES[category] ?? TONES.default;
  const W = 900;
  const H = 1200;
  const ls = lines(name);
  const startY = H / 2 - ((ls.length - 1) * 64) / 2;
  // Variant 2 is the "alternate view": the same plate with a softer weave.
  const weaveOpacity = variant === 1 ? 0.07 : 0.12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="weave" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(${variant === 1 ? 45 : -45})">
      <rect width="7" height="14" fill="${t.ink}" fill-opacity="${weaveOpacity}"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#weave)"/>
  <rect x="60" y="60" width="${W - 120}" height="${H - 120}" fill="none" stroke="${t.rule}" stroke-opacity="0.55" stroke-width="2"/>
  <text x="${W / 2}" y="170" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" letter-spacing="12" fill="${t.ink}" fill-opacity="0.7">HEYRAH</text>
  ${ls
    .map(
      (l, i) =>
        `<text x="${W / 2}" y="${startY + i * 64}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="52" fill="${t.ink}">${escapeXml(l)}</text>`,
    )
    .join("\n  ")}
  <rect x="${W / 2 - 40}" y="${startY + ls.length * 64 - 20}" width="80" height="2" fill="${t.rule}"/>
  <text x="${W / 2}" y="${H - 150}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="4" fill="${t.ink}" fill-opacity="0.65">${escapeXml(category.toUpperCase())}</text>
  <text x="${W / 2}" y="${H - 110}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="${t.ink}" fill-opacity="0.5">Photography coming soon</text>
</svg>`;
}

export const seedImagePath = (sku: string, n: 1 | 2) => `products/seed/${sku.toLowerCase()}-${n}.webp`;

/**
 * Render the two plates for a product if they aren't on disk yet. The plates
 * are deterministic (name + category), so an existing file is already
 * correct; skipping it keeps repeated seeds (every test suite) fast.
 * Set SEED_ARTWORK_REFRESH=1 to force a re-render after changing the design.
 */
export async function writeSeedArtwork(sku: string, name: string, category: string): Promise<void> {
  const dir = path.join(UPLOAD_ROOT, "products", "seed");
  await mkdir(dir, { recursive: true });
  const force = process.env.SEED_ARTWORK_REFRESH === "1";
  for (const n of [1, 2] as const) {
    const file = path.join(UPLOAD_ROOT, seedImagePath(sku, n));
    if (!force && existsSync(file)) continue;
    const webp = await sharp(Buffer.from(plate(name, category, n))).webp({ quality: 82 }).toBuffer();
    await writeFile(file, webp);
  }
}
