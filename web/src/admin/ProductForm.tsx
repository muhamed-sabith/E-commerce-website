import { useId, useRef, useState, type FormEvent } from "react";
import type { AdminCategory, AdminProduct, ProductInput, ProductStatus } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { fieldErrors } from "./ui";

/**
 * Reusable create/edit product form (REQUIREMENTS §3.3/§4). Client checks
 * mirror the server's rules for fast feedback; the server re-validates
 * everything and its field errors map back onto the same inputs. Typed
 * values survive any failure; the first invalid field receives focus;
 * a pending save can't be submitted twice.
 */

interface Values {
  name: string;
  slug: string;
  sku: string;
  description: string;
  price: string;
  discountType: "none" | "percent" | "fixed";
  discountValue: string;
  categoryId: string;
  status: ProductStatus;
  lowStock: string;
  stock: string;
  specs: { key: string; value: string }[];
}

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const ORDER: (keyof Values | "discount.value")[] = ["name", "sku", "slug", "price", "discount.value", "categoryId", "description", "stock", "lowStock", "status"];

function initial(p?: AdminProduct): Values {
  return {
    name: p?.name ?? "",
    slug: p?.slug ?? "",
    sku: p?.sku ?? "",
    description: p?.description ?? "",
    price: p?.price.amount ?? "",
    discountType: p?.discount.type ?? "none",
    discountValue: p && p.discount.type !== "none" ? p.discount.value.amount : "",
    categoryId: p?.category.id ?? "",
    status: p?.status ?? "inactive",
    lowStock: p?.lowStockThreshold === null || p?.lowStockThreshold === undefined ? "" : String(p.lowStockThreshold),
    stock: "0",
    specs: p?.specifications ?? [],
  };
}

export function validateProduct(v: Values, mode: "create" | "edit", hasImages: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const name = v.name.trim();
  if (name.length < 2) e.name = "Enter a name of at least 2 characters";
  else if (name.length > 120) e.name = "Keep the name to 120 characters";
  if (!/^HEY-[A-Z]{3}-\d{5}$/.test(v.sku.trim().toUpperCase())) e.sku = "Use the HEYRAH pattern HEY-ABC-12345";
  if (v.slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug.trim())) e.slug = "Use lowercase letters, numbers, and single hyphens";
  if (!v.description.trim()) e.description = "Describe the product";
  if (!MONEY.test(v.price.trim())) e.price = "Enter a price like 1499.00";
  else if (Number(v.price) <= 0) e.price = "Price must be greater than 0";
  if (v.discountType !== "none") {
    const d = v.discountValue.trim();
    if (!MONEY.test(d) || Number(d) <= 0) e["discount.value"] = "Enter a discount greater than 0";
    else if (v.discountType === "percent" && Number(d) >= 100) e["discount.value"] = "A percent discount must be below 100";
    else if (v.discountType === "fixed" && !e.price && Number(d) >= Number(v.price)) e["discount.value"] = "A fixed discount must be less than the price";
  }
  if (!v.categoryId) e.categoryId = "Choose a category";
  if (v.lowStock.trim() && !/^\d{1,4}$/.test(v.lowStock.trim())) e.lowStock = "Enter a whole number, or leave blank for the store default";
  if (mode === "create" && !/^\d{1,6}$/.test(v.stock.trim())) e.stock = "Enter a whole number of units (0 or more)";
  if (v.status === "active" && !hasImages) e.status = mode === "create" ? "Save first, add an image, then set it active" : "Add at least one image before setting it active";
  v.specs.forEach((s, i) => {
    if (!s.key.trim() || !s.value.trim()) e[`specs.${i}`] = "Fill in both the name and the value, or remove the row";
  });
  return e;
}

function toInput(v: Values, mode: "create" | "edit"): ProductInput {
  return {
    name: v.name.trim(),
    ...(v.slug.trim() ? { slug: v.slug.trim() } : {}),
    sku: v.sku.trim().toUpperCase(),
    description: v.description.trim(),
    price: v.price.trim(),
    discount: v.discountType === "none" ? { type: "none" } : { type: v.discountType, value: v.discountValue.trim() },
    category_id: v.categoryId,
    status: v.status,
    low_stock_threshold: v.lowStock.trim() ? Number(v.lowStock.trim()) : null,
    specifications: v.specs.map((s) => ({ key: s.key.trim(), value: s.value.trim() })),
    ...(mode === "create" ? { stock_quantity: Number(v.stock.trim() || "0") } : {}),
  };
}

/** Server field paths → form field keys. */
const SERVER_FIELD: Record<string, string> = {
  category_id: "categoryId",
  low_stock_threshold: "lowStock",
  stock_quantity: "stock",
};

export function ProductForm({
  mode,
  product,
  categories,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  product?: AdminProduct;
  categories: AdminCategory[];
  onSubmit: (input: ProductInput) => Promise<void>;
  onCancel: () => void;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [v, setV] = useState<Values>(() => initial(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fid = (k: string) => `${uid}-${k.replace(/\./g, "-")}`;
  const hasImages = (product?.images.length ?? 0) > 0;

  const set = <K extends keyof Values>(k: K, value: Values[K]) => {
    setV((cur) => ({ ...cur, [k]: value }));
    if (errors[k as string]) {
      setErrors((cur) => {
        const next = { ...cur };
        delete next[k as string];
        return next;
      });
    }
  };

  function focusFirst(e: Record<string, string>) {
    const first = [...ORDER, ...Object.keys(e)].find((k) => e[k as string]);
    if (!first) return;
    document.getElementById(fid(first as string))?.focus();
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (saving) return;
    setFormError(null);
    const e = validateProduct(v, mode, hasImages);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setFormError("Check the highlighted fields.");
      focusFirst(e);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(toInput(v, mode));
    } catch (err) {
      const mapped: Record<string, string> = {};
      for (const [k, msg] of Object.entries(fieldErrors(err))) {
        const head = k.split(".")[0];
        const key = k === "discount.value" ? k : (SERVER_FIELD[head] ?? (head === "specifications" ? "specs.0" : head));
        mapped[key] = msg;
      }
      setErrors(mapped);
      setFormError(err instanceof ApiRequestError ? err.message : "Couldn't save. Check your connection and try again.");
      focusFirst(mapped);
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) =>
    errors[k] ? (
      <p className="adm-field__error" id={`${fid(k)}-err`}>
        {errors[k]}
      </p>
    ) : null;
  const a11y = (k: string, hint?: boolean) => ({
    id: fid(k),
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": [errors[k] ? `${fid(k)}-err` : "", hint ? `${fid(k)}-hint` : ""].filter(Boolean).join(" ") || undefined,
  });

  const activeCategories = categories.filter((c) => c.isActive || c.id === product?.category.id);

  return (
    <form ref={formRef} className="adm-form" onSubmit={(e) => void submit(e)} noValidate aria-busy={saving}>
      {formError ? (
        <p className="adm-form__error" role="alert">
          {formError}
        </p>
      ) : null}

      <fieldset className="adm-fieldset">
        <legend>Details</legend>
        <div className="adm-field">
          <label htmlFor={fid("name")}>Name</label>
          <input {...a11y("name")} value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoComplete="off" />
          {err("name")}
        </div>
        <div className="adm-grid2">
          <div className="adm-field">
            <label htmlFor={fid("sku")}>SKU</label>
            <input
              {...a11y("sku", true)}
              value={v.sku}
              onChange={(e) => set("sku", e.target.value.toUpperCase())}
              placeholder="HEY-DRS-00005"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="adm-field__hint" id={`${fid("sku")}-hint`}>
              Unique. Pattern HEY-ABC-12345.
            </p>
            {err("sku")}
          </div>
          <div className="adm-field">
            <label htmlFor={fid("slug")}>
              URL slug <span className="adm-optional">optional</span>
            </label>
            <input {...a11y("slug", true)} value={v.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} autoComplete="off" spellCheck={false} />
            <p className="adm-field__hint" id={`${fid("slug")}-hint`}>
              {mode === "create" ? "Leave blank to build it from the name." : "Changing it breaks old links to this product."}
            </p>
            {err("slug")}
          </div>
        </div>
        <div className="adm-field">
          <label htmlFor={fid("categoryId")}>Category</label>
          <select {...a11y("categoryId")} value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">Choose a category</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.isActive}>
                {c.name}
                {c.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
          {err("categoryId")}
        </div>
        <div className="adm-field">
          <label htmlFor={fid("description")}>Description</label>
          <textarea {...a11y("description")} rows={5} value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={5000} />
          {err("description")}
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Price</legend>
        <div className="adm-grid3">
          <div className="adm-field">
            <label htmlFor={fid("price")}>Price (₹)</label>
            <input {...a11y("price")} inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} placeholder="2499.00" />
            {err("price")}
          </div>
          <div className="adm-field">
            <label htmlFor={fid("discountType")}>Discount</label>
            <select
              id={fid("discountType")}
              value={v.discountType}
              onChange={(e) => {
                set("discountType", e.target.value as Values["discountType"]);
                if (e.target.value === "none") set("discountValue", "");
              }}
            >
              <option value="none">No discount</option>
              <option value="percent">Percent off</option>
              <option value="fixed">Amount off (₹)</option>
            </select>
          </div>
          {v.discountType !== "none" ? (
            <div className="adm-field">
              <label htmlFor={fid("discount.value")}>{v.discountType === "percent" ? "Percent off" : "Amount off (₹)"}</label>
              <input
                {...a11y("discount.value")}
                inputMode="decimal"
                value={v.discountValue}
                onChange={(e) => set("discountValue", e.target.value)}
                placeholder={v.discountType === "percent" ? "15" : "500.00"}
              />
              {err("discount.value")}
            </div>
          ) : null}
        </div>
        {product ? <p className="adm-field__hint">The final price is calculated by the server when you save.</p> : null}
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Stock and visibility</legend>
        <div className="adm-grid3">
          {mode === "create" ? (
            <div className="adm-field">
              <label htmlFor={fid("stock")}>Opening stock</label>
              <input {...a11y("stock", true)} inputMode="numeric" value={v.stock} onChange={(e) => set("stock", e.target.value)} />
              <p className="adm-field__hint" id={`${fid("stock")}-hint`}>
                Later changes go through Inventory, with a reason.
              </p>
              {err("stock")}
            </div>
          ) : (
            <div className="adm-field">
              <span className="adm-field__label">Stock</span>
              <p className="adm-field__static">
                {product?.stockQuantity} units <span className="adm-sub">Adjust in the stock panel</span>
              </p>
            </div>
          )}
          <div className="adm-field">
            <label htmlFor={fid("lowStock")}>
              Low-stock alert <span className="adm-optional">optional</span>
            </label>
            <input {...a11y("lowStock", true)} inputMode="numeric" value={v.lowStock} onChange={(e) => set("lowStock", e.target.value)} />
            <p className="adm-field__hint" id={`${fid("lowStock")}-hint`}>
              Blank uses the store default.
            </p>
            {err("lowStock")}
          </div>
          <div className="adm-field">
            <label htmlFor={fid("status")}>Status</label>
            <select {...a11y("status", true)} value={v.status} onChange={(e) => set("status", e.target.value as ProductStatus)}>
              <option value="inactive">Inactive (hidden)</option>
              <option value="active">Active (on sale)</option>
              {mode === "edit" ? <option value="archived">Archived</option> : null}
            </select>
            <p className="adm-field__hint" id={`${fid("status")}-hint`}>
              Active products need at least one image.
            </p>
            {err("status")}
          </div>
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Specifications</legend>
        {v.specs.length === 0 ? <p className="adm-field__hint">Material, care, fit and similar details.</p> : null}
        {v.specs.map((s, i) => (
          <div className="adm-spec" key={i}>
            <div className="adm-field">
              <label htmlFor={fid(`specs.${i}`)} className="sr-only">
                Specification {i + 1} name
              </label>
              <input
                id={fid(`specs.${i}`)}
                aria-invalid={errors[`specs.${i}`] ? true : undefined}
                placeholder="Material"
                value={s.key}
                maxLength={60}
                onChange={(e) => set("specs", v.specs.map((x, n) => (n === i ? { ...x, key: e.target.value } : x)))}
              />
            </div>
            <div className="adm-field">
              <label htmlFor={fid(`specs.${i}.v`)} className="sr-only">
                Specification {i + 1} value
              </label>
              <input
                id={fid(`specs.${i}.v`)}
                placeholder="Silk"
                value={s.value}
                maxLength={255}
                onChange={(e) => set("specs", v.specs.map((x, n) => (n === i ? { ...x, value: e.target.value } : x)))}
              />
            </div>
            <button
              type="button"
              className="adm-btn adm-btn--ghost"
              onClick={() => set("specs", v.specs.filter((_, n) => n !== i))}
              aria-label={`Remove specification ${s.key || i + 1}`}
            >
              Remove
            </button>
            {errors[`specs.${i}`] ? <p className="adm-field__error adm-spec__error">{errors[`specs.${i}`]}</p> : null}
          </div>
        ))}
        {v.specs.length < 30 ? (
          <button type="button" className="adm-btn adm-btn--secondary" onClick={() => set("specs", [...v.specs, { key: "", value: "" }])}>
            Add specification
          </button>
        ) : null}
      </fieldset>

      <div className="adm-form__actions">
        <button type="submit" className="adm-btn adm-btn--primary" aria-disabled={saving}>
          {saving ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
        </button>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
