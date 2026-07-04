import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiRequestError } from "../api/client";
import type { AddressInput } from "../api/customer";
import {
  COUNTRIES,
  fieldErrorsFromServer,
  toInput,
  validateDraft,
  type AddressDraft,
  type AddressField,
  type FieldErrors,
} from "./validation";

/**
 * Address form. Labels above inputs, required/optional marked in words,
 * errors validated on blur and on submit, each linked to its input via
 * aria-describedby + aria-invalid. Typed values are never cleared on error.
 * Focus moves to the first invalid field on a failed submit.
 */

interface FieldSpec {
  name: AddressField;
  label: string;
  autoComplete: string;
  optional?: boolean;
  inputMode?: "tel" | "text" | "numeric";
  type?: string;
  hint?: string;
  wide?: boolean;
}

const FIELDS: FieldSpec[] = [
  { name: "receiver_name", label: "Full name", autoComplete: "name", wide: true },
  {
    name: "phone",
    label: "Phone",
    autoComplete: "tel",
    type: "tel",
    inputMode: "tel",
    hint: "For delivery updates only.",
    wide: true,
  },
  { name: "line1", label: "Address line 1", autoComplete: "address-line1", hint: "House number and street.", wide: true },
  { name: "line2", label: "Address line 2", autoComplete: "address-line2", optional: true, hint: "Apartment, floor, landmark.", wide: true },
  { name: "city", label: "City", autoComplete: "address-level2" },
  { name: "state", label: "State", autoComplete: "address-level1" },
  { name: "postal_code", label: "Postal code", autoComplete: "postal-code" },
];

const ORDER: AddressField[] = [
  "receiver_name",
  "phone",
  "line1",
  "line2",
  "city",
  "state",
  "country_code",
  "postal_code",
];

export function AddressForm({
  initial,
  title,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: AddressDraft;
  title: string;
  submitLabel: string;
  onSubmit: (input: AddressInput) => Promise<void>;
  onCancel: () => void;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<AddressDraft>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<AddressField, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const idOf = (f: AddressField) => `${uid}-${f}`;

  function set(field: AddressField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    // Re-validate a field that already shows an error as the user fixes it.
    if (errors[field]) {
      const next = validateDraft({ ...draft, [field]: value });
      setErrors((e) => ({ ...e, [field]: next[field] }));
    }
  }

  function blur(field: AddressField) {
    setTouched((t) => ({ ...t, [field]: true }));
    const next = validateDraft(draft);
    setErrors((e) => ({ ...e, [field]: next[field] }));
  }

  function focusFirst(errs: FieldErrors) {
    const first = ORDER.find((f) => errs[f]);
    // useId values contain ":" — look up by id, not a CSS selector.
    if (first) document.getElementById(idOf(first))?.focus();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const errs = validateDraft(draft);
    setErrors(errs);
    setTouched(Object.fromEntries(ORDER.map((f) => [f, true])));
    if (Object.values(errs).some(Boolean)) {
      focusFirst(errs);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(toInput(draft));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "validation_failed") {
        const serverErrs = fieldErrorsFromServer(err.details);
        if (Object.keys(serverErrs).length > 0) {
          setErrors(serverErrs);
          focusFirst(serverErrs);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError(
          err instanceof ApiRequestError
            ? err.message
            : "Couldn't save this address. Check your connection and try again.",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  const describedBy = (f: AddressField, hint?: string) =>
    [hint ? `${idOf(f)}-hint` : "", errors[f] && touched[f] ? `${idOf(f)}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;

  const showError = (f: AddressField) => (errors[f] && touched[f] ? errors[f] : undefined);

  function renderField(spec: FieldSpec) {
    const err = showError(spec.name);
    return (
      <div key={spec.name} className={`addr-field${spec.wide ? " addr-field--wide" : ""}`}>
        <label htmlFor={idOf(spec.name)}>
          {spec.label}{" "}
          <span className="addr-field__req">{spec.optional ? "(optional)" : "(required)"}</span>
        </label>
        <input
          id={idOf(spec.name)}
          name={spec.name}
          type={spec.type ?? "text"}
          inputMode={spec.inputMode}
          autoComplete={spec.autoComplete}
          value={draft[spec.name]}
          required={!spec.optional}
          aria-invalid={err ? true : undefined}
          aria-describedby={describedBy(spec.name, spec.hint)}
          onChange={(e) => set(spec.name, e.target.value)}
          onBlur={() => blur(spec.name)}
        />
        {spec.hint ? (
          <p className="addr-field__hint" id={`${idOf(spec.name)}-hint`}>
            {spec.hint}
          </p>
        ) : null}
        {err ? (
          <p className="addr-field__error" id={`${idOf(spec.name)}-error`}>
            <span aria-hidden="true">! </span>
            {err}
          </p>
        ) : null}
      </div>
    );
  }

  const countryErr = showError("country_code");

  return (
    <section className="addr-form" aria-labelledby={`${uid}-title`}>
      <h2 className="addr-form__title" id={`${uid}-title`} tabIndex={-1} ref={titleRef}>
        {title}
      </h2>

      {formError ? (
        <div className="addr-form__alert" role="alert">
          {formError}
        </div>
      ) : null}

      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <div className="addr-form__grid">
          {FIELDS.filter((f) => f.name !== "postal_code").map(renderField)}

          <div className="addr-field">
            <label htmlFor={idOf("country_code")}>
              Country <span className="addr-field__req">(required)</span>
            </label>
            <select
              id={idOf("country_code")}
              name="country_code"
              autoComplete="country"
              value={draft.country_code}
              aria-invalid={countryErr ? true : undefined}
              aria-describedby={countryErr ? `${idOf("country_code")}-error` : undefined}
              onChange={(e) => set("country_code", e.target.value)}
              onBlur={() => blur("country_code")}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            {countryErr ? (
              <p className="addr-field__error" id={`${idOf("country_code")}-error`}>
                <span aria-hidden="true">! </span>
                {countryErr}
              </p>
            ) : null}
          </div>

          {renderField(FIELDS.find((f) => f.name === "postal_code")!)}
        </div>

        <div className="addr-form__actions">
          <button type="submit" className="addr-button" aria-disabled={saving}>
            {saving ? "Saving…" : submitLabel}
          </button>
          <button type="button" className="addr-button addr-button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
