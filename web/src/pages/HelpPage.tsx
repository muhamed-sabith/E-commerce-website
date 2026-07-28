import { Link } from "react-router-dom";
import { useHead } from "../lib/head";
import { formatINR } from "../lib/format";
import { useStore } from "../lib/store";
import "./help.css";

/**
 * Help & information. Describes only what the system actually does today.
 * Policies that need business decisions (returns, refunds, delivery times,
 * contact channels) are stated as not yet published rather than invented.
 */
export function HelpPage() {
  useHead({
    title: "Help & information | HEYRAH",
    description: "How ordering, payment, shipping, order tracking and your HEYRAH account work.",
    canonicalPath: "/help",
  });
  const store = useStore();
  const flat = store ? formatINR(store.shipping.flatRate.amount) : null;
  const free = store && Number(store.shipping.freeThreshold.amount) > 0 ? formatINR(store.shipping.freeThreshold.amount) : null;

  return (
    <main className="help">
      <div className="help__inner">
        <h1>Help & information</h1>
        <nav aria-label="On this page" className="help__toc">
          <ul>
            <li>
              <a href="#ordering">Ordering</a>
            </li>
            <li>
              <a href="#payment">Payment</a>
            </li>
            <li>
              <a href="#shipping">Shipping</a>
            </li>
            <li>
              <a href="#orders">Order status</a>
            </li>
            <li>
              <a href="#account">Your account</a>
            </li>
            <li>
              <a href="#about">About HEYRAH</a>
            </li>
          </ul>
        </nav>

        <section id="ordering" aria-labelledby="ordering-h">
          <h2 id="ordering-h">Ordering</h2>
          <p>
            Add pieces to your bag from any product page. You can build a bag without an account; when you sign in or create one at checkout, the
            bag comes with you.
          </p>
          <p>
            At checkout you choose a delivery address and see every line, the shipping charge and the total before you place the order. Prices and
            stock are checked again at that moment, so if something sold out or changed price, you'll see it before anything is charged.
          </p>
        </section>

        <section id="payment" aria-labelledby="payment-h">
          <h2 id="payment-h">Payment</h2>
          {store?.paymentMode === "demo" ? (
            <p>
              This store is running in <strong>demo mode</strong>: payment uses a clearly marked test screen, no money moves, and no card or bank
              details are ever requested.
            </p>
          ) : (
            <p>
              Orders are placed first and marked <em>Awaiting payment</em>. Our team confirms the payment and the order moves to <em>Paid</em>; you
              can see this in your orders at any time.
            </p>
          )}
          <p>All prices are in Indian rupees (INR) and include any discount shown on the product.</p>
        </section>

        <section id="shipping" aria-labelledby="shipping-h">
          <h2 id="shipping-h">Shipping</h2>
          {flat ? (
            <p>
              Shipping is {flat} per order{free ? `, and free when your order reaches ${free} after discounts` : ""}. The charge is shown in your bag
              and at checkout.
            </p>
          ) : (
            <p>The shipping charge is shown in your bag and at checkout before you place an order.</p>
          )}
          {store?.pages.includes("shipping") || store?.pages.includes("returns") ? (
            <p>
              {store.pages.includes("shipping") ? <Link to="/shipping-policy">Read the shipping policy</Link> : null}
              {store.pages.includes("shipping") && store.pages.includes("returns") ? " and the " : null}
              {store.pages.includes("returns") ? <Link to="/returns">returns & refunds policy</Link> : null}.
            </p>
          ) : (
            <p className="help__pending">Delivery timeframes and a returns policy haven't been published yet. They'll appear here once confirmed.</p>
          )}
        </section>

        <section id="orders" aria-labelledby="orders-h">
          <h2 id="orders-h">Order status</h2>
          <p>Every order has a status you can follow in your account:</p>
          <dl className="help__steps">
            <div>
              <dt>Placed</dt>
              <dd>We've received the order and set the items aside.</dd>
            </div>
            <div>
              <dt>Confirmed</dt>
              <dd>The order is being prepared.</dd>
            </div>
            <div>
              <dt>Shipped</dt>
              <dd>It's on its way to your address.</dd>
            </div>
            <div>
              <dt>Delivered</dt>
              <dd>It has arrived.</dd>
            </div>
          </dl>
          <p>If an order is cancelled before it ships, the items go back into stock for other shoppers.</p>
          <p>
            <Link to="/orders">See your orders</Link>
          </p>
        </section>

        <section id="account" aria-labelledby="account-h">
          <h2 id="account-h">Your account</h2>
          <p>
            Your account keeps your addresses, orders and wishlist. You can change your name and password from the <Link to="/account">account page</Link>
            . Sessions sign out after a period of inactivity to keep your account safe.
          </p>
        </section>

        <section id="about" aria-labelledby="about-h">
          <h2 id="about-h">About HEYRAH</h2>
          <p>HEYRAH is a women's fashion label. Wings of Style is our promise of clothes that carry you lightly and are made to be kept.</p>
          {store?.pages.includes("contact") ? (
            <p>
              <Link to="/contact">Contact HEYRAH</Link>
            </p>
          ) : (
            <p className="help__pending">Our full brand story and contact details are coming soon.</p>
          )}
        </section>
      </div>
    </main>
  );
}
