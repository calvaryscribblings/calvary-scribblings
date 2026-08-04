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

import { useCallback, useEffect, useSyncExternalStore } from 'react';
// EXPLICIT .js EXTENSION, unlike the extensionless imports elsewhere in app/. Webpack resolves
// both; bare Node resolves only this one, and tests/bookstore/currency.test.mjs imports this
// module directly under `node --test` to assert priceFor/formatPrice without a browser. Drop
// the extension and those tests stop being able to load the file.
import { formatPrice } from '../../bookstore/components/fields.js';

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

// ── The store ──────────────────────────────────────────────────────────────────────────────

let current = null;          // null = not yet read off the client
let chosen = false;          // true once the reader has an explicit stored choice
let upgraded = false;        // the region probe is one-shot per document
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
  chosen = true;
  upgraded = true;          // an explicit choice ends the probe's authority for good
  if (current !== currency) {
    current = currency;
    emit();
  } else {
    emit();                 // still emit: `chosen` moved, and the quiet line reads it
  }
}

export const hasChosenCurrency = () => { getSnapshot(); return chosen; };

/**
 * The one-shot region probe. Safe to call on every mount — it runs at most once per document
 * and returns immediately once a choice exists.
 *
 * Failure is silence, on purpose: an unreachable endpoint, an offline reader and a country we
 * do not map all land in the same place, which is "keep the default". There is nothing to
 * report to the reader, because nothing they asked for has failed.
 */
export async function upgradeFromRegion() {
  if (upgraded) return;
  upgraded = true;
  getSnapshot();
  if (chosen) return;

  try {
    const res = await fetch(REGION_ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const { country } = (await res.json()) || {};
    if (!country) return;                       // null = Cloudflare could not place them
    const next = currencyForCountry(country);
    // Still not a "choice": the reader has not chosen anything, so `chosen` stays false and the
    // quiet line keeps offering to explain itself.
    if (next !== current) { current = next; emit(); }
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

// Test seam. The store is module-level by design, which means it outlives a single test; this
// puts it back to a known state. Not called by application code.
export function __resetCurrencyStore() {
  current = null;
  chosen = false;
  upgraded = false;
  listeners.clear();
}
