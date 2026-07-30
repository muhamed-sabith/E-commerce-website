import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import type { StockState } from "../api/admin";
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, type OrderStatus, type PaymentStatus } from "../api/orders";

/**
 * Shared admin building blocks: data loading with honest states, status
 * badges (text + color, never color alone), pagination over URL state, and
 * an accessible confirmation dialog for destructive actions.
 */

// ---------- loading ----------

export type Load<T> = { kind: "loading" } | { kind: "error"; message: string; status?: number } | { kind: "ready"; data: T };

/** Fetch on mount / when `deps` change; `reload` re-runs; `set` replaces data after a mutation. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  const seq = useRef(0);
  // `deps` are the inputs `fn` closes over (page, filters); callers list them.
  const run = useCallback(fn, deps);

  const reload = useCallback(async (quiet = false) => {
    const n = ++seq.current;
    if (!quiet) setState({ kind: "loading" });
    try {
      const data = await run();
      if (n === seq.current) setState({ kind: "ready", data });
    } catch (err) {
      if (n !== seq.current) return;
      setState({
        kind: "error",
        message: err instanceof ApiRequestError ? err.message : "Couldn't reach the server.",
        status: err instanceof ApiRequestError ? err.status : undefined,
      });
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const set = useCallback((data: T) => setState({ kind: "ready", data }), []);
  return { state, reload, set };
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="adm-state" role="status">
      <span className="adm-spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="adm-state adm-state--error" role="alert">
      <p>{message}</p>
      <button type="button" className="adm-btn adm-btn--secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="adm-empty">
      <p className="adm-empty__title">{title}</p>
      {children ? <div className="adm-empty__body">{children}</div> : null}
    </div>
  );
}

/**
 * Route-change focus: after an in-app navigation the next page heading to
 * mount takes focus once (screen readers announce the new page; keyboard
 * users start at the top). The first load of the app is left alone.
 */
let focusPending = false;
let lastPath: string | null = null;
/** Call with the current pathname; repeated calls for the same path (StrictMode) are ignored. */
export function markNavigation(pathname: string) {
  if (lastPath === null) {
    lastPath = pathname;
    return;
  }
  if (pathname === lastPath) return;
  lastPath = pathname;
  focusPending = true;
}

export function PageHeader({ title, lede, actions, back }: { title: string; lede?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusPending && ref.current) {
      focusPending = false;
      ref.current.focus({ preventScroll: true });
    }
  }, []);
  return (
    <header className="adm-head">
      {back ? (
        <Link to={back.to} className="adm-head__back">
          <span aria-hidden="true">‹ </span>
          {back.label}
        </Link>
      ) : null}
      <div className="adm-head__row">
        <div>
          <h1 className="adm-head__title" tabIndex={-1} data-admin-heading ref={ref}>
            {title}
          </h1>
          {lede ? <p className="adm-head__lede">{lede}</p> : null}
        </div>
        {actions ? <div className="adm-head__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

// ---------- badges ----------

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`adm-badge adm-badge--${status}`}>{ORDER_STATUS_LABEL[status]}</span>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`adm-badge ${status === "PAID" ? "adm-badge--paid" : "adm-badge--unpaid"}`}>
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}

const STOCK_LABEL: Record<StockState, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
};

export function StockBadge({ state }: { state: StockState }) {
  return <span className={`adm-badge adm-badge--${state.replace(/_/g, "-")}`}>{STOCK_LABEL[state]}</span>;
}

export function ProductStatusBadge({ status }: { status: "active" | "inactive" | "archived" }) {
  const label = { active: "Active", inactive: "Inactive", archived: "Archived" }[status];
  return <span className={`adm-badge adm-badge--p-${status}`}>{label}</span>;
}

// ---------- pagination (URL state) ----------

export function Pagination({ page, totalPages, totalItems, noun }: { page: number; totalPages: number; totalItems: number; noun: string }) {
  const [params] = useSearchParams();
  if (totalItems === 0) return null;
  const href = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const s = next.toString();
    return s ? `?${s}` : "?";
  };
  return (
    <nav className="adm-pager" aria-label="Pagination">
      <p className="adm-pager__count">
        {totalItems} {totalItems === 1 ? noun : `${noun}s`}
        {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
      </p>
      {totalPages > 1 ? (
        <div className="adm-pager__links">
          {page > 1 ? (
            <Link className="adm-btn adm-btn--secondary" to={href(page - 1)}>
              Previous
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link className="adm-btn adm-btn--secondary" to={href(page + 1)}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

/** Page number from the URL, clamped to ≥ 1. */
export function usePageParam(): number {
  const [params] = useSearchParams();
  return Math.max(1, Number(params.get("page") ?? "1") || 1);
}

// ---------- confirmation dialog ----------

/**
 * Native <dialog>: focus trap, Escape, inert page. Focus starts on the safe
 * action and returns to the trigger when it closes. `onConfirm` throws to
 * show an inline error and keep the dialog open.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    cancelRef.current?.focus();
    return () => {
      opener?.focus?.();
    };
  }, []);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="adm-dialog"
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-d`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <h2 className="adm-dialog__title" id={`${uid}-t`}>
          {title}
        </h2>
        <div className="adm-dialog__body" id={`${uid}-d`}>
          {children}
        </div>
        {error ? (
          <p className="adm-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="adm-dialog__actions">
          <button type="button" className="adm-btn adm-btn--secondary" onClick={onClose} ref={cancelRef} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="submit" className={`adm-btn adm-btn--${tone}`} aria-disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------- errors → fields ----------

/** Map a validation/conflict envelope to { field: message } (first message wins). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiRequestError) || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const d of err.details as { path?: unknown[]; message?: string }[]) {
    const key = (d.path ?? []).filter((p) => typeof p === "string").join(".");
    if (key && d.message && !out[key]) out[key] = d.message;
  }
  return out;
}

export const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
