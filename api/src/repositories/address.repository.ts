import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Address data access (ARCHITECTURE §3). Every query carries the owner's
 * user id in its WHERE clause — ownership is part of the query, not a
 * post-check. Multi-step default changes run inside `inUserTransaction`,
 * which row-locks the user so concurrent address writes for the same user
 * serialize (the partial unique index is the final backstop).
 */

export type Tx = Prisma.TransactionClient;

export interface AddressData {
  receiverName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
}

export const addressRepository = {
  listForUser(userId: bigint, db: Tx | typeof prisma = prisma) {
    return db.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  },

  findOwned(id: bigint, userId: bigint, db: Tx | typeof prisma = prisma) {
    return db.address.findFirst({ where: { id, userId } });
  },

  countForUser(userId: bigint, db: Tx) {
    return db.address.count({ where: { userId } });
  },

  create(userId: bigint, data: AddressData, isDefault: boolean, db: Tx) {
    return db.address.create({ data: { ...data, userId, isDefault } });
  },

  /** Update only the owner's row; returns the number of rows touched. */
  async update(id: bigint, userId: bigint, data: Partial<AddressData>, db: Tx | typeof prisma = prisma) {
    const { count } = await db.address.updateMany({ where: { id, userId }, data });
    return count;
  },

  clearDefault(userId: bigint, db: Tx) {
    return db.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  },

  async markDefault(id: bigint, userId: bigint, db: Tx) {
    const { count } = await db.address.updateMany({
      where: { id, userId },
      data: { isDefault: true },
    });
    return count;
  },

  async delete(id: bigint, userId: bigint, db: Tx) {
    const { count } = await db.address.deleteMany({ where: { id, userId } });
    return count;
  },

  /** Run `fn` in one transaction holding a row lock on the user. */
  inUserTransaction<T>(userId: bigint, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      return fn(tx);
    });
  },
};
