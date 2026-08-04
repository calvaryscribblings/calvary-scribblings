// THE PRE-LAUNCH GATE — a curtain, not a vault.
//
// THIS IS NOT SECURITY, and nothing in this file should ever be mistaken for it.
// next.config.mjs sets output:'export'. There is no server half to check a passcode against —
// every byte below is compiled into a JavaScript chunk and shipped to the browser, so
// GATE_PASSCODE is readable by anyone who opens devtools or curls the bundle. That is a
// property of a static site, not an oversight here, and it cannot be engineered away on this
// architecture: hashing the constant would only ship the hash and the comparison alongside it.
// Do not let a later pass "harden" this — there is nothing to harden, and the attempt would
// only disguise the fact from the next reader.
//
// SO WHAT ACTUALLY KEEPS THE SHELVES PRIVATE is two other things, and those are the ones worth
// protecting in review:
//   · noindex — app/bookstore/layout.js sets robots:{index:false,follow:false}, and
//     /bookstore/[slug] inherits it (its generateMetadata deliberately sets no robots key).
//     Verified present in the built export on both routes.
//   · the routes are absent from app/sitemap.js, so nothing a crawler walks points at them.
//
// The gate's job is narrower, and social rather than technical: a reader who reaches the
// storefront before opening day should meet the date and a waiting list, not a half-stocked
// shop. It keeps the shelves private the way a shop's blind does — not the way a lock does.
//
// WHY IT IS NEEDED NOW. /bookstore is no longer unlinked: app/links/page.js ships a "Book
// Store · opens 30 Sept" button on the link-in-bio page, and app/reader/[slug]/book-reader.js
// carries seven "View in the Book Store" links. Three titles are published, so the A0 gate is
// already open and the storefront answers 200 today. The curtain is doing real work.

// R9 (launch day) FLIPS THIS ONE LINE — and then deletes, rather than keeps, everything the
// flip made dead. See the delete list at the foot of this file.
export const GATE_ENABLED = true;

// The key itself. Change it here and nowhere else; nothing else in the tree holds a copy, and
// the harness reads this file rather than repeating the literal.
export const GATE_PASSCODE = 'CALVARY-KEY-2026';

// Versioned, so R9 — or a passcode change that needs to evict everyone already through —
// invalidates every pass by bumping the suffix rather than by asking readers to clear storage.
export const GATE_STORAGE_KEY = 'cs_bookstore_gate_v1';

/**
 * Trimmed and case-insensitive, because the reader is typing a phrase off a message on a phone
 * keyboard that will capitalise the first letter for them. A curtain that rejects 'calvary-key-2026'
 * is not more private than one that accepts it — it is only ruder.
 */
export function isPasscodeCorrect(entered) {
  if (typeof entered !== 'string') return false;
  return entered.trim().toLowerCase() === GATE_PASSCODE.trim().toLowerCase();
}

/**
 * localStorage in a try/catch, every time. Safari in private mode throws on read as well as on
 * write, and an exception here would take the whole storefront down with it — so a storage
 * failure degrades to "show the gate", which is the safe direction: the reader is asked for the
 * key again rather than shown a blank page.
 */
export function hasGatePass() {
  try {
    return window.localStorage.getItem(GATE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function grantGatePass() {
  try {
    window.localStorage.setItem(GATE_STORAGE_KEY, '1');
  } catch {
    // A reader who cannot persist the pass still gets through on this visit — they are already
    // past the check by the time this runs. They will simply be asked again next time.
  }
}

/**
 * THE SINGLE POINT OF USE of GATE_ENABLED, and deliberately the only one: the harness asserts
 * that no other file in app/ reads the flag, so "what does R9 flip?" has exactly one answer.
 * Call this from the browser only — it touches localStorage.
 */
export function isStoreUnlocked() {
  if (!GATE_ENABLED) return true;
  return hasGatePass();
}

/**
 * Shape, not existence. This is the client-side check in front of the waitlist write: it exists
 * to catch the typo the reader can still fix while they are looking at the field, not to decide
 * whether an address receives mail — nothing on a static site can know that. The RTDB
 * .validate rule on bookstore_waitlist is the half that cannot be skipped by a console.
 *
 * Bounds match that rule exactly (5–320 characters, one '@' with something either side, no
 * whitespace) so the two halves cannot disagree — a value this accepts and the rule rejects
 * would surface as a silent permission-denied the reader could do nothing about.
 *
 * ── THESE TWO MOVE TOGETHER. R9.1 LB-9. ──────────────────────────────────────────────────
 * The regex below and the one in database.rules.json under
 * bookstore_waitlist/$entry/email/.validate are the SAME expression, deliberately duplicated
 * because a rules file cannot import. Before R9.1 they were NOT the same: the rule asked only
 * `contains('@')` while this asked for a dotted domain, so the rule was the looser of the two
 * and a console could put `a@b` in the mailing list that this function would never have sent.
 * Change one, change the other, and re-run tests/rules/database.test.mjs — the waitlist block
 * there asserts both halves against the same table of addresses.
 */
// R9.1 LB-9: a POSITIVE character class, not a negated one. The previous
// `/^[^@]+@[^@.]+(\.[^@.]+)+$/` could not be expressed in database.rules.json, because the
// RTDB rules regex dialect has no `\s` — so "anything but @, and no whitespace" is not
// sayable there, and a negated class without it would have let a tab through the rule that
// this function rejects. Naming the permitted characters says the same thing in a dialect
// both halves speak. The set is the practical one every mail provider accepts; an address
// outside it is refused by BOTH halves, in agreement, rather than by one of them silently.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function isEmailShaped(value) {
  if (typeof value !== 'string') return false;
  // NOTE the trim, and note that LaunchGate writes `email.trim()` — so a padded address is
  // accepted here and stored WITHOUT the padding. The rule never sees the untrimmed form and
  // is right to reject it; the two are consistent because the trim happens before the write.
  const v = value.trim();
  if (v.length < 5 || v.length > 320) return false;
  // Whitespace needs no separate test: it is not in the class above.
  return EMAIL_RE.test(v);
}

// ── WHAT R9 DOES, IN FULL ────────────────────────────────────────────────────
//
// The flip is `GATE_ENABLED = false`, and it is one line. But leaving it at that would leave a
// gate page, a passcode and a storage key in the tree, all reachable, none reached — the kind
// of dead machinery that gets re-enabled by accident two rounds later. So R9 DELETES:
//
//   · this file (app/lib/bookstore/gate.js)
//   · app/bookstore/components/LaunchGate.js
//   · the four lines in app/bookstore/page.js and app/bookstore/[slug]/page-detail.js that
//     import it, hold `curtain` state and render <LaunchGate /> — grep LaunchGate, it is a
//     short list by construction
//   · tests/bookstore/** and the test:gate script and CI step
//
// What R9 does NOT delete: the bookstore_waitlist node, its rules, or the addresses in it.
// Those are a mailing list that outlives the curtain and is the reason it existed.
