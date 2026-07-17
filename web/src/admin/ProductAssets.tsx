import { useId, useRef, useState, type FormEvent } from "react";
import { adminApi, type AdjustmentInput, type AdminImage } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { ConfirmDialog } from "./ui";

/**
 * Image manager + stock adjustment form — used on the product page and
 * (the stock form) in Inventory. The server validates every upload (real
 * type by magic bytes, size, re-encode); the client check is a courtesy.
 */

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5_000_000;

export function ImageManager({
  productId,
  productName,
  images,
  isActive,
  onChange,
}: {
  productId: string;
  productName: string;
  images: AdminImage[];
  isActive: boolean;
  onChange: (images: AdminImage[]) => void;
}) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState<"upload" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<AdminImage | null>(null);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an image to upload.");
      fileRef.current?.focus();
      return;
    }
    if (file.type && !ACCEPT.includes(file.type)) {
      setError("Upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Images can be up to 5 MB.");
      return;
    }
    setBusy("upload");
    try {
      const { product } = await adminApi.uploadImage(productId, file, alt.trim() || undefined);
      onChange(product.images);
      setNotice("Image uploaded.");
      setAlt("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Upload failed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function primary(img: AdminImage) {
    if (busy) return;
    setBusy(img.id);
    setError(null);
    try {
      const { product } = await adminApi.makePrimary(img.id);
      onChange(product.images);
      setNotice("Primary image updated.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't update the image.");
    } finally {
      setBusy(null);
    }
  }

  const lastOnActive = isActive && images.length <= 1;

  return (
    <section className="adm-panel" aria-labelledby={`${uid}-h`}>
      <div className="adm-panel__head">
        <h2 id={`${uid}-h`}>Images</h2>
        <span className="adm-sub">{images.length} of 12</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
      {images.length === 0 ? (
        <p className="adm-panel__note">No images yet. Upload at least one before setting this product active.</p>
      ) : (
        <ul className="adm-gallery">
          {images.map((img, n) => (
            <li key={img.id} className="adm-gallery__item">
              <GalleryImage src={img.src} alt={img.alt} />
              <div className="adm-gallery__meta">
                {img.isPrimary ? <span className="adm-badge adm-badge--paid">Primary</span> : <span className="adm-sub">Image {n + 1}</span>}
                <div className="adm-gallery__actions">
                  {!img.isPrimary ? (
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => void primary(img)} aria-disabled={busy !== null}>
                      Make primary
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--danger-text"
                    onClick={() => setRemoving(img)}
                    disabled={lastOnActive}
                    aria-describedby={lastOnActive ? `${uid}-last` : undefined}
                  >
                    Remove<span className="sr-only"> image {n + 1}</span>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {lastOnActive && images.length === 1 ? (
        <p className="adm-field__hint" id={`${uid}-last`}>
          An active product keeps at least one image. Upload another first, or set it inactive.
        </p>
      ) : null}

      {images.length < 12 ? (
        <form className="adm-upload" onSubmit={(e) => void upload(e)} aria-busy={busy === "upload"}>
          <div className="adm-field">
            <label htmlFor={`${uid}-file`}>Add an image</label>
            <input id={`${uid}-file`} ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={`${uid}-file-hint`} />
            <p className="adm-field__hint" id={`${uid}-file-hint`}>
              JPEG, PNG, or WebP, up to 5 MB, at least 200 px on each side. Saved as WebP with metadata removed.
            </p>
          </div>
          <div className="adm-field">
            <label htmlFor={`${uid}-alt`}>
              Alt text <span className="adm-optional">optional</span>
            </label>
            <input id={`${uid}-alt`} value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} placeholder={productName} />
          </div>
          <button type="submit" className="adm-btn adm-btn--secondary" aria-disabled={busy === "upload"}>
            {busy === "upload" ? "Uploading…" : "Upload image"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="adm-field__error" role="alert">
          {error}
        </p>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="Remove this image?"
          confirmLabel="Remove image"
          busyLabel="Removing…"
          cancelLabel="Keep image"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              const { product } = await adminApi.deleteImage(removing.id);
              onChange(product.images);
              setNotice("Image removed.");
              setRemoving(null);
            } catch (err) {
              throw new Error(err instanceof ApiRequestError ? err.message : "Couldn't remove the image.");
            }
          }}
        >
          <p>The file is deleted from the store. This can't be undone.</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/** Image with an honest placeholder when the file can't be loaded. */
function GalleryImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="adm-img-missing" role="img" aria-label={`${alt} (file unavailable)`}>
        File unavailable
      </span>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

// ---------- stock adjustment ----------

type Reason = AdjustmentInput["reason"];

const REASONS: { value: Reason; label: string; hint: string }[] = [
  { value: "restock", label: "Restock", hint: "New units arrived. Adds to the count." },
  { value: "damaged", label: "Damaged", hint: "Units can't be sold. Removes from the count." },
  { value: "correction", label: "Correction", hint: "Fix a miscount. Use + or −." },
  { value: "admin_set", label: "Set count", hint: "Enter the counted total; the change is recorded." },
];

export function StockAdjustForm({
  productId,
  productName,
  current,
  onDone,
  compact = false,
}: {
  productId: string;
  productName: string;
  current: number;
  onDone: (stock: number, message: string) => void;
  compact?: boolean;
}) {
  const uid = useId();
  const [reason, setReason] = useState<Reason>("restock");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const label = reason === "admin_set" ? "New count" : reason === "correction" ? "Change (+/−)" : "Units";
  const meta = REASONS.find((r) => r.value === reason)!;

  function body(): AdjustmentInput | string {
    const raw = amount.trim();
    if (reason === "correction" ? !/^[+-]?\d{1,6}$/.test(raw) : !/^\d{1,6}$/.test(raw)) {
      return reason === "correction" ? "Enter a whole number like 3 or −2" : "Enter a whole number";
    }
    const n = Number(raw.replace("+", ""));
    if (reason === "admin_set") return n === current ? `Stock is already ${current}` : { reason, quantity: n };
    if (n === 0) return "Enter a number other than 0";
    if (reason === "restock") return { reason, delta: n };
    if (reason === "damaged") return n > current ? `Only ${current} in stock` : { reason, delta: -n };
    return current + n < 0 ? `Only ${current} in stock` : { reason, delta: n };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const b = body();
    if (typeof b === "string") {
      setError(b);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.adjustStock(productId, b);
      setAmount("");
      const d = res.adjustment.delta;
      onDone(res.stockQuantity, `${productName}: ${d > 0 ? "+" : "−"}${Math.abs(d)}, now ${res.stockQuantity} in stock.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save the adjustment.");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={compact ? "adm-adjust adm-adjust--compact" : "adm-adjust"} onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
      <div className="adm-field">
        <label htmlFor={`${uid}-r`}>Reason</label>
        <select id={`${uid}-r`} value={reason} onChange={(e) => { setReason(e.target.value as Reason); setError(null); }} aria-describedby={`${uid}-rh`}>
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="adm-field__hint" id={`${uid}-rh`}>
          {meta.hint}
        </p>
      </div>
      <div className="adm-field">
        <label htmlFor={`${uid}-n`}>{label}</label>
        <input
          id={`${uid}-n`}
          ref={inputRef}
          inputMode={reason === "correction" ? "text" : "numeric"}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-e` : undefined}
          autoComplete="off"
        />
        {error ? (
          <p className="adm-field__error" id={`${uid}-e`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button type="submit" className="adm-btn adm-btn--primary" aria-disabled={busy}>
        {busy ? "Saving…" : "Save adjustment"}
      </button>
    </form>
  );
}
