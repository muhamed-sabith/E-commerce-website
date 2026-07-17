import { useId, useState, type FormEvent } from "react";
import { adminApi, SORT_LABEL, type SettingsInput, type SortKey, type StoreSettings } from "../api/admin";
import { ApiRequestError } from "../api/client";
import { formatINR } from "../lib/format";
import { dateTimeFmt, fieldErrors, Loading, LoadError, PageHeader, useLoad } from "./ui";

/**
 * Store settings (REQUIREMENTS §3.11). Operational values only; the brand
 * (HEYRAH, "Wings of Style", logo, colours) and the currency (INR) are
 * fixed and shown read-only so nobody wonders where to change them.
 */
export function AdminSettingsPage() {
  const { state, reload, set } = useLoad(() => adminApi.getSettings(), []);
  return (
    <div className="adm-page adm-page--narrow">
      <PageHeader title="Settings" lede="Changes apply to the store immediately." />
      {state.kind === "loading" ? <Loading label="Loading settings…" /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={() => void reload()} /> : null}
      {state.kind === "ready" ? <SettingsForm data={state.data} onSaved={set} /> : null}
    </div>
  );
}

const FIELD: Record<string, string> = {
  low_stock_threshold: "lowStock",
  shipping_flat_rate: "flat",
  shipping_free_threshold: "free",
  default_sort: "sort",
  page_size: "pageSize",
};

function SettingsForm({ data, onSaved }: { data: StoreSettings; onSaved: (d: StoreSettings) => void }) {
  const uid = useId();
  const s = data.settings;
  const [v, setV] = useState({
    lowStock: String(s.lowStockThreshold),
    flat: s.shippingFlatRate.amount,
    free: s.shippingFreeThreshold.amount,
    sort: s.defaultSort as SortKey,
    pageSize: String(s.pageSize),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);

  const change = (k: keyof typeof v, value: string) => {
    setV((cur) => ({ ...cur, [k]: value }));
    setErrors((cur) => {
      const next = { ...cur };
      delete next[k];
      return next;
    });
    setSaved("");
  };

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    const money = /^\d{1,8}(\.\d{1,2})?$/;
    if (!/^\d{1,4}$/.test(v.lowStock.trim()) || Number(v.lowStock) > 1000) e.lowStock = "Enter a whole number from 0 to 1,000";
    if (!money.test(v.flat.trim())) e.flat = "Enter an amount like 99.00";
    if (!money.test(v.free.trim())) e.free = "Enter an amount like 2999.00";
    if (!/^\d{1,2}$/.test(v.pageSize.trim()) || Number(v.pageSize) < 4 || Number(v.pageSize) > 48) e.pageSize = "Enter a number from 4 to 48";
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (saving) return;
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      document.getElementById(`${uid}-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    const body: SettingsInput = {
      low_stock_threshold: Number(v.lowStock),
      shipping_flat_rate: v.flat.trim(),
      shipping_free_threshold: v.free.trim(),
      default_sort: v.sort,
      page_size: Number(v.pageSize),
    };
    setSaving(true);
    try {
      const next = await adminApi.putSettings(body);
      onSaved(next);
      setSaved("Settings saved.");
    } catch (err) {
      const mapped: Record<string, string> = {};
      for (const [k, m] of Object.entries(fieldErrors(err))) mapped[FIELD[k] ?? k] = m;
      setErrors(mapped);
      setFormError(err instanceof ApiRequestError ? err.message : "Couldn't save settings. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const a11y = (k: string, hint = true) => ({
    id: `${uid}-${k}`,
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": [hint ? `${uid}-${k}-h` : "", errors[k] ? `${uid}-${k}-e` : ""].filter(Boolean).join(" ") || undefined,
  });
  const err = (k: string) =>
    errors[k] ? (
      <p className="adm-field__error" id={`${uid}-${k}-e`}>
        {errors[k]}
      </p>
    ) : null;

  return (
    <>
      <form className="adm-form" onSubmit={(e) => void submit(e)} noValidate aria-busy={saving}>
        {formError ? (
          <p className="adm-form__error" role="alert">
            {formError}
          </p>
        ) : null}

        <fieldset className="adm-fieldset">
          <legend>Shipping</legend>
          <p className="adm-field__hint">
            Current values are placeholders until the final shipping prices are decided. Changes apply to new checkouts; placed orders keep what they were charged.
          </p>
          <div className="adm-grid2">
            <div className="adm-field">
              <label htmlFor={`${uid}-flat`}>Flat shipping (₹)</label>
              <input {...a11y("flat")} inputMode="decimal" value={v.flat} onChange={(e) => change("flat", e.target.value)} />
              <p className="adm-field__hint" id={`${uid}-flat-h`}>
                Charged on orders below the free-shipping amount.
              </p>
              {err("flat")}
            </div>
            <div className="adm-field">
              <label htmlFor={`${uid}-free`}>Free shipping from (₹)</label>
              <input {...a11y("free")} inputMode="decimal" value={v.free} onChange={(e) => change("free", e.target.value)} />
              <p className="adm-field__hint" id={`${uid}-free-h`}>
                After discounts. Use 0 to make all shipping free.
              </p>
              {err("free")}
            </div>
          </div>
        </fieldset>

        <fieldset className="adm-fieldset">
          <legend>Inventory</legend>
          <div className="adm-field">
            <label htmlFor={`${uid}-lowStock`}>Low-stock alert (units)</label>
            <input {...a11y("lowStock")} inputMode="numeric" value={v.lowStock} onChange={(e) => change("lowStock", e.target.value)} />
            <p className="adm-field__hint" id={`${uid}-lowStock-h`}>
              Products at or below this count are flagged. A product can set its own.
            </p>
            {err("lowStock")}
          </div>
        </fieldset>

        <fieldset className="adm-fieldset">
          <legend>Catalog</legend>
          <div className="adm-grid2">
            <div className="adm-field">
              <label htmlFor={`${uid}-sort`}>Default sort</label>
              <select {...a11y("sort")} value={v.sort} onChange={(e) => change("sort", e.target.value)}>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
              </select>
              <p className="adm-field__hint" id={`${uid}-sort-h`}>
                Used when a shopper hasn't picked one.
              </p>
              {err("sort")}
            </div>
            <div className="adm-field">
              <label htmlFor={`${uid}-pageSize`}>Products per page</label>
              <input {...a11y("pageSize")} inputMode="numeric" value={v.pageSize} onChange={(e) => change("pageSize", e.target.value)} />
              <p className="adm-field__hint" id={`${uid}-pageSize-h`}>
                From 4 to 48.
              </p>
              {err("pageSize")}
            </div>
          </div>
        </fieldset>

        <div className="adm-form__actions">
          <button type="submit" className="adm-btn adm-btn--primary" aria-disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <p className="adm-flash adm-flash--inline" role="status" aria-live="polite">
            {saved}
          </p>
        </div>
        <p className="adm-sub">
          {s.isDefault ? "Using the store defaults." : s.updatedAt ? `Last changed ${dateTimeFmt.format(new Date(s.updatedAt))}.` : null} Shoppers currently see{" "}
          {formatINR(s.shippingFlatRate.amount)} shipping, free from {formatINR(s.shippingFreeThreshold.amount)}.
        </p>
      </form>

      <section className="adm-panel adm-panel--quiet" aria-labelledby={`${uid}-fixed`}>
        <h2 id={`${uid}-fixed`}>Fixed for the brand</h2>
        <dl className="adm-defs">
          <div>
            <dt>Store name</dt>
            <dd>{data.fixed.brand.name}</dd>
          </div>
          <div>
            <dt>Tagline</dt>
            <dd>{data.fixed.brand.tagline}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>Indian rupee ({data.fixed.currency})</dd>
          </div>
        </dl>
        <p className="adm-sub">Name, tagline, logo, colours, and currency are part of the HEYRAH identity and can't be changed here.</p>
      </section>
    </>
  );
}
