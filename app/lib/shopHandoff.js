// SHOP-B2 — THE PAPERBACK SHOP'S HANDOFF (docs/ACCOUNT-CONTRACT.md §6.2 (a)).
//
// The shop (books.calvaryscribblings.co.uk, its own Worker) sends a reader who has just paid to
// /account/shop?return=…&state=…. The reader signs in here (or is signed in already), confirms, and
// is sent back to the shop with a one-time code the shop's server redeems in B3. This file is the
// ONE place the return address, the state's shape and the page's words live. Pure: the page
// (app/account/shop/page.js) and the Function (functions/api/account/shop-code.js) both import it,
// and tests/account/shop-handoff.test.mjs drives it directly.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE RETURN ADDRESS: ONE STRING, MATCHED CHARACTER FOR CHARACTER
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The shop has not named one, so it is ours to set (SHOP-B2, 24 Nov 2026) and goes to the shop in
// B3's hand-off note. No prefix match, no pattern, no URL parsing, no other host, no "same site",
// no case folding, no trailing slash, no query, no fragment. `return` is decoded ONCE, by
// URLSearchParams reading our own query string, and must then equal SHOP_RETURN_URL exactly. A shop
// link that percent-encodes the address in our query (as it should) decodes to it; anything that
// is still encoded after that one decode is a different string and is refused.
//
// AND THE PAGE NEVER SENDS A READER TO THE `return` IT WAS GIVEN. Once it matches, every address the
// page navigates to is built from the constant below (returnHref / declineHref), so no input can
// reach window.location — there is no open redirect to find, whatever the comparison lets through.
// An address not on the list is refused with BAD_LINK and nobody is redirected anywhere.

export const SHOP_RETURN_URL = 'https://books.calvaryscribblings.co.uk/account/return';

/** The Function that mints the code (functions/api/account/shop-code.js). */
export const SHOP_CODE_ENDPOINT = '/api/account/shop-code';

/** The whole allow-list. One entry, by decision; a second is a contract change, not a convenience. */
export const SHOP_RETURNS = Object.freeze([SHOP_RETURN_URL]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE STATE: THE SHOP'S OWN OPAQUE VALUE, ECHOED BACK UNTOUCHED
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 1 to 128 characters, every one URL-safe: RFC 3986's unreserved set, A–Z a–z 0–9 - . _ ~. Those
// need no percent-encoding anywhere in a URL, so the state is written back into the return address
// as the very characters the shop sent, and the shop compares it with its session byte for byte.
// Missing, empty, repeated, longer than 128, or any other character: refused, never cleaned.

export const STATE_MAX = 128;
export const STATE_RE = /^[A-Za-z0-9._~-]{1,128}$/;
export const isState = (s) => typeof s === 'string' && STATE_RE.test(s);

/** A code as minted: 32 random bytes, base64url, no padding — always 43 characters. */
export const CODE_RE = /^[A-Za-z0-9_-]{43}$/;

/** How long the page waits for the Function before it counts as a failure (and "Not now" returns). */
export const SHOP_CODE_TIMEOUT_MS = 20_000;

/** Five minutes from minting (§6.2 (a)): `exp` is the last instant the code is good for. */
export const CODE_TTL_MS = 5 * 60 * 1000;

/** Is `value` on the allow-list? Exact, and only a string. */
export const isAllowedReturn = (value) => typeof value === 'string' && SHOP_RETURNS.includes(value);

/**
 * Read the page's own query string. Each parameter must appear exactly once.
 * @returns {{ ok: true, state: string } | { ok: false, reason: 'return' | 'state' }}
 */
export function readHandoffParams(search) {
  let q;
  try { q = new URLSearchParams(typeof search === 'string' ? search : ''); } catch { return { ok: false, reason: 'return' }; }
  const returns = q.getAll('return');
  if (returns.length !== 1 || !isAllowedReturn(returns[0])) return { ok: false, reason: 'return' };
  const states = q.getAll('state');
  if (states.length !== 1 || !isState(states[0])) return { ok: false, reason: 'state' };
  return { ok: true, state: states[0] };
}

/**
 * Where "Keep it" sends the reader: the constant, the code, the state. Built by concatenation
 * because both values are unreserved characters only; refuses anything else rather than encode it.
 */
export function returnHref(code, state) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) throw new Error('not a handoff code');
  if (!isState(state)) throw new Error('not a handoff state');
  return `${SHOP_RETURN_URL}?code=${code}&state=${state}`;
}

/**
 * Where "Not now" sends the reader: the same address with the state and NO code. The shop tells
 * the two apart by `code` alone: present, the reader kept the order (redeem it); absent, they
 * didn't. Either way the shop first checks the state against the reader's own session.
 */
export function declineHref(state) {
  if (!isState(state)) throw new Error('not a handoff state');
  return `${SHOP_RETURN_URL}?state=${state}`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE WORDS. RULED (Ikenna, 24 Nov 2026): every string below stands as written (docs/COPY-RULINGS.md).
// Every string the page can show is here and nowhere else; tests/account/shop-handoff.test.mjs pins
// them and fails if the page prints a literal of its own.
//
// FAILURES NEVER GO BACK TO THE SHOP. In every error state "Not now" stays on the page, so the reader
// can always return with the state and no code. A return carries code and state ("Keep it") or the
// state alone ("Not now"); no error is ever written into it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const SHOP_COPY = Object.freeze({
  // The page's <title>.
  title: 'Keep your order · Calvary Scribblings',
  // Signed in, and signed out above the sign-in.
  question: 'Keep this order with your others?',
  note: 'Your Calvary account keeps the order number, date, titles and what you paid. Nothing else comes with it.',
  keep: 'Keep it',
  notNow: 'Not now',
  // Signed out: the button that opens (or reopens) the site's own sign-in.
  signIn: 'Sign in or create an account',
  // While the code is minted, and once the page is on its way back.
  keeping: 'Keeping it…',
  leaving: 'Taking you back to the shop…',
  // A return address not on the list, or a state the shop could not have sent.
  badLink: 'This link can’t take you back to the shop.',
  // The Function refused or failed. Nothing was kept; the reader can try again.
  failed: 'We couldn’t keep this order just now. Please try again.',
  limited: 'That’s a lot of tries in a short while. Please wait a minute, then try again.',
  signedOut: 'Your sign-in has expired. Please sign in again to keep this order.',
});
