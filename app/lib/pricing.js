// PRICING — the pure half of currency selection, and the one place FREE is defined.
//
// FREE-TITLES (28 Oct 2026). Ikenna's ruling: a price of 0 in a currency means the title is
// FREE in that currency. Prices stay hand-set per currency; 0 is now a legal hand-set price.
// Negative and non-numeric prices are still refused, and an ABSENT price is still "not priced
// in that currency" — absence is never read as 0. Free is a price, not an absence.
//
// WHY THIS FILE EXISTS. priceFor() and currencyForCountry() used to live in ./currency.js, which
// is 'use client' and imports React for its store. The claim endpoint
// (functions/api/bookstore/claim.js) must answer "is this title free for this reader?" with the
// SAME function the shelf uses to print "Free", and a Pages Function cannot pull React in. So the
// pure half moved here and ./currency.js re-exports it, byte-for-byte in behaviour except that
// 0 is now usable. Every existing import of priceFor from ./currency.js still works.
//
// Pure. No clock, no storage, no network, no React. Explicit .js imports so bare Node (the
// test suites) and the Pages Functions bundler both resolve it.

import { FREE_RAIL } from './bookstore/purchaseSource.js';

export const CURRENCIES = ['gbp', 'ngn', 'usd'];
export const DEFAULT_CURRENCY = 'gbp';

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

/**
 * Is this a price someone may hand-set? A whole number of minor units, 0 or more. 0 is FREE.
 * The ONE definition, shared by the schema validator, priceFor and (in words) database.rules.json.
 */
export const isValidPrice = (v) => Number.isInteger(v) && v >= 0;

/**
 * The price a title is actually sold at, for a reader browsing in `currency`.
 *
 * Returns { currency, minorUnits, isFallback } — or null when the title carries no usable
 * price at all, which is the signal to omit the line entirely rather than print a placeholder.
 * minorUnits 0 is a FREE title, and is a price like any other: it wins the selection exactly
 * as £1.99 would.
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
 */
export function priceFor(title, currency) {
  const prices = title?.prices;
  if (!prices || typeof prices !== 'object') return null;

  if (isCurrency(currency) && isValidPrice(prices[currency])) {
    return { currency, minorUnits: prices[currency], isFallback: false };
  }
  if (isValidPrice(prices[DEFAULT_CURRENCY])) {
    return { currency: DEFAULT_CURRENCY, minorUnits: prices[DEFAULT_CURRENCY], isFallback: true };
  }
  for (const c of CURRENCIES) {
    if (isValidPrice(prices[c])) return { currency: c, minorUnits: prices[c], isFallback: true };
  }
  return null;
}

/**
 * Ruling 242 (29 Oct 2026) — FREE IS ALL-OR-NOTHING. A price of 0 in one currency requires 0 in
 * every currency the title is priced in; an ABSENT currency is still "not priced there" and is
 * not counted. So { gbp: 0, ngn: 0 } and { gbp: 0 } are free titles, and { gbp: 0, ngn: 180000 }
 * is refused — it would be free to one reader and £-priced to the next for the same book.
 * The ONE definition, shared by the admin form and the schema; database.rules.json states it in
 * its own words at bookstore_titles/$titleId/prices.
 */
export const FREE_ALL_OR_NOTHING_ERROR =
  'A free title must be free in every currency it is priced in — set every price to 0, or leave a currency blank to skip it.';
export function isMixedFree(prices) {
  if (!prices || typeof prices !== 'object') return false;
  // Only real prices count: absent is unpriced, and an invalid value is a different error.
  const vals = CURRENCIES.map((c) => prices[c]).filter(isValidPrice);
  return vals.some((v) => v === 0) && vals.some((v) => v !== 0);
}

/** Is this priceFor() result a free one? */
export const isFreePrice = (priced) => !!priced && priced.minorUnits === 0;

// ── THE WORDS ──────────────────────────────────────────────────────────────────────────────
// Where a price prints, a 0 prints FREE_LABEL, in the same element and style as a price. The
// button on a free title names the act and then the price, in the "Buy · £1.99" pattern, so the
// detail page and Quick Look — whose only price IS the button label — still print "Free".
export const FREE_LABEL = 'Free';
// Ruling 240 (29 Oct 2026): "Get · Free", mirroring "Buy · £1.99". It replaced FREE-TITLES'
// "Add to My Library · Free", which wrapped the book page's button row at 320, 360, 375 and 390px.
export const CLAIM_ACTION = 'Get';
export const CLAIM_LABEL = `${CLAIM_ACTION} · ${FREE_LABEL}`;
// Ruling 241 (29 Oct 2026): every title the reader HOLDS (holdsBook — a sale, a comp or a free
// copy; never a revoked one) shows this in place of Buy or Get, linking to My Library.
export const OWNED_LABEL = 'In My Library';
export const OWNED_HREF = '/my-library';

// ── THE SERVER'S QUESTION ──────────────────────────────────────────────────────────────────

/**
 * The price for a reader the SERVER has placed, never one the client has described.
 *
 * The country is the edge's (functions/api/bookstore/region.js countryFrom — the same resolver
 * checkout's territory check reads); the currency is the one that country browses in by default;
 * the price is priceFor()'s answer for it, fallback included — so a reader in Lagos sees the
 * same sum the shelf would show them before they touched the selector. Null country is the
 * shop's home currency, as it is on the shelf.
 */
export function regionPriceFor(title, country) {
  return priceFor(title, currencyForCountry(country));
}

// ── THE FREE GRANT'S RECORD ────────────────────────────────────────────────────────────────

// The rail's name is purchaseSource.js's — the module every reader of purchase records asks.
export { FREE_RAIL };
export const FREE_REF_FIELD = 'freeRef';

/**
 * The free grant's transaction reference — DETERMINISTIC in (uid, titleId), so a double tap, a
 * retry or a replay names the same "transaction" and grants once. Prefixed `free.` rather than
 * the Paystack rail's `cs.`, so nothing that parses a Paystack reference can mistake it for one.
 */
export function freeRefFor(uid, titleId) {
  return `${FREE_RAIL}.${uid}.${titleId}`;
}

// ── THE ADMIN FORM'S FIELD ─────────────────────────────────────────────────────────────────

/**
 * One price field as typed in /admin/bookstore ("4.99", "4500", "0", "") → minor units.
 *
 * THREE answers, not two:
 *   null       the field is EMPTY — "not priced in this currency". Never read as 0.
 *   a number   a price in minor units, 0 or more. 0 is FREE.
 *   NaN        INVALID — negative, not a number, or a positive amount too small to be a penny
 *              (0.004 would round to a free title nobody meant). The form refuses to save it.
 *
 * Before FREE-TITLES this answered null for 0 and for negatives alike, so a 0 vanished in
 * silence and a title priced 0 everywhere failed "Enter at least one price".
 */
export function parsePriceField(major) {
  if (major === null || major === undefined) return null;
  const text = String(major).trim();
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return NaN;
  const minor = Math.round(n * 100);
  if (n > 0 && minor === 0) return NaN;
  return minor;
}
