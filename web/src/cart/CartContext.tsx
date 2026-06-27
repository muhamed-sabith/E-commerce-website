import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiRequestError, ensureCsrf } from "../api/client";
import { cartApi, type Cart, type MergeReport } from "../api/cart";
import { useAuth } from "../auth/AuthContext";

/**
 * Cart UI state (ARCHITECTURE §2): a thin mirror of the LAST server answer,
 * never an authority. Nothing is persisted client-side; every mutation
 * returns the server-recomputed cart, and failures trigger a re-fetch so the
 * UI reconciles with the truth. The cart re-loads whenever the session
 * identity changes (guest ↔ user), which is how the post-login merge shows.
 */

type CartStatus = "loading" | "ready" | "error";

interface CartContextValue {
  cart: Cart | null;
  status: CartStatus;
  /** Line ids with a mutation in flight (per-line busy state). */
  pendingLines: ReadonlySet<string>;
  /** Most recent polite announcement for the shared live region. */
  announcement: string;
  mergeReport: MergeReport | null;
  refresh: () => Promise<void>;
  addItem: (productId: string, qty: number, productName?: string) => Promise<Cart>;
  updateQuantity: (lineId: string, qty: number) => Promise<Cart>;
  removeItem: (lineId: string) => Promise<Cart>;
  showMergeReport: (report: MergeReport | null) => void;
  dismissMergeReport: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * A missing/expired session answers 401 on cart routes. Re-bootstrap the
 * guest session once and retry; any other failure surfaces to the caller.
 */
async function withSession<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      await ensureCsrf();
      return call();
    }
    throw err;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth();
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState<CartStatus>("loading");
  const [pendingLines, setPendingLines] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [mergeReport, setMergeReport] = useState<MergeReport | null>(null);
  // Guards against an older response landing after a newer one.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const next = await withSession(() => cartApi.get());
      if (seq === requestSeq.current) {
        setCart(next);
        setStatus("ready");
      }
    } catch {
      if (seq === requestSeq.current) setStatus("error");
    }
  }, []);

  const refresh = useCallback(async () => {
    setStatus((s) => (s === "error" ? "loading" : s));
    await load();
  }, [load]);

  // Identity change (restore, login, logout) → the server cart changes too.
  const identity = restoring ? null : (user?.id ?? "guest");
  useEffect(() => {
    if (identity === null) return;
    // Signing out ends the merged bag's story; don't leave a stale notice.
    if (identity === "guest") setMergeReport(null);
    // A different identity owns a different server cart: drop the previous
    // answer so no stale count or lines show while the new one loads.
    setCart(null);
    setStatus("loading");
    void load();
  }, [identity, load]);

  const setPending = useCallback((lineId: string, on: boolean) => {
    setPendingLines((prev) => {
      const next = new Set(prev);
      if (on) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }, []);

  /** Apply a server answer; on failure re-fetch so stale UI never lingers. */
  const mutate = useCallback(
    async (call: () => Promise<Cart>, message: (c: Cart) => string): Promise<Cart> => {
      const seq = ++requestSeq.current;
      try {
        const next = await withSession(call);
        if (seq === requestSeq.current) {
          setCart(next);
          setStatus("ready");
        }
        setAnnouncement(message(next));
        return next;
      } catch (err) {
        void load();
        throw err;
      }
    },
    [load],
  );

  const addItem = useCallback(
    (productId: string, qty: number, productName?: string) =>
      mutate(
        () => cartApi.addItem(productId, qty),
        (c) =>
          `${productName ?? "Item"} added to your bag. ${c.itemCount} ${
            c.itemCount === 1 ? "item" : "items"
          } in bag.`,
      ),
    [mutate],
  );

  const updateQuantity = useCallback(
    async (lineId: string, qty: number) => {
      setPending(lineId, true);
      try {
        return await mutate(
          () => cartApi.updateItem(lineId, qty),
          (c) => {
            const line = c.items.find((l) => l.id === lineId);
            return line
              ? `${line.product.name} quantity updated to ${line.quantity}.`
              : "Item removed from your bag.";
          },
        );
      } finally {
        setPending(lineId, false);
      }
    },
    [mutate, setPending],
  );

  const removeItem = useCallback(
    async (lineId: string) => {
      const name = cart?.items.find((l) => l.id === lineId)?.product.name ?? "Item";
      setPending(lineId, true);
      try {
        return await mutate(
          () => cartApi.removeItem(lineId),
          () => `${name} removed from your bag.`,
        );
      } finally {
        setPending(lineId, false);
      }
    },
    [cart, mutate, setPending],
  );

  const showMergeReport = useCallback((report: MergeReport | null) => {
    setMergeReport(report);
  }, []);

  const dismissMergeReport = useCallback(() => setMergeReport(null), []);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      status,
      pendingLines,
      announcement,
      mergeReport,
      refresh,
      addItem,
      updateQuantity,
      removeItem,
      showMergeReport,
      dismissMergeReport,
    }),
    [
      cart,
      status,
      pendingLines,
      announcement,
      mergeReport,
      refresh,
      addItem,
      updateQuantity,
      removeItem,
      showMergeReport,
      dismissMergeReport,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}
