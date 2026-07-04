import type { Address, AddressInput } from "../api/customer";

/**
 * Client-side address validation — convenience only; the server re-validates
 * everything (REQUIREMENTS §12.1). Mirrors the API's rules so shoppers get
 * inline messages before a round-trip.
 */

export type AddressField = keyof AddressInput;
export type FieldErrors = Partial<Record<AddressField, string>>;

export interface AddressDraft {
  receiver_name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
}

export const EMPTY_DRAFT: AddressDraft = {
  receiver_name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postal_code: "",
  country_code: "IN",
};

export function draftFrom(a: Address): AddressDraft {
  return {
    receiver_name: a.receiverName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? "",
    city: a.city,
    state: a.state,
    postal_code: a.postalCode,
    country_code: a.countryCode,
  };
}

const squash = (v: string) => v.trim().replace(/\s+/g, " ");

export function toInput(d: AddressDraft): AddressInput {
  const line2 = squash(d.line2);
  return {
    receiver_name: squash(d.receiver_name),
    phone: squash(d.phone),
    line1: squash(d.line1),
    line2: line2 === "" ? null : line2,
    city: squash(d.city),
    state: squash(d.state),
    postal_code: squash(d.postal_code).toUpperCase(),
    country_code: d.country_code.trim().toUpperCase(),
  };
}

export function validateDraft(d: AddressDraft): FieldErrors {
  const v = toInput(d);
  const e: FieldErrors = {};

  if (v.receiver_name.length < 2) e.receiver_name = "Enter the full name of the person receiving the order.";
  else if (v.receiver_name.length > 120) e.receiver_name = "Keep the name under 120 characters.";

  const digits = v.phone.replace(/\D/g, "").length;
  if (v.phone === "") e.phone = "Enter a phone number for delivery updates.";
  else if (!/^\+?[0-9][0-9 ()-]*[0-9]$/.test(v.phone) || digits < 7 || digits > 15)
    e.phone = "Use 7 to 15 digits; spaces, +, - and brackets are fine.";

  if (v.line1 === "") e.line1 = "Enter the street address.";
  else if (v.line1.length > 120) e.line1 = "Keep this line under 120 characters.";
  if (v.line2 && v.line2.length > 120) e.line2 = "Keep this line under 120 characters.";

  if (v.city === "") e.city = "Enter the city.";
  else if (v.city.length > 80) e.city = "Keep the city under 80 characters.";
  if (v.state === "") e.state = "Enter the state or region.";
  else if (v.state.length > 80) e.state = "Keep the state under 80 characters.";

  if (!/^[A-Z]{2}$/.test(v.country_code)) e.country_code = "Choose a country.";

  if (v.postal_code === "") e.postal_code = "Enter the postal code.";
  else if (v.country_code === "IN" && !/^\d{6}$/.test(v.postal_code))
    e.postal_code = "Indian PIN codes are 6 digits.";
  else if (!/^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$/.test(v.postal_code) || v.postal_code.length < 3 || v.postal_code.length > 16)
    e.postal_code = "Use 3 to 16 letters, digits, spaces or -.";

  return e;
}

/** Countries offered in the form. The API accepts any ISO alpha-2 code. */
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "IN", name: "India" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SG", name: "Singapore" },
  { code: "US", name: "United States" },
];

export function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/** Map a server validation_failed envelope's issue paths back to fields. */
export function fieldErrorsFromServer(details: unknown): FieldErrors {
  const e: FieldErrors = {};
  if (!Array.isArray(details)) return e;
  for (const issue of details) {
    const path = (issue as { path?: unknown[] }).path;
    const message = (issue as { message?: unknown }).message;
    const field = Array.isArray(path) ? path[0] : undefined;
    if (typeof field === "string" && typeof message === "string" && field in EMPTY_DRAFT) {
      e[field as AddressField] ??= message;
    }
  }
  return e;
}
