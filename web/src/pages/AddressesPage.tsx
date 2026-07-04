import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import { addressApi, type Address, type AddressInput } from "../api/customer";
import { AddressForm } from "../addresses/AddressForm";
import { DeleteAddressDialog } from "../addresses/DeleteAddressDialog";
import { countryName, draftFrom, EMPTY_DRAFT } from "../addresses/validation";
import "../addresses/addresses.css";

/**
 * Address book (REQUIREMENTS §2.12). Server is the truth: every mutation
 * re-reads the list. Values render as text (React escapes), never as HTML.
 */

type Mode = { kind: "list" } | { kind: "add" } | { kind: "edit"; address: Address };

export function AddressesPage() {
  const [items, setItems] = useState<Address[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [deleting, setDeleting] = useState<Address | null>(null);
  const [message, setMessage] = useState("");
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /**
   * Where focus goes when the form closes. Stored as a selector, not an
   * element: the list unmounts while the form is open, so the original
   * button no longer exists when we come back.
   */
  const returnFocus = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await addressApi.list();
      setItems(res.items);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function backToList(note?: string) {
    setMode({ kind: "list" });
    if (note) setMessage(note);
    // After the list re-renders, return focus to the control the shopper
    // used (looked up fresh), or the page heading if it's gone.
    const selector = returnFocus.current;
    requestAnimationFrame(() => {
      const target = selector ? document.querySelector<HTMLElement>(selector) : null;
      (target ?? headingRef.current)?.focus();
    });
  }

  async function handleCreate(input: AddressInput) {
    const { address } = await addressApi.create(input);
    await load();
    returnFocus.current = null;
    backToList(
      address.isDefault
        ? "Address saved. It's your default address."
        : "Address saved.",
    );
  }

  async function handleUpdate(id: string, input: AddressInput) {
    await addressApi.update(id, input);
    await load();
    backToList("Address updated.");
  }

  async function handleSetDefault(a: Address) {
    setRowError(null);
    setBusyId(a.id);
    try {
      const res = await addressApi.setDefault(a.id);
      setItems(res.items);
      setMessage(`${a.receiverName}, ${a.city} is now your default address.`);
    } catch (err) {
      setRowError({
        id: a.id,
        text: err instanceof ApiRequestError ? err.message : "Couldn't change the default. Try again.",
      });
      void load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(target: Address, newDefaultId?: string) {
    const res = await addressApi.remove(target.id, newDefaultId);
    setItems(res.items);
    setDeleting(null);
    setMessage("Address deleted.");
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  const list = items ?? [];

  return (
    <main className="addr-page">
      <div className="addr-page__inner">
        <nav className="addr-page__crumbs" aria-label="Breadcrumb">
          <Link to="/account">Account</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">Addresses</span>
        </nav>
        <h1 className="addr-page__title" tabIndex={-1} ref={headingRef}>
          Addresses
        </h1>

        {/* present before any change so every save/delete is announced */}
        <p className="addr-page__status" role="status" data-testid="address-status">
          {message}
        </p>

        {mode.kind === "add" ? (
          <AddressForm
            key="add"
            initial={EMPTY_DRAFT}
            title="Add an address"
            submitLabel="Save address"
            onSubmit={handleCreate}
            onCancel={() => backToList()}
          />
        ) : mode.kind === "edit" ? (
          <AddressForm
            key={`edit-${mode.address.id}`}
            initial={draftFrom(mode.address)}
            title="Edit address"
            submitLabel="Save changes"
            onSubmit={(input) => handleUpdate(mode.address.id, input)}
            onCancel={() => backToList()}
          />
        ) : status === "loading" && !items ? (
          <div className="addr-page__skeleton" aria-hidden="true">
            <div />
            <div />
          </div>
        ) : status === "error" && !items ? (
          <div className="addr-page__state" role="alert">
            <p>We couldn't load your addresses. Check your connection and try again.</p>
            <button type="button" className="addr-button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="addr-page__empty" data-testid="empty-addresses">
            <p className="addr-page__empty-lede">No saved addresses yet.</p>
            <p>Add one now and it'll be ready when you check out.</p>
            <button
              type="button"
              className="addr-button"
              onClick={() => {
                setMessage("");
                setMode({ kind: "add" });
              }}
            >
              Add an address
            </button>
          </div>
        ) : (
          <>
            <div className="addr-page__toolbar">
              <p className="addr-page__count">
                {list.length} saved {list.length === 1 ? "address" : "addresses"}
              </p>
                <button
                type="button"
                className="addr-button"
                data-focus-key="add"
                onClick={() => {
                  returnFocus.current = '[data-focus-key="add"]';
                  setMessage("");
                  setMode({ kind: "add" });
                }}
              >
                Add an address
              </button>
            </div>
            <ul className="addr-list">
              {list.map((a) => (
                <li
                  key={a.id}
                  className={`addr-card${a.isDefault ? " is-default" : ""}`}
                  data-testid="address-card"
                  aria-busy={busyId === a.id}
                >
                  <div className="addr-card__head">
                    <h2 className="addr-card__name">{a.receiverName}</h2>
                    {a.isDefault ? (
                      <span className="addr-card__badge" data-testid="default-badge">
                        Default
                      </span>
                    ) : null}
                  </div>
                  <address className="addr-card__lines">
                    {a.line1}
                    {a.line2 ? (
                      <>
                        <br />
                        {a.line2}
                      </>
                    ) : null}
                    <br />
                    {a.city}, {a.state} {a.postalCode}
                    <br />
                    {countryName(a.countryCode)}
                    <br />
                    <span className="addr-card__phone">{a.phone}</span>
                  </address>
                  <div className="addr-card__actions">
                    <button
                      type="button"
                      className="addr-card__action"
                      data-focus-key={`edit-${a.id}`}
                      aria-label={`Edit address for ${a.receiverName}, ${a.city}`}
                      onClick={() => {
                        returnFocus.current = `[data-focus-key="edit-${a.id}"]`;
                        setMessage("");
                        setMode({ kind: "edit", address: a });
                      }}
                    >
                      Edit
                    </button>
                    {a.isDefault ? null : (
                      <button
                        type="button"
                        className="addr-card__action"
                        aria-label={`Make ${a.receiverName}, ${a.city} your default address`}
                        aria-disabled={busyId === a.id}
                        onClick={() => {
                          if (busyId !== a.id) void handleSetDefault(a);
                        }}
                      >
                        Make default
                      </button>
                    )}
                    <button
                      type="button"
                      className="addr-card__action addr-card__action--danger"
                      data-focus-key={`delete-${a.id}`}
                      aria-label={`Delete address for ${a.receiverName}, ${a.city}`}
                      onClick={() => {
                        setMessage("");
                        setDeleting(a);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  {rowError?.id === a.id ? (
                    <p className="addr-card__error" role="alert">
                      {rowError.text}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        {deleting ? (
          <DeleteAddressDialog
            target={deleting}
            others={list.filter((a) => a.id !== deleting.id)}
            onConfirm={(newDefaultId) => handleDelete(deleting, newDefaultId)}
            onClose={() => {
              const id = deleting.id;
              setDeleting(null);
              // Cancelled: focus goes back to the Delete button that opened it.
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>(`[data-focus-key="delete-${id}"]`)?.focus(),
              );
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
