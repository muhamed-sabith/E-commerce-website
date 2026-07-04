import { useEffect, useId, useRef, useState } from "react";
import { ApiRequestError } from "../api/client";
import type { Address } from "../api/customer";

/**
 * Delete confirmation (native <dialog>: focus trap, Escape, inert page).
 * Deleting the default while other addresses exist requires choosing the
 * replacement default first — the server enforces the same rule.
 */
export function DeleteAddressDialog({
  target,
  others,
  onConfirm,
  onClose,
}: {
  target: Address;
  others: Address[];
  onConfirm: (newDefaultId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const needsReplacement = target.isDefault && others.length > 0;
  const [replacement, setReplacement] = useState<string>(others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      // jsdom lacks showModal; fall back to the open attribute.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    // Safe choice first: the non-destructive action gets focus once the
    // modal is open (autoFocus would run before showModal and be lost).
    keepRef.current?.focus();
  }, []);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(needsReplacement ? replacement : undefined);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Couldn't delete this address. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="addr-dialog"
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-desc`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 className="addr-dialog__title" id={`${uid}-title`}>
        Delete this address?
      </h2>
      <p id={`${uid}-desc`} className="addr-dialog__copy">
        {target.receiverName}, {target.line1}, {target.city}. This can't be undone.
      </p>

      {needsReplacement ? (
        <fieldset className="addr-dialog__choices">
          <legend>This is your default address. Choose a new default:</legend>
          {others.map((a) => (
            <label key={a.id} className="addr-dialog__choice">
              <input
                type="radio"
                name={`${uid}-replacement`}
                value={a.id}
                checked={replacement === a.id}
                onChange={() => setReplacement(a.id)}
              />
              <span>
                {a.receiverName}, {a.line1}, {a.city}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {error ? (
        <p className="addr-dialog__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="addr-dialog__actions">
        <button type="button" className="addr-button addr-button--ghost" onClick={onClose} ref={keepRef}>
          Keep address
        </button>
        <button
          type="button"
          className="addr-button addr-button--danger"
          onClick={() => void confirm()}
          aria-disabled={busy}
        >
          {busy ? "Deleting…" : "Delete address"}
        </button>
      </div>
    </dialog>
  );
}
