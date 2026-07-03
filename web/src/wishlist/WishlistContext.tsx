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
import { wishlistApi, type Wishlist } from "../api/customer";
import { useAuth } from "../auth/AuthContext";

/**
 * Wishlist UI state: a mirror of the last server answer for the signed-in
 * user. Nothing persisted client-side; mutations return the recomputed
 * list, failures re-fetch. Guests have no wishlist (status "guest").
 */

type Status = "guest" | "loading" | "ready" | "error";

interface WishlistContextValue {
  wishlist: Wishlist | null;
  status: Status;
  /** Product ids with a save/remove in flight. */
  pending: ReadonlySet<string>;
  /** Latest polite announcement (saved/removed) for the shell live region. */
  announcement: string;
  isSaved: (productId: string) => boolean;
  refresh: () => Promise<void>;
  save: (productId: string) => Promise<Wishlist>;
  remove: (productId: string) => Promise<Wishlist>;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth();
  const [wishlist, setWishlist] = useState<Wishlist | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await wishlistApi.get();
      if (mine === seq.current) {
        setWishlist(next);
        setStatus("ready");
      }
    } catch {
      if (mine === seq.current) setStatus("error");
    }
  }, []);

  const userId = restoring ? undefined : (user?.id ?? null);
  useEffect(() => {
    if (userId === undefined) return;
    seq.current++;
    setWishlist(null);
    if (userId === null) {
      setStatus("guest");
      return;
    }
    setStatus("loading");
    void load();
  }, [userId, load]);

  const refresh = useCallback(async () => {
    setStatus((s) => (s === "error" ? "loading" : s));
    await load();
  }, [load]);

  const mark = useCallback((id: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const mutate = useCallback(
    async (productId: string, call: () => Promise<Wishlist>) => {
      mark(productId, true);
      const mine = ++seq.current;
      try {
        const next = await call();
        if (mine === seq.current) {
          setWishlist(next);
          setStatus("ready");
        }
        return next;
      } catch (err) {
        void load();
        throw err;
      } finally {
        mark(productId, false);
      }
    },
    [load, mark],
  );

  const nameOf = useCallback(
    (list: Wishlist | null, id: string) =>
      list?.items.find((i) => i.product.id === id)?.product.name ?? "Item",
    [],
  );

  const save = useCallback(
    async (productId: string) => {
      const next = await mutate(productId, () => wishlistApi.add(productId));
      setAnnouncement(`${nameOf(next, productId)} saved to your wishlist.`);
      return next;
    },
    [mutate, nameOf],
  );
  const remove = useCallback(
    async (productId: string) => {
      const name = nameOf(wishlist, productId);
      const next = await mutate(productId, () => wishlistApi.remove(productId));
      setAnnouncement(`${name} removed from your wishlist.`);
      return next;
    },
    [mutate, nameOf, wishlist],
  );

  const savedIds = useMemo(
    () => new Set(wishlist?.items.map((i) => i.product.id) ?? []),
    [wishlist],
  );
  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const value = useMemo(
    () => ({ wishlist, status, pending, announcement, isSaved, refresh, save, remove }),
    [wishlist, status, pending, announcement, isSaved, refresh, save, remove],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}
