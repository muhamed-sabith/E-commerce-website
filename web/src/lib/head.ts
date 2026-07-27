import { useEffect } from "react";

/**
 * Client-side head sync for SPA navigation (ARCHITECTURE §2). The first
 * load already carries server-injected tags (server/serve.mjs); this keeps
 * title, description, canonical and robots right as the shopper moves
 * between routes. Values mirror the server's rules (api seo.service).
 */

export const SITE_ORIGIN: string =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, "") ??
  (typeof window !== "undefined" ? window.location.origin : "");

export interface HeadSpec {
  title: string;
  description?: string;
  /** Path for the canonical URL; omit for pages that shouldn't have one. */
  canonicalPath?: string;
  robots?: "index, follow" | "noindex, follow" | "noindex, nofollow";
}

function setMeta(selector: string, attr: "name" | "property", key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (content === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

export function applyHead(spec: HeadSpec) {
  document.title = spec.title;
  if (spec.description) {
    setMeta('meta[name="description"]', "name", "description", spec.description);
    setMeta('meta[property="og:description"]', "property", "og:description", spec.description);
  }
  setMeta('meta[property="og:title"]', "property", "og:title", spec.title);
  setMeta('meta[name="robots"]', "name", "robots", spec.robots ?? "index, follow");
  const canonical = spec.canonicalPath ? `${SITE_ORIGIN}${spec.canonicalPath}` : null;
  setCanonical(canonical);
  setMeta('meta[property="og:url"]', "property", "og:url", canonical);
}

/** Apply on mount and whenever the spec changes. */
export function useHead(spec: HeadSpec | null) {
  const key = spec ? JSON.stringify(spec) : "";
  useEffect(() => {
    if (key) applyHead(JSON.parse(key) as HeadSpec);
  }, [key]);
}

export const PRIVATE_HEAD = (title: string): HeadSpec => ({ title: `${title} | HEYRAH`, robots: "noindex, nofollow" });
