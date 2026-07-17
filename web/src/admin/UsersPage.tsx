import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminApi, type AdminUser } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, dateFmt, Empty, Loading, LoadError, PageHeader, Pagination, useLoad, usePageParam } from "./ui";

/**
 * Customers (REQUIREMENTS §3.10): read-mostly list plus block / unblock.
 * Blocking needs a reason and signs the customer out everywhere. Admin
 * accounts are managed outside the panel — they can't be blocked here.
 */
export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = usePageParam();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const [target, setTarget] = useState<{ user: AdminUser; action: "block" | "unblock" } | null>(null);
  const [flash, setFlash] = useState("");

  const { state, reload } = useLoad(() => adminApi.listUsers({ q, status, page }), [q, status, page]);

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    setParams(next);
  };

  return (
    <div className="adm-page">
      <PageHeader title="Customers" lede="Passwords are never visible to anyone, including admins." />
      <p className="adm-flash" role="status" aria-live="polite">
        {flash}
      </p>
      <div className="adm-toolbar">
        <form
          role="search"
          className="adm-search"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            update((p) => (draft.trim() ? p.set("q", draft.trim()) : p.delete("q")));
          }}
        >
          <label htmlFor="usr-q" className="sr-only">
            Search customers
          </label>
          <input id="usr-q" type="search" placeholder="Name or email" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="adm-btn adm-btn--secondary">
            Search
          </button>
        </form>
        <label className="adm-select">
          <span>Account</span>
          <select value={status} onChange={(e) => update((p) => (e.target.value ? p.set("status", e.target.value) : p.delete("status")))}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
      </div>

      {state.kind === "loading" ? <Loading label="Loading customers…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" && state.data.items.length === 0 ? <Empty title={q || status ? "No customers match" : "No customers yet"} /> : null}
      {state.kind === "ready" && state.data.items.length > 0 ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--stack">
              <caption className="sr-only">Customers</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="adm-num">
                    Orders
                  </th>
                  <th scope="col">Joined</th>
                  <th scope="col">Account</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((u) => (
                  <tr key={u.id}>
                    <th scope="row" data-label="Name">
                      <span className="adm-rowtitle">{u.name}</span>
                      <span className="adm-sub">{u.email}</span>
                    </th>
                    <td data-label="Orders" className="adm-num">
                      {u.orderCount > 0 ? (
                        <Link to={`/admin/orders?q=${encodeURIComponent(u.email)}`} className="adm-rowlink" aria-label={`${u.orderCount} orders by ${u.name}`}>
                          {u.orderCount}
                        </Link>
                      ) : (
                        0
                      )}
                      {u.lastOrderAt ? <span className="adm-sub">Last {dateFmt.format(new Date(u.lastOrderAt))}</span> : null}
                    </td>
                    <td data-label="Joined">{dateFmt.format(new Date(u.createdAt))}</td>
                    <td data-label="Account">
                      {u.role === "ADMIN" ? (
                        <span className="adm-badge adm-badge--admin">Admin</span>
                      ) : u.status === "blocked" ? (
                        <>
                          <span className="adm-badge adm-badge--blocked">Blocked</span>
                          {u.blockedReason ? <span className="adm-sub">{u.blockedReason}</span> : null}
                        </>
                      ) : (
                        <span className="adm-badge adm-badge--p-active">Active</span>
                      )}
                    </td>
                    <td className="adm-actions">
                      {u.role === "ADMIN" || u.id === me?.id ? null : u.status === "blocked" ? (
                        <button type="button" className="adm-btn adm-btn--secondary adm-btn--sm" onClick={() => setTarget({ user: u, action: "unblock" })}>
                          Unblock<span className="sr-only"> {u.name}</span>
                        </button>
                      ) : (
                        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--danger-text" onClick={() => setTarget({ user: u, action: "block" })}>
                          Block<span className="sr-only"> {u.name}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={state.data.page} totalPages={state.data.total_pages} totalItems={state.data.total_items} noun="customer" />
        </>
      ) : null}

      {target?.action === "block" ? (
        <BlockDialog
          user={target.user}
          onClose={() => setTarget(null)}
          onDone={() => {
            setFlash(`${target.user.name} is blocked and has been signed out.`);
            setTarget(null);
            void reload(true);
          }}
        />
      ) : null}
      {target?.action === "unblock" ? (
        <ConfirmDialog
          title={`Unblock ${target.user.name}?`}
          tone="primary"
          confirmLabel="Unblock customer"
          busyLabel="Unblocking…"
          cancelLabel="Keep blocked"
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            try {
              await adminApi.unblockUser(target.user.id);
            } catch (err) {
              throw new Error(err instanceof ApiRequestError ? err.message : "Couldn't unblock this customer.");
            }
            setFlash(`${target.user.name} can sign in again.`);
            setTarget(null);
            void reload(true);
          }}
        >
          <p>They'll be able to sign in, shop, and check out again.</p>
          {target.user.blockedReason ? <p className="adm-sub">Blocked for: {target.user.blockedReason}</p> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function BlockDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const uid = useId();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  return (
    <ConfirmDialog
      title={`Block ${user.name}?`}
      confirmLabel="Block customer"
      busyLabel="Blocking…"
      cancelLabel="Don't block"
      onClose={onClose}
      onConfirm={async () => {
        if (reason.trim().length < 3) {
          setFieldError("Give a reason of at least 3 characters");
          document.getElementById(`${uid}-r`)?.focus();
          throw new Error("A reason is required.");
        }
        try {
          await adminApi.blockUser(user.id, reason.trim());
        } catch (err) {
          throw new Error(err instanceof ApiRequestError ? err.message : "Couldn't block this customer.");
        }
        onDone();
      }}
    >
      <p>
        {user.email} will be signed out on every device and can't sign in until unblocked. Their orders stay as they are.
      </p>
      <div className="adm-field">
        <label htmlFor={`${uid}-r`}>Reason</label>
        <textarea
          id={`${uid}-r`}
          rows={3}
          value={reason}
          maxLength={255}
          onChange={(e) => {
            setReason(e.target.value);
            setFieldError(null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${uid}-rh${fieldError ? ` ${uid}-re` : ""}`}
        />
        <p className="adm-field__hint" id={`${uid}-rh`}>
          Kept in the audit log. Not shown to the customer.
        </p>
        {fieldError ? (
          <p className="adm-field__error" id={`${uid}-re`}>
            {fieldError}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
