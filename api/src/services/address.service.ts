import { z } from "zod";
import { ApiError } from "../middleware/error.js";
import { addressRepository, type AddressData } from "../repositories/address.repository.js";

/**
 * Address book rules (REQUIREMENTS §2.12, API_CONTRACT §3, DATABASE_SCHEMA §2.8):
 * - USER-only; every operation is scoped to the authenticated owner
 * - the first address becomes the default automatically
 * - exactly one default whenever the user has any address
 * - setting a default clears the previous one (same transaction)
 * - deleting a non-default address: plain delete
 * - deleting the default while other addresses exist requires choosing the
 *   replacement (`new_default_id`); otherwise 409 default_reassignment_required
 * - deleting the only address is allowed (leaves an empty book, no default)
 * - ownership / default are never client-assignable (strict schemas)
 */

// ---------- validation ----------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Trim + collapse internal whitespace; reject control characters. */
function text(label: string, min: number, max: number) {
  return z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
        .max(max, `${label} must be at most ${max} characters`)
        .refine((v) => !CONTROL_CHARS.test(v), `${label} contains invalid characters`),
    );
}

const phone = z
  .string({ required_error: "Phone is required", invalid_type_error: "Phone must be text" })
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Phone is required")
      .max(24, "Phone must be at most 24 characters")
      .regex(/^\+?[0-9][0-9 ()-]*[0-9]$/, "Enter a phone number using digits, spaces, +, - or ()")
      .refine((v) => {
        const digits = v.replace(/\D/g, "").length;
        return digits >= 7 && digits <= 15; // E.164 upper bound
      }, "Phone must contain 7 to 15 digits"),
  );

const countryCode = z
  .string({ required_error: "Country is required", invalid_type_error: "Country must be text" })
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, "Country must be a 2-letter ISO code, e.g. IN"));

const postalCode = z
  .string({ required_error: "Postal code is required", invalid_type_error: "Postal code must be text" })
  .transform((v) => v.trim().toUpperCase().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(3, "Postal code must be at least 3 characters")
      .max(16, "Postal code must be at most 16 characters")
      .regex(/^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$/, "Postal code may use letters, digits, spaces and -"),
  );

const line2 = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v == null ? null : v.trim().replace(/\s+/g, " ")))
  .pipe(
    z
      .string()
      .max(120, "Address line 2 must be at most 120 characters")
      .refine((v) => !CONTROL_CHARS.test(v), "Address line 2 contains invalid characters")
      .nullable()
      .transform((v) => (v === "" ? null : v)),
  );

const fields = {
  receiver_name: text("Full name", 2, 120),
  phone,
  line1: text("Address line 1", 1, 120),
  line2,
  city: text("City", 1, 80),
  state: text("State", 1, 80),
  postal_code: postalCode,
  country_code: countryCode,
};

/** India PIN codes are exactly 6 digits (store currency/market is INR). */
function checkCountryPostal(
  v: { country_code?: string; postal_code?: string },
  ctx: z.RefinementCtx,
): void {
  if (v.country_code === "IN" && v.postal_code !== undefined && !/^\d{6}$/.test(v.postal_code)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["postal_code"],
      message: "Indian PIN codes are 6 digits",
    });
  }
}

// .strict(): user_id, is_default, id … are rejected, never mass-assigned.
export const createAddressSchema = z.object(fields).strict().superRefine(checkCountryPostal);

export const updateAddressSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update")
  .superRefine(checkCountryPostal);

export const deleteAddressQuerySchema = z
  .object({
    new_default_id: z
      .string()
      .regex(/^\d{1,18}$/, "Invalid address id")
      .transform((v) => BigInt(v))
      .optional(),
  })
  .strict();

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export function parseAddressId(raw: unknown): bigint {
  const s = typeof raw === "string" ? raw : "";
  if (!/^\d{1,18}$/.test(s)) {
    throw new ApiError(400, "validation_failed", "Invalid address id");
  }
  return BigInt(s);
}

// ---------- wire shape ----------

export interface AddressView {
  id: string;
  receiverName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressListResponse {
  items: AddressView[];
}

type AddressRow = Awaited<ReturnType<typeof addressRepository.listForUser>>[number];

function toView(a: AddressRow): AddressView {
  return {
    id: a.id.toString(),
    receiverName: a.receiverName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    isDefault: a.isDefault,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function toData(input: Partial<CreateAddressInput>): Partial<AddressData> {
  const data: Partial<AddressData> = {};
  if (input.receiver_name !== undefined) data.receiverName = input.receiver_name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.line1 !== undefined) data.line1 = input.line1;
  if (input.line2 !== undefined) data.line2 = input.line2;
  if (input.city !== undefined) data.city = input.city;
  if (input.state !== undefined) data.state = input.state;
  if (input.postal_code !== undefined) data.postalCode = input.postal_code;
  if (input.country_code !== undefined) data.countryCode = input.country_code;
  return data;
}

const notFound = () => new ApiError(404, "unknown_resource", "Address not found");

// ---------- service ----------

export const addressService = {
  async list(userId: bigint): Promise<AddressListResponse> {
    const rows = await addressRepository.listForUser(userId);
    return { items: rows.map(toView) };
  },

  async create(userId: bigint, input: CreateAddressInput): Promise<AddressView> {
    const created = await addressRepository.inUserTransaction(userId, async (tx) => {
      const existing = await addressRepository.countForUser(userId, tx);
      return addressRepository.create(userId, toData(input) as AddressData, existing === 0, tx);
    });
    return toView(created);
  },

  async update(userId: bigint, id: bigint, input: UpdateAddressInput): Promise<AddressView> {
    const data = toData(input);
    // An edit to country only must still satisfy the IN PIN rule against the
    // stored postal code (and vice versa) — validate the merged result.
    if (data.countryCode !== undefined || data.postalCode !== undefined) {
      const current = await addressRepository.findOwned(id, userId);
      if (!current) throw notFound();
      const country = data.countryCode ?? current.countryCode;
      const postal = data.postalCode ?? current.postalCode;
      if (country === "IN" && !/^\d{6}$/.test(postal)) {
        throw new ApiError(400, "validation_failed", "Indian PIN codes are 6 digits");
      }
    }
    const touched = await addressRepository.update(id, userId, data);
    if (touched === 0) throw notFound();
    const row = await addressRepository.findOwned(id, userId);
    if (!row) throw notFound();
    return toView(row);
  },

  async setDefault(userId: bigint, id: bigint): Promise<AddressListResponse> {
    await addressRepository.inUserTransaction(userId, async (tx) => {
      const target = await addressRepository.findOwned(id, userId, tx);
      if (!target) throw notFound();
      if (target.isDefault) return;
      await addressRepository.clearDefault(userId, tx);
      await addressRepository.markDefault(id, userId, tx);
    });
    return this.list(userId);
  },

  async remove(userId: bigint, id: bigint, newDefaultId?: bigint): Promise<AddressListResponse> {
    await addressRepository.inUserTransaction(userId, async (tx) => {
      const target = await addressRepository.findOwned(id, userId, tx);
      if (!target) throw notFound();

      if (!target.isDefault) {
        // new_default_id is meaningless here; ignore it rather than move the default.
        await addressRepository.delete(id, userId, tx);
        return;
      }

      const others = (await addressRepository.countForUser(userId, tx)) - 1;
      if (others === 0) {
        // Last address: deleting it leaves an empty book with no default.
        await addressRepository.delete(id, userId, tx);
        return;
      }

      if (newDefaultId === undefined) {
        throw new ApiError(
          409,
          "default_reassignment_required",
          "Choose another address as your default before deleting this one.",
        );
      }
      if (newDefaultId === id) {
        throw new ApiError(400, "validation_failed", "The new default must be a different address.");
      }
      const replacement = await addressRepository.findOwned(newDefaultId, userId, tx);
      if (!replacement) throw notFound();

      await addressRepository.delete(id, userId, tx);
      await addressRepository.markDefault(newDefaultId, userId, tx);
    });
    return this.list(userId);
  },
};
