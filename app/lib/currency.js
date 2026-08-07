'use client';
// CURRENCY SELECTION — R8.3.
//
// One reader-visible decision ("which currency am I browsing in?") and one machine decision
// ("which rail charges this card?"), and the whole of this file exists to keep them separate.
// They are NOT the same value: a reader browsing in naira who opens a title with no NGN price
// is shown pounds and charged pounds, on the Stripe rail, while the selector still says NGN.
// The selected currency is a preference; the EFFECTIVE currency is a fact about a title, and
// only the effective one may ever appear on a buy button.
//
// NO FX. There is no rate in this file, in the endpoints, or in the webhooks. priceFor() falls
// back to a price someone typed into /admin/bookstore; it never converts one. A rate baked in
// at deploy time is wrong by the time it is charged — the argument is set out at length in
// functions/api/bookstore/paystack-checkout.js and this file is the client-side half of it.
//
// ── RESOLUTION ORDER, and why it is not a network call ─────────────────────────────────────
//   1. the reader's stored choice (localStorage)   — synchronous, authoritative, sticky
//   2. the region endpoint                          — asynchronous, advisory, one-shot
//   3. gbp                                          — the shop's home currency
//
// Step 2 NEVER delays first paint. getSnapshot() answers immediately from step 1 or step 3, the
// shelf renders, and if /api/bookstore/region comes back with something better the store
// upgrades and React re-renders the prices in place. A storefront that waits on a geo lookup
// before drawing a price is a storefront that shows a spinner to everyone on a slow connection
// in order to be marginally more polite to a minority — and it would block behind the gate's
// own fetch besides.
//
// A REGION ANSWER NEVER OVERRIDES A STORED CHOICE. Someone in Lagos who has deliberately
// switched to pounds must stay in pounds on the next visit, on every visit. The upgrade is
// skipped entirely once a choice exists, which is also why it is safe for it to land late.
//
// ── THE STORE ──────────────────────────────────────────────────────────────────────────────
// A module-level store read through useSyncExternalStore, NOT a React context. The currency is
// needed by two separate route trees (app/bookstore/page.js and app/bookstore/[slug]/
// page-detail.js) and by three components beneath them, and a context would mean threading a
// provider through both roots — plus a second one anywhere a fourth surface appears later.
// A module store has one instance per document by construction, which is exactly the scope the
// preference has.
//
// ── R11.5: MOVED UP OUT OF app/lib/bookstore/ ────────────────────────────────────────────
//
// "Anywhere a fourth surface appears later" turned out to be membership. The pass and
// subscription prices are quoted per currency exactly as a title's are (£1 / $1.49 / ₦300 for
// a day pass; the week pass exists in naira and nowhere else), and the membership page has to
// ask the same question the storefront asks — which currency is this reader browsing in? —
// through the same store, or the two surfaces could disagree inside one document.
//
// So this is no longer a bookstore module. It never really was one: nothing in it knows what a
// title is, and priceFor() takes prices rather than fetching them. It sat under bookstore/
// because the storefront was the only thing that needed it. Membership is the second, and the
// import path now says so rather than making a membership page reach into the shop's folder
// for its own currency.
//
// The bookstore-specific half stayed behind: ./bookstore/territory.js is imported, not
// absorbed, because territory governs a PUBLISHER'S LICENCE on a title and a membership has no
// publisher (see the note in functions/api/bookstore/stream.js). Currency is universal;
// territory is not, and merging them would have handed membership a rule that cannot apply
// to it.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
// EXPLICIT .js EXTENSION, unlike the extensionless imports elsewhere in app/. Webpack resolves
// both; bare Node resolves only this one, and tests/bookstore/currency.test.mjs imports this
// module directly under `node --test` to assert priceFor/formatPrice without a browser. Drop
// the extension and those tests stop being able to load the file.
import { formatPrice } from '../bookstore/components/fields.js';
// R8.4. Same explicit-.js reasoning as the line above: tests/bookstore/territory.test.mjs
// loads this module under bare Node to assert the precedence rule.
import { isTitleSellableIn, TERRITORY_NOTE } from './bookstore/territory.js';

export const CURRENCIES = ['gbp', 'ngn', 'usd'];
export const DEFAULT_CURRENCY = 'gbp';

// The selector's own labels, in the mock's register: symbol then code.
export const CURRENCY_LABELS = { gbp: '£ GBP', ngn: '₦ NGN', usd: '$ USD' };

// Prose names, for the sentences that talk ABOUT a currency rather than printing one. "in
// pounds only" reads as English; "in GBP only" reads as a receipt.
export const CURRENCY_NAMES = { gbp: 'pounds', ngn: 'naira', usd: 'dollars' };

export const CURRENCY_STORAGE_KEY = 'cs_bookstore_currency';
export const REGION_ENDPOINT = '/api/bookstore/region';

// Only the countries with their own rail or their own tender get their own currency. Everyone
// else browses in pounds, which is the shop's home currency and not a fallback in the sense of
// something having gone wrong. Deliberately NOT a long table: every row added here is a claim
// that titles are actually priced in that currency, and pricing is per-title curator work.
export const COUNTRY_CURRENCY = { NG: 'ngn', US: 'usd' };

export const isCurrency = (v) => typeof v === 'string' && CURRENCIES.includes(v);

export function currencyForCountry(country) {
  if (typeof country !== 'string') return DEFAULT_CURRENCY;
  return COUNTRY_CURRENCY[country.trim().toUpperCase()] || DEFAULT_CURRENCY;
}

// ── Persistence ────────────────────────────────────────────────────────────────────────────
// Every access is guarded: Safari in private mode throws on localStorage rather than returning
// null, and a shop that white-screens because someone opened a private tab is a worse bug than
// a preference that does not persist.

export function readStoredCurrency() {
  try {
    const v = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    return isCurrency(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStoredCurrency(currency) {
  try {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
    return true;
  } catch {
    return false;
  }
}

// ── Price selection ────────────────────────────────────────────────────────────────────────

const usable = (v) => Number.isInteger(v) && v > 0;

/**
 * The price a title is actually sold at, for a reader browsing in `currency`.
 *
 * Returns { currency, minorUnits, isFallback } — or null when the title carries no usable
 * price at all, which is the signal to omit the line entirely rather than print a placeholder
 * (the contract formatGbp has always had, and the reason every call site is written
 * `{price && …}`).
 *
 * `currency` on the way OUT is the EFFECTIVE currency: what will be charged. It differs from
 * the argument exactly when isFallback is true, and every caller that prints money must use
 * this one rather than the reader's selection.
 *
 * FALLBACK ORDER: the selected currency, then GBP, then whatever single price the title does
 * carry. That last clause is not hypothetical — a Nigerian-published title priced only in naira
 * is a real case, and the alternative to showing its naira price to a reader browsing in pounds
 * is hiding the book from them. Iterating CURRENCIES rather than Object.keys(prices) keeps the
 * choice deterministic when a title somehow carries two non-GBP prices and neither is selected.
 *
 * Pure. No clock, no storage, no network — see tests/bookstore/currency.test.mjs.
 */
export function priceFor(title, currency) {
  const prices = title?.prices;
  if (!prices || typeof prices !== 'object') return null;

  if (isCurrency(currency) && usable(prices[currency])) {
    return { currency, minorUnits: prices[currency], isFallback: false };
  }
  if (usable(prices[DEFAULT_CURRENCY])) {
    return { currency: DEFAULT_CURRENCY, minorUnits: prices[DEFAULT_CURRENCY], isFallback: true };
  }
  for (const c of CURRENCIES) {
    if (usable(prices[c])) return { currency: c, minorUnits: prices[c], isFallback: true };
  }
  return null;
}

// Re-exported so a consumer needs one import to price a title and print the result. The single
// implementation lives in components/fields.js beside formatGbp, which it now backs — see the
// note there.
export { formatPrice };

// ── THE MARK, AND THE SENTENCE ─────────────────────────────────────────────────────────────
// Both strings live here so the four surfaces that show them cannot drift apart on wording.
// Each renders it in its OWN register — the storefront's dark shelf, the book's cream back
// face and the detail page's column are three different type systems, and a shared component
// would have to fight all three. The words are shared; the styling is not.
//
// IT IS A FACT, NOT A WARNING. No badge, no alarm colour, no dimming of the title it belongs
// to. A reader browsing in naira who meets a book priced in pounds has not done anything wrong
// and nothing has failed — they are simply being told what they will be charged, before they
// are charged it. Lowercase, small, italic, muted, beneath the price. The moment it acquires a
// ⚠, a border or an amber, it has started apologising for the catalogue.

/** "in pounds only" — the shelf mark, or null when the title is priced in the selection. */
export function fallbackNote(priced) {
  if (!priced?.isFallback) return null;
  const name = CURRENCY_NAMES[priced.currency];
  return name ? `in ${name} only` : null;
}

/**
 * The detail page's fuller version. It goes BENEATH the buy button, because it explains what
 * that button is about to do — a reader meets the claim, then the qualification.
 */
export function fallbackSentence(priced, selected) {
  if (!priced?.isFallback) return null;
  const from = CURRENCY_NAMES[selected];
  const to = CURRENCY_NAMES[priced.currency];
  const amount = formatPrice(priced.currency, priced.minorUnits);
  if (!from || !to || !amount) return null;
  return `This title isn’t priced in ${from}. You can still buy it — you’ll be charged ${amount} in ${to}.`;
}

// ── PRECEDENCE: TERRITORY OUTRANKS CURRENCY (R8.4) ─────────────────────────────────────────
//
// Two independent facts can now qualify one book — it is not licensed here, and it is not
// priced in the currency you are browsing in — and a title can carry both at once. Rendered
// naively that is two marks under one cover, one of which ("in pounds only") invites the
// reader to do something the other one forbids, next to a price they cannot act on.
//
// So there is ONE rule, and it lives in ONE function rather than in the five surfaces that
// would each have to remember it: a title the reader may not buy shows the TERRITORY mark and
// NO PRICE AT ALL. Not the price plus a caveat — the price is a claim that a sum of money will
// buy this book, and that claim is false here. The currency mark exists to keep the button
// honest about what it will charge; where there is no button there is nothing to keep honest.
//
// Which is also why this is not a component. The five callers — ShelfEntry, BoundBook's back
// face, QuickLookModal, BuyButton and the detail page — render in five different type systems
// (dark shelf, cream stock, modal, gilt button, editorial column). They share the DECISION;
// they cannot share the markup. R8.3 made the same call about its own mark and said so.

/**
 * Everything a surface needs to print about one title's price, decided in the right order.
 *
 * @returns {{ sellable, priced, price, note, isTerritoryNote }}
 *   sellable         false when the licence excludes this country
 *   priced           the priceFor() result, or null — null whenever !sellable
 *   price            the formatted tag, or null — null whenever !sellable
 *   note             the ONE mark to show beneath, or null. Never two.
 *   isTerritoryNote  which mark it is, so a surface can pick the right testid without
 *                    re-deriving the decision or string-matching the note
 *
 * `country` null (undetermined) means no marks anywhere and the buy button enabled: the server
 * still refuses a restricted title, so the reader meets one honest error instead of a shelf of
 * warnings the shop is only guessing at. That behaviour is isSellableIn's, not this
 * function's — see SELL_TO_UNKNOWN_COUNTRY in territory.js, which is where it is decided.
 */
export function priceLine(title, currency, country) {
  if (!isTitleSellableIn(title, country)) {
    return { sellable: false, priced: null, price: null, note: TERRITORY_NOTE, isTerritoryNote: true };
  }
  const priced = priceFor(title, currency);
  return {
    sellable: true,
    priced,
    price: priced ? formatPrice(priced.currency, priced.minorUnits) : null,
    note: fallbackNote(priced),
    isTerritoryNote: false,
  };
}

// ── The store ──────────────────────────────────────────────────────────────────────────────

let current = null;          // null = not yet read off the client
let chosen = false;          // true once the reader has an explicit stored choice
let probed = false;          // the region probe is one-shot per document
// R8.4. The country the probe found, kept rather than discarded. It starts undefined ("not
// asked yet") and becomes a string or null ("asked; this is the answer, and null means
// Cloudflare could not place them"). Both non-answers are reported to callers as null; the
// distinction only matters inside upgradeFromRegion, which must not run twice.
let regionCountry = null;
const listeners = new Set();

const emit = () => { listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

function getSnapshot() {
  if (current === null) {
    const stored = readStoredCurrency();
    chosen = stored !== null;
    current = stored || DEFAULT_CURRENCY;
  }
  return current;
}

// The prerendered HTML is built with no reader and no storage, so it must say GBP — and this
// must return a STABLE value, never call into localStorage, or React will loop during
// hydration. The client snapshot taking over afterwards is the documented behaviour of
// useSyncExternalStore and is what makes a stored NGN choice appear without a flash of markup
// mismatch.
const getServerSnapshot = () => DEFAULT_CURRENCY;

/**
 * The reader chose. Persists, and stops the region probe from ever contradicting it.
 * Exported for the selector and for tests; ordinary components use useCurrency().
 */
export function setCurrency(currency) {
  if (!isCurrency(currency)) return;
  getSnapshot();
  writeStoredCurrency(currency);
  // An explicit choice ends the probe's authority over the CURRENCY for good — but not the
  // probe itself. It used to set `upgraded = true` here, which cancelled the fetch outright;
  // R8.4 needs the country from that same fetch to mark restricted titles, so the probe now
  // always runs and simply declines to touch the currency once `chosen` is true. The
  // guarantee is unchanged and is asserted by "a region answer NEVER overrides a stored
  // choice" in tests/bookstore/currency.spec.mjs.
  chosen = true;
  if (current !== currency) {
    current = currency;
    emit();
  } else {
    emit();                 // still emit: `chosen` moved, and the quiet line reads it
  }
}

export const hasChosenCurrency = () => { getSnapshot(); return chosen; };

/**
 * The one-shot region probe. Safe to call on every mount — it runs at most once per document.
 *
 * ONE CALL, TWO CONSUMERS (R8.4). It answers two questions from a single request: which
 * currency to default to (R8.3) and which country to judge a licence against (R8.4). A second
 * fetch for the territory marking would be a second round-trip for a value already on its way,
 * and — worse — two answers that could disagree if an edge ever load-balanced between them.
 * `probed` guards the request, not the use, so both consumers are served by whichever surface
 * mounts first.
 *
 * IT STILL RUNS WHEN A CURRENCY IS ALREADY CHOSEN, which is the one behavioural change here.
 * The early `if (chosen) return` moved down to guard only the currency assignment: the country
 * is needed either way, and a reader with a stored preference is exactly as subject to a
 * publisher's licence as one without. "A region answer never overrides a stored choice" is
 * unchanged — it is now enforced at the assignment rather than by refusing to ask.
 *
 * STILL NON-BLOCKING, and this is load-bearing. Nothing awaits this. getSnapshot() answers
 * from storage or the default, the shelf paints, and the marks appear if and when the answer
 * lands — a storefront that waited on a geo lookup before drawing would show every reader a
 * spinner in order to be marginally more correct about a minority. The prerendered HTML and
 * the first client render therefore both carry NO territory marks, which is also what makes
 * hydration safe: country is null on both sides until the fetch resolves.
 *
 * Failure is silence, on purpose: an unreachable endpoint, an offline reader and a country we
 * do not map all land in the same place, which is "keep the default, mark nothing". There is
 * nothing to report to the reader, because nothing they asked for has failed — and a shelf of
 * "not sold in your region" marks caused by a dropped request would be a lie told loudly.
 */
export async function upgradeFromRegion() {
  if (probed) return;
  probed = true;
  getSnapshot();

  try {
    const res = await fetch(REGION_ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const { country } = (await res.json()) || {};
    if (!country) return;                       // null = Cloudflare could not place them

    // R8.4 — kept whatever happens to the currency below. This is the value every territory
    // decision on the client reads.
    regionCountry = typeof country === 'string' ? country.trim().toUpperCase() : null;

    // Still not a "choice": the reader has not chosen anything, so `chosen` stays false and the
    // quiet line keeps offering to explain itself.
    const next = chosen ? current : currencyForCountry(country);
    if (next !== current) current = next;
    emit();                                     // the country moved even when the currency did not
  } catch {
    /* offline, blocked, or malformed — keep the default */
  }
}

/**
 * The hook every price-showing surface uses.
 *
 * Returns [currency, setCurrency, chosen]. The region probe is kicked off from an effect so it
 * never runs during render and never runs on the server.
 */
export function useCurrency() {
  const currency = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => { upgradeFromRegion(); }, []);
  const choose = useCallback((c) => setCurrency(c), []);
  return [currency, choose, hasChosenCurrency()];
}

/** The country the probe found, or null. Null means "not asked yet" AND "asked, no answer". */
export const getRegionCountry = () => regionCountry;

// The server render has no reader and no edge, so it has no country — and it must agree with
// the first client render or hydration will fight. Both are null; the marks arrive afterwards.
const getServerRegionCountry = () => null;

/**
 * The country hook (R8.4). Subscribes to the SAME store and kicks the SAME one-shot probe as
 * useCurrency, so a surface that reads both — every one of them does — still makes one request
 * per document.
 */
export function useRegionCountry() {
  const country = useSyncExternalStore(subscribe, getRegionCountry, getServerRegionCountry);
  useEffect(() => { upgradeFromRegion(); }, []);
  return country;
}

// Test seam. The store is module-level by design, which means it outlives a single test; this
// puts it back to a known state. Not called by application code.
export function __resetCurrencyStore() {
  current = null;
  chosen = false;
  probed = false;
  regionCountry = null;
  listeners.clear();
}
