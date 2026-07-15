import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { env } from "../config/env.js";
import { ApiError } from "../middleware/error.js";

/**
 * Product image intake (REQUIREMENTS §12.6). Nothing a client sends is
 * stored as-is:
 *   1. the real type comes from magic bytes (JPEG / PNG / WebP only) — the
 *      filename, extension, and declared MIME type are ignored;
 *   2. the decoder must agree with the magic bytes, under a pixel ceiling
 *      (decompression bombs fail here);
 *   3. the image is re-encoded to WebP — EXIF/GPS/ICC/XMP metadata and any
 *      trailing bytes (polyglot payloads) do not survive re-encoding;
 *   4. the stored name is generated (`<uuid>.webp`) inside a per-product
 *      directory; client names never reach the filesystem.
 */

export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);
const MAX_PIXELS = 40_000_000; // ~6300×6300
const MAX_EDGE = 2000; // stored images are fitted inside 2000×2000
const MIN_EDGE = 200; // smaller than this is not a usable product photo

type Kind = "jpeg" | "png" | "webp";

/** Sniff the container from its first bytes. Returns null for anything else. */
export function sniffImageType(buf: Buffer): Kind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

const unsupported = () =>
  new ApiError(415, "unsupported_image", "Upload a JPEG, PNG, or WebP image.");

/** Validate + re-encode. Throws ApiError with a clean, user-facing message. */
export async function processProductImage(buf: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const kind = sniffImageType(buf);
  if (!kind) throw unsupported();

  let meta: Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new ApiError(415, "unsupported_image", "This file isn't a readable image.");
  }
  // The decoder must agree with the magic bytes (no disguised containers).
  if (meta.format !== kind) throw unsupported();
  if (!meta.width || !meta.height) throw new ApiError(415, "unsupported_image", "This file isn't a readable image.");
  if (Math.min(meta.width, meta.height) < MIN_EDGE) {
    throw new ApiError(422, "image_too_small", `Images need to be at least ${MIN_EDGE}px on each side.`);
  }

  try {
    const { data, info } = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false })
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ApiError(415, "unsupported_image", "This file isn't a readable image.");
  }
}

/** Write under products/<productId>/<uuid>.webp; returns the stored relative path. */
export async function storeProductImage(productId: bigint, data: Buffer): Promise<string> {
  const rel = `products/${productId.toString()}/${randomUUID()}.webp`;
  const abs = resolveStored(rel);
  if (!abs) throw new Error("generated path escaped the upload root");
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data, { flag: "wx" }); // never overwrite
  return rel;
}

/** Only paths this module generated are ever touched on disk. */
const STORED = /^products\/\d{1,18}\/[0-9a-f-]{36}\.webp$/;

function resolveStored(rel: string): string | null {
  if (!STORED.test(rel)) return null;
  const abs = path.resolve(UPLOAD_ROOT, rel);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

/** Best-effort removal after the DB change committed (seed paths are skipped). */
export async function removeStoredImage(rel: string): Promise<void> {
  const abs = resolveStored(rel);
  if (abs) await rm(abs, { force: true }).catch(() => undefined);
}
