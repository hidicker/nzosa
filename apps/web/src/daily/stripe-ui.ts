import { redraw } from "../app.js";
import { invoiceBalanceMap, record } from "../books.js";
import { callFunction, rpc } from "../cloud.js";
import { usingOwnProject } from "../cloud-config.js";
import { booksCurrency } from "../country.js";
import { state } from "../state.js";
import { backendKind, booksReadOnly, openCloudBookId, savePart } from "../store.js";
import { askOnPage, note, tellOnPage } from "../ui.js";
import { formatAmount, isPosted } from "@nzosa/core";
import type { Invoice } from "@nzosa/core";

/**
 * Card payments through the business's own Stripe account: a "pay now" link
 * on an invoice, and word of when it was paid.
 *
 * The money goes to the business's Stripe account and reaches the books when
 * Stripe pays it out to the bank, as a payout does now: matched there, with
 * its fee split off. A link paid on Stripe only says so on the invoice in the
 * meantime -- recording the payment here as well would count it twice.
 *
 * For books kept online, where the key can be held where the page cannot see
 * it (supabase/functions/stripe).
 */

interface Status {
  configured: boolean;
  account: string;
  key: string;
  live: boolean;
}

let status: { book: string; answer: Promise<Status | null>; known?: Status | null } | null = null;
/** When Stripe was last asked, for which books: not more than once a minute unless asked. */
let checked = { book: "", at: 0 };

/** Whether these books can use Stripe at all: kept online, on NZOSA's own server. */
export function stripePossible(): boolean {
  return backendKind() === "cloud" && openCloudBookId() !== "" && !usingOwnProject();
}

/** Whether a key is connected, asked once per set of books. */
export function stripeStatus(): Promise<Status | null> {
  const book = openCloudBookId();
  if (!stripePossible()) return Promise.resolve(null);
  if (status === null || status.book !== book) {
    const held: { book: string; answer: Promise<Status | null>; known?: Status | null } = {
      book,
      answer: callFunction<Status>("stripe", { action: "status", book }).catch(() => null),
    };
    status = held;
    // Once known, the invoices can offer their links.
    void held.answer.then((s) => {
      held.known = s;
      if (s?.configured === true) redraw("invoices");
    });
  }
  return status.answer;
}

/** Whether Stripe is connected for these books, as far as is known yet: false until it is. */
export function stripeConnected(): boolean {
  if (!stripePossible()) return false;
  void stripeStatus();
  return status?.known?.configured === true;
}

function forgetStatus(): void {
  status = null;
}

async function replaceInvoice(before: Invoice, after: Invoice, what: string): Promise<void> {
  const invoices = (state.ledger.invoices ?? []).map((i) => (i === before ? after : i));
  state.ledger = { ...state.ledger, invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  await record("invoice", what, before, after, after.number);
  redraw("invoices");
}

/**
 * The invoice's pay link, made for what it owes now, copied for pasting. One
 * already made for the same amount is used again; one for another amount is
 * closed and a new one made.
 */
export async function payLinkFor(invoice: Invoice): Promise<void> {
  const book = openCloudBookId();
  const owing = invoiceBalanceMap().get(invoice.number)?.remaining ?? invoice.total;
  if (!isPosted(invoice) || owing <= 0) {
    await tellOnPage(`${invoice.number} has nothing owing.`);
    return;
  }
  const currency = (invoice.currency || booksCurrency()).toUpperCase();
  let link = invoice.payLink;
  if (link === undefined || link.paidAt !== undefined || link.amount !== owing || link.currency !== currency) {
    if (link !== undefined && link.paidAt === undefined) {
      await callFunction("stripe", { action: "close", book, id: link.id }).catch(() => undefined);
    }
    let made: { id: string; url: string };
    try {
      made = await callFunction<{ id: string; url: string }>("stripe", {
        action: "link",
        book,
        invoice: invoice.number,
        contact: invoice.contact,
        currency,
        amount: owing,
      });
    } catch (error) {
      await tellOnPage(`No link was made: ${(error as Error).message}`);
      return;
    }
    link = { id: made.id, url: made.url, amount: owing, currency, made: new Date().toLocaleDateString("en-CA") };
    await replaceInvoice(invoice, { ...invoice, payLink: link }, `${invoice.number}: card payment link for ${formatAmount(owing)} ${currency}`);
  }
  try {
    await navigator.clipboard.writeText(link.url);
    await tellOnPage(
      `The link to pay ${invoice.number} by card is copied:\n\n${link.url}\n\n` +
        "It is also on the invoice document and in its email. Once paid on Stripe, the invoice says so here; " +
        "the money comes into the books with Stripe's payout to your bank.",
    );
  } catch {
    await tellOnPage(`The link to pay ${invoice.number} by card:\n\n${link.url}`);
  }
}

/**
 * Ask Stripe which links have been paid, and say so on their invoices.
 * Each time Invoices is opened, at most once a minute; at once when asked.
 */
export async function checkCardPayments(force = false): Promise<number> {
  const book = openCloudBookId();
  // Recording what Stripe says is a change to the books: not for somebody who may only read them.
  if (!stripePossible() || booksReadOnly() || (!force && checked.book === book && Date.now() - checked.at < 60_000)) return 0;
  checked = { book, at: Date.now() };
  const open = (state.ledger.invoices ?? []).filter((i) => i.payLink !== undefined && i.payLink.paidAt === undefined);
  if (open.length === 0) return 0;
  const connected = await stripeStatus();
  if (connected === null || !connected.configured) return 0;
  let answer: { paid: { invoice: string; id: string; amount: number; currency: string; paidAt: string }[] };
  try {
    answer = await callFunction("stripe", { action: "check", book, links: open.map((i) => ({ invoice: i.number, id: i.payLink!.id })) });
  } catch {
    return 0;
  }
  let marked = 0;
  for (const paid of answer.paid) {
    const invoice = (state.ledger.invoices ?? []).find((i) => i.number === paid.invoice && i.payLink?.id === paid.id);
    if (invoice === undefined || invoice.payLink === undefined || invoice.payLink.paidAt !== undefined) continue;
    await replaceInvoice(
      invoice,
      { ...invoice, payLink: { ...invoice.payLink, paidAt: paid.paidAt, paidAmount: paid.amount } },
      `${invoice.number}: paid by card on Stripe, ${formatAmount(paid.amount)} ${paid.currency}`,
    );
    marked += 1;
  }
  return marked;
}

/** Whether any invoice has a card link sent and not yet paid. */
export function cardLinksWaiting(): boolean {
  return (state.ledger.invoices ?? []).some((i) => i.payLink !== undefined && i.payLink.paidAt === undefined);
}

/** A button to ask Stripe now, for the Invoices page, when links are waiting. */
export function checkCardPaymentsButton(): HTMLElement | null {
  if (booksReadOnly() || !stripeConnected() || !cardLinksWaiting()) return null;
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Check card payments";
  go.title = "Ask Stripe which card links have been paid";
  go.addEventListener("click", () => {
    go.disabled = true;
    go.textContent = "Asking Stripe…";
    void checkCardPayments(true).then(async (marked) => {
      go.disabled = false;
      go.textContent = "Check card payments";
      await tellOnPage(marked === 0 ? "Nothing new has been paid by card." : `${marked} ${marked === 1 ? "invoice has" : "invoices have"} been paid by card.`);
    });
  });
  return go;
}

/** What an invoice's status says about its card payment, or "". */
export function cardPaymentSaid(invoice: Invoice): string {
  const link = invoice.payLink;
  if (link === undefined) return "";
  if (link.paidAt !== undefined) return `paid by card ${link.paidAt.slice(0, 10)}, waiting for Stripe's payout`;
  return "card link sent";
}

/** Connecting Stripe, for the Setup page. */
export function stripeSettings(): HTMLElement {
  const box = document.createElement("div");
  box.className = "setup-stripe";
  const heading = document.createElement("h3");
  heading.textContent = "Card payments with Stripe";
  box.append(heading);
  if (!stripePossible()) {
    box.append(
      note(
        "A \"pay by card\" link on each invoice, paid into your own Stripe account. It needs the books kept online, " +
          "where your Stripe key is held encrypted on the server and never sent to the page.",
      ),
    );
    return box;
  }
  const said = document.createElement("p");
  said.className = "cloud-said";
  said.textContent = "Looking…";
  box.append(said);
  const body = document.createElement("div");
  box.append(body);
  void stripeStatus().then((s) => {
    said.textContent = "";
    body.textContent = "";
    if (s === null) {
      body.append(note("Card payments are not available on this server yet."));
      return;
    }
    if (s.configured) {
      body.append(
        note(
          `Connected${s.account !== "" ? ` to ${s.account}` : ""} with ${s.key}${s.live ? "" : " (a test key: links take test cards only)"}. ` +
            "Each open invoice has a pay link button; the money reaches the books with Stripe's payout to your bank.",
        ),
      );
      const off = document.createElement("button");
      off.type = "button";
      off.textContent = "Disconnect Stripe";
      off.addEventListener("click", async () => {
        if (!await askOnPage("Disconnect Stripe? The key is deleted from the server. Links already sent keep working in Stripe until you turn them off there.")) return;
        try {
          await callFunction("stripe", { action: "forget", book: openCloudBookId() });
        } catch (error) {
          said.textContent = (error as Error).message;
          return;
        }
        forgetStatus();
        redraw("setup");
      });
      body.append(off);
      return;
    }
    // Only an owner connects it: anyone else is told so, not offered a box the server refuses.
    void rpc<boolean>("has_role", { book: openCloudBookId(), roles: ["owner"] }).then((owner) => {
      if (owner === true) return;
      body.textContent = "";
      body.append(note("Stripe is not connected for these books. Only an owner of these books can connect it."));
    });
    body.append(
      note(
        "Make a restricted key in your Stripe dashboard (Developers, API keys, Create restricted key) with " +
          "Payment Links and Prices set to Write and Checkout Sessions to Read, and paste it here. It is checked with " +
          "Stripe, then kept encrypted on the server; this page never sees it again. Only an owner of these books can connect it.",
      ),
    );
    const row = document.createElement("div");
    row.className = "contacts-controls";
    const key = document.createElement("input");
    key.type = "password";
    key.autocomplete = "off";
    key.placeholder = "rk_live_… or sk_live_…";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "primary";
    go.textContent = "Connect Stripe";
    go.addEventListener("click", async () => {
      const value = key.value.trim();
      if (value === "") return;
      go.disabled = true;
      said.textContent = "Checking the key with Stripe…";
      try {
        await callFunction("stripe", { action: "connect", book: openCloudBookId(), key: value });
      } catch (error) {
        const why = (error as Error).message;
        said.textContent = /not allowed/.test(why) ? "Only an owner of these books can connect Stripe." : why;
        said.className = "cloud-said bad";
        go.disabled = false;
        return;
      }
      key.value = "";
      forgetStatus();
      redraw("setup");
    });
    row.append(key, go);
    body.append(row);
  });
  return box;
}
