import { useEffect, useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminApi, type StorePage } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { ConfirmDialog, dateTimeFmt, Loading, LoadError, PageHeader, useLoad } from "./ui";

const PUBLIC_PATH: Record<StorePage["slug"], string> = {
  privacy: "/privacy",
  terms: "/terms",
  returns: "/returns",
  shipping: "/shipping-policy",
  contact: "/contact",
};

/**
 * Policy + contact pages. HEYRAH writes these; the panel stores and
 * publishes the text exactly as entered (plain text, blank line = new
 * paragraph). Nothing is pre-filled — a draft is never shown to shoppers.
 */
export function AdminPagesPage() {
  const { state, reload, set } = useLoad(() => adminApi.listPages(), []);
  const [flash, setFlash] = useState("");

  return (
    <div className="adm-page adm-page--narrow">
      <PageHeader
        title="Pages"
        lede="Privacy, terms, returns, shipping and contact details. Shoppers see a page only after you publish it; until then it says it isn't published yet."
      />
      <p className="adm-flash" role="status" aria-live="polite">
        {flash}
      </p>
      {state.kind === "loading" ? <Loading label="Loading pages…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready"
        ? state.data.items.map((p) => (
            <PageEditor
              key={p.slug}
              page={p}
              onSaved={(next, message) => {
                set({ items: state.data.items.map((x) => (x.slug === next.slug ? next : x)) });
                setFlash(message);
              }}
            />
          ))
        : null}
    </div>
  );
}

function PageEditor({ page, onSaved }: { page: StorePage; onSaved: (p: StorePage, message: string) => void }) {
  const uid = useId();
  const [body, setBody] = useState(page.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setBody(page.body ?? ""), [page.body]);
  const dirty = body.trim() !== (page.body ?? "").trim();

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (body.trim().length < 20) {
      setError("Write at least a couple of sentences");
      document.getElementById(`${uid}-b`)?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { page: next } = await adminApi.savePage(page.slug, body);
      onSaved(next, `${page.title} ${page.published ? "updated" : "published"}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="adm-panel" onSubmit={(e) => void save(e)} noValidate aria-labelledby={`${uid}-h`}>
      <div className="adm-panel__head">
        <h2 id={`${uid}-h`}>{page.title}</h2>
        <span className={page.published ? "adm-badge adm-badge--p-active" : "adm-badge adm-badge--p-inactive"}>
          {page.published ? "Published" : "Not published"}
        </span>
      </div>
      <div className="adm-field">
        <label htmlFor={`${uid}-b`}>Page text</label>
        <textarea
          id={`${uid}-b`}
          rows={8}
          value={body}
          maxLength={20000}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${uid}-h2${error ? ` ${uid}-e` : ""}`}
        />
        <p className="adm-field__hint" id={`${uid}-h2`}>
          Plain text. Leave a blank line between paragraphs. {page.updatedAt ? `Last saved ${dateTimeFmt.format(new Date(page.updatedAt))}.` : ""}
        </p>
        {error ? (
          <p className="adm-field__error" id={`${uid}-e`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="adm-form__actions">
        <button type="submit" className="adm-btn adm-btn--primary" aria-disabled={saving || (!dirty && page.published)}>
          {saving ? "Saving…" : page.published ? "Save changes" : "Publish page"}
        </button>
        {page.published ? (
          <>
            <Link to={PUBLIC_PATH[page.slug]} target="_blank" rel="noopener" className="adm-btn adm-btn--ghost">
              View page<span className="sr-only"> (opens in a new tab)</span>
            </Link>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--danger-text" onClick={() => setConfirm(true)}>
              Unpublish
            </button>
          </>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          title={`Unpublish ${page.title}?`}
          confirmLabel="Unpublish page"
          busyLabel="Unpublishing…"
          cancelLabel="Keep it published"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            try {
              const { page: next } = await adminApi.unpublishPage(page.slug);
              onSaved(next, `${page.title} unpublished.`);
              setConfirm(false);
            } catch (err) {
              throw new Error(err instanceof ApiRequestError ? err.message : "Couldn't unpublish.");
            }
          }}
        >
          <p>Shoppers will see that this page isn't published yet, and the footer link disappears. The text is removed.</p>
        </ConfirmDialog>
      ) : null}
    </form>
  );
}
