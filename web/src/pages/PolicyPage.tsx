import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import { useHead } from "../lib/head";
import "./help.css";

/**
 * Policy and contact pages. The words come from the business (admin →
 * Pages); until a page is published it says so plainly instead of showing
 * invented policy text. Plain text only: paragraphs split on blank lines,
 * rendered as text (React escapes it).
 */

export type PolicySlug = "privacy" | "terms" | "returns" | "shipping" | "contact";

interface PageData {
  slug: PolicySlug;
  title: string;
  published: boolean;
  body: string | null;
  updatedAt: string | null;
}

export const POLICY_PATH: Record<PolicySlug, string> = {
  privacy: "/privacy",
  terms: "/terms",
  returns: "/returns",
  shipping: "/shipping-policy",
  contact: "/contact",
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });

export function PolicyPage({ slug }: { slug: PolicySlug }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; page: PageData }>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    fetch(`${API_BASE_URL}/api/v1/pages/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<{ page: PageData }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setState({ kind: "ready", page: d.page }))
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [slug]);

  const page = state.kind === "ready" ? state.page : null;
  useHead(
    page
      ? {
          title: `${page.title} | HEYRAH`,
          description: page.body ? page.body.replace(/\s+/g, " ").slice(0, 155) : `${page.title} for HEYRAH.`,
          canonicalPath: page.published ? POLICY_PATH[slug] : undefined,
          robots: page.published ? "index, follow" : "noindex, follow",
        }
      : null,
  );

  return (
    <main className="help">
      <div className="help__inner">
        {state.kind === "loading" ? (
          <p role="status" className="help__pending">
            Loading…
          </p>
        ) : null}
        {state.kind === "error" ? (
          <>
            <h1>This page couldn't load</h1>
            <p>Check your connection and try again.</p>
          </>
        ) : null}
        {page ? (
          <>
            <h1>{page.title}</h1>
            {page.published && page.body ? (
              <article data-testid="policy-body">
                {page.body.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className="help__para">
                    {para}
                  </p>
                ))}
                {page.updatedAt ? <p className="help__updated">Last updated {dateFmt.format(new Date(page.updatedAt))}</p> : null}
              </article>
            ) : (
              <p className="help__pending" data-testid="policy-pending">
                This page hasn't been published yet. It will appear here once HEYRAH confirms it. For how ordering, payment and shipping work today,
                see <Link to="/help">Help & information</Link>.
              </p>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
