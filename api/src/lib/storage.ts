import { randomUUID } from "node:crypto";
import { access, constants, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

/**
 * Product image storage (ARCHITECTURE §5.6/§5.7). One small interface so a
 * shared/object store can replace local disk later without touching the
 * catalog API, admin service, or stored paths (`products/<id>/<uuid>.webp`
 * keys stay the same; `/assets/<key>` stays the public URL).
 *
 * Today: `LocalDiskStorage` under UPLOAD_DIR — correct for local, demo and
 * single-server deployments. Several API instances need a shared provider;
 * none is implemented (no provider has been chosen).
 */
export interface ImageStorage {
  /** Persist new bytes under a generated key; never overwrites. */
  put(productId: bigint, data: Buffer): Promise<string>;
  /** Best-effort removal of a key this storage generated (others are ignored). */
  remove(key: string): Promise<void>;
}

export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);

/** Only keys this module generates are ever touched on disk. */
const GENERATED_KEY = /^products\/\d{1,18}\/[0-9a-f-]{36}\.webp$/;

export function resolveKey(root: string, key: string): string | null {
  if (!GENERATED_KEY.test(key)) return null;
  const abs = path.resolve(root, key);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export class LocalDiskStorage implements ImageStorage {
  constructor(private readonly root: string) {}

  async put(productId: bigint, data: Buffer): Promise<string> {
    const key = `products/${productId.toString()}/${randomUUID()}.webp`;
    const abs = resolveKey(this.root, key);
    if (!abs) throw new Error("generated path escaped the upload root");
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data, { flag: "wx", mode: 0o644 });
    return key;
  }

  async remove(key: string): Promise<void> {
    const abs = resolveKey(this.root, key);
    if (abs) await rm(abs, { force: true }).catch(() => undefined);
  }
}

export const imageStorage: ImageStorage = new LocalDiskStorage(UPLOAD_ROOT);

/**
 * Startup check: the upload root exists (created if missing) and is
 * writable. Fails fast with a clear message instead of failing the first
 * admin upload in production.
 */
export async function ensureUploadRoot(root = UPLOAD_ROOT): Promise<void> {
  try {
    await mkdir(path.join(root, "products"), { recursive: true });
    await access(root, constants.W_OK);
  } catch (err) {
    throw new Error(`UPLOAD_DIR "${root}" is not writable: ${(err as Error).message}`);
  }
}
