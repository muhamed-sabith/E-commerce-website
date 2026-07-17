import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminCategory } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { ConfirmDialog, Empty, fieldErrors, Loading, LoadError, PageHeader, useLoad } from "./ui";

/**
 * Categories (REQUIREMENTS §3.4): create, rename, reorder, activate or
 * deactivate, delete. Deleting a category that still holds products asks
 * for a destination first — the server refuses otherwise.
 */
export function AdminCategoriesPage() {
  const { state, reload, set } = useLoad(() => adminApi.listCategories(), []);
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const [flash, setFlash] = useState("");

  return (
    <div className="adm-page">
      <PageHeader
        title="Categories"
        lede="Active categories appear in the store navigation, in this order."
        actions={
          editing === null ? (
            <button type="button" className="adm-btn adm-btn--primary" onClick={() => setEditing("new")}>
              Add category
            </button>
          ) : null
        }
      />
      <p className="adm-flash" role="status" aria-live="polite">
        {flash}
      </p>

      {editing !== null ? (
        <CategoryForm
          category={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(items, message) => {
            set({ items });
            setEditing(null);
            setFlash(message);
          }}
        />
      ) : null}

      {state.kind === "loading" ? <Loading label="Loading categories…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" && state.data.items.length === 0 ? (
        <Empty title="No categories yet">Add one so products have somewhere to live.</Empty>
      ) : null}
      {state.kind === "ready" && state.data.items.length > 0 ? (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--stack">
            <caption className="sr-only">Categories</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="adm-num">
                  Order
                </th>
                <th scope="col" className="adm-num">
                  Products
                </th>
                <th scope="col">Visibility</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.items.map((c) => (
                <tr key={c.id}>
                  <th scope="row" data-label="Category">
                    <span className="adm-rowtitle">{c.name}</span>
                    <span className="adm-sub">/{c.slug}</span>
                  </th>
                  <td data-label="Order" className="adm-num">
                    {c.sortOrder}
                  </td>
                  <td data-label="Products" className="adm-num">
                    {c.productCount > 0 ? (
                      <Link to={`/admin/products?category_id=${c.id}`} className="adm-rowlink" aria-label={`${c.productCount} products in ${c.name}`}>
                        {c.productCount}
                      </Link>
                    ) : (
                      0
                    )}
                    {c.productCount !== c.activeProductCount ? <span className="adm-sub">{c.activeProductCount} on sale</span> : null}
                  </td>
                  <td data-label="Visibility">
                    <span className={c.isActive ? "adm-badge adm-badge--p-active" : "adm-badge adm-badge--p-inactive"}>
                      {c.isActive ? "Shown in store" : "Hidden"}
                    </span>
                  </td>
                  <td className="adm-actions">
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEditing(c)}>
                      Edit<span className="sr-only"> {c.name}</span>
                    </button>
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--danger-text" onClick={() => setDeleting(c)}>
                      Delete<span className="sr-only"> {c.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {deleting && state.kind === "ready" ? (
        <DeleteCategoryDialog
          target={deleting}
          others={state.data.items.filter((c) => c.id !== deleting.id && c.isActive)}
          onClose={() => setDeleting(null)}
          onDeleted={(items) => {
            set({ items });
            setFlash(`${deleting.name} deleted.`);
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryForm({
  category,
  onCancel,
  onSaved,
}: {
  category: AdminCategory | null;
  onCancel: () => void;
  onSaved: (items: AdminCategory[], message: string) => void;
}) {
  const uid = useId();
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = "Enter a name of at least 2 characters";
    if (slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) errs.slug = "Use lowercase letters, numbers, and single hyphens";
    if (!/^\d{1,4}$/.test(sortOrder.trim())) errs.sort_order = "Enter a whole number (0 or more)";
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length > 0) {
      document.getElementById(`${uid}-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        is_active: isActive,
        sort_order: Number(sortOrder),
      };
      const { items } = category ? await adminApi.updateCategory(category.id, body) : await adminApi.createCategory(body);
      onSaved(items, category ? `${body.name} saved.` : `${body.name} added.`);
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(f);
      setFormError(err instanceof ApiRequestError ? err.message : "Couldn't save. Try again.");
      const first = Object.keys(f)[0];
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
    } finally {
      setSaving(false);
    }
  }

  const a11y = (k: string) => ({
    id: `${uid}-${k}`,
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `${uid}-${k}-e` : undefined,
  });
  const err = (k: string) =>
    errors[k] ? (
      <p className="adm-field__error" id={`${uid}-${k}-e`}>
        {errors[k]}
      </p>
    ) : null;

  return (
    <form className="adm-panel adm-inline-form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>{category ? `Edit ${category.name}` : "New category"}</h2>
      {formError ? (
        <p className="adm-form__error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="adm-grid3">
        <div className="adm-field">
          <label htmlFor={`${uid}-name`}>Name</label>
          <input {...a11y("name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          {err("name")}
        </div>
        <div className="adm-field">
          <label htmlFor={`${uid}-slug`}>
            URL slug <span className="adm-optional">optional</span>
          </label>
          <input {...a11y("slug")} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={90} spellCheck={false} />
          {err("slug")}
        </div>
        <div className="adm-field">
          <label htmlFor={`${uid}-sort_order`}>Display order</label>
          <input {...a11y("sort_order")} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          {err("sort_order")}
        </div>
      </div>
      <label className="adm-check">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Show in the store navigation
      </label>
      <div className="adm-form__actions">
        <button type="submit" className="adm-btn adm-btn--primary" aria-disabled={saving}>
          {saving ? "Saving…" : category ? "Save category" : "Add category"}
        </button>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteCategoryDialog({
  target,
  others,
  onClose,
  onDeleted,
}: {
  target: AdminCategory;
  others: AdminCategory[];
  onClose: () => void;
  onDeleted: (items: AdminCategory[]) => void;
}) {
  const uid = useId();
  const needsMove = target.productCount > 0;
  const [dest, setDest] = useState(others[0]?.id ?? "");
  const blocked = needsMove && others.length === 0;

  return (
    <ConfirmDialog
      title={`Delete ${target.name}?`}
      confirmLabel={needsMove ? "Move products and delete" : "Delete category"}
      busyLabel="Deleting…"
      cancelLabel="Keep category"
      onClose={onClose}
      onConfirm={async () => {
        if (blocked) throw new Error("Create or activate another category first, then move the products there.");
        try {
          const { items } = await adminApi.deleteCategory(target.id, needsMove ? dest : undefined);
          onDeleted(items);
        } catch (err) {
          throw new Error(err instanceof ApiRequestError ? err.message : "Couldn't delete the category.");
        }
      }}
    >
      {needsMove ? (
        <>
          <p>
            {target.productCount} {target.productCount === 1 ? "product is" : "products are"} in this category. Choose where to move{" "}
            {target.productCount === 1 ? "it" : "them"} before deleting.
          </p>
          {others.length > 0 ? (
            <div className="adm-field">
              <label htmlFor={`${uid}-dest`}>Move products to</label>
              <select id={`${uid}-dest`} value={dest} onChange={(e) => setDest(e.target.value)}>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="adm-field__error">There's no other active category to move them to.</p>
          )}
        </>
      ) : (
        <p>The category is empty. Deleting it can't be undone.</p>
      )}
    </ConfirmDialog>
  );
}
