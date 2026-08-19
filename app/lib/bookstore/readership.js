// READERSHIP — how many libraries a book is in, and the one sentence that says so.
//
// Ikenna's ruling, 19 Aug 2026: the genre principle applied again. **Absent is absent.**
// A title with no purchases has no readership line — not a zero, not a placeholder, not a
// dash. The line begins to exist at one, and until then there is nothing on the page where
// it would go.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// IT IS NOT A SALES FIGURE, AND THE WORDING IS THE WHOLE POINT
// ═════════════════════════════════════════════════════════════════════════════════════════
//
//   "IN 12 READERS' LIBRARIES"        not  "12 sold"
//   "IN ONE READER'S LIBRARY"         not  "1 sales"
//
// The R2 mock-up of this shop printed "1,204 sold" under every cover, next to a star rating.
// That is the chrome this shop has spent every round since removing. A sales figure is a
// fact about money moving; a readership figure is a fact about where the book ended up, and
// only the second one is any of a reader's business. It also happens to be the honest number:
// it counts LIVE entitlements, so a refunded copy is not in anybody's library and does not
// count. See THE LEDGER below.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// THE COUNT IS NEVER DERIVED IN A BROWSER
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// bookstore_purchases/{uid}/{titleId} is readable only by its owner and the two founders,
// and correctly so — "which books this person bought" is one of the two most private facts
// the shop holds. A storefront is anonymous and cannot aggregate it, must not be able to,
// and no amount of convenience justifies relaxing that rule.
//
// So the public number lives in its own node, written by the SAME atomic operation that
// records the purchase:
//
//   bookstore_readership/{titleId}/count : integer   .read: true, admin/founder write only
//
// Grant and count cannot drift, because there is no moment at which one exists without the
// other: functions/api/bookstore/_lib.js issues ONE multi-path update carrying both. The
// arithmetic lives there, next to the write, in readershipDelta().
//
// ⚠ THIS MODULE IS PURE AND MONEY-FREE, and that is a portability requirement rather than a
// stylistic one — see THE PLATFORM GATE at the foot of the file.

/** The public node. One integer per title; absent means nobody has bought it. */
export const READERSHIP_PATH = 'bookstore_readership';

/** The threshold. There is no display below it, and no formatting decision to make there. */
export const READERSHIP_MIN = 1;

/**
 * GROUPING SEPARATORS, HAND-ROLLED — and this is the ONE implementation in the tree.
 *
 * app/bookstore/components/fields.js used to carry a private `group()` for the same job and
 * now imports this one. The argument is that file's and it transfers unchanged: this runs in
 * a static export served from a CDN to readers in any locale, and Intl.NumberFormat formats
 * to the RUNTIME's locale data unless pinned — so the same title could read "1,204" for one
 * reader and "1.204" for another with a European locale. A readership figure is not a
 * localised number; it is a statement the shop is making, and it must be identical
 * everywhere.
 *
 * It lives HERE rather than in fields.js because fields.js is the money module — currency
 * symbols, minor units, price tags — and this module must stay portable to a platform that
 * cannot carry any of that. Moving the shared function to the money-free side was the only
 * way to keep one implementation without dragging money across the wall.
 */
export function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Whatever is stored at bookstore_readership/{titleId}, as a usable count.
 *
 * Returns 0 for everything that is not a non-negative integer: an absent node, a null, a
 * hand-edited string, a negative left by a decrement that ran against a node the backfill
 * never wrote. Every one of those means "do not print a line", and they all reach the same
 * answer without the caller testing for them. A negative in particular must never render —
 * it is a reconciliation problem, not a fact about readers.
 *
 * The node is an object so a later field can join `count` without a shape migration; a bare
 * integer is also accepted, because that is what a hand-repair is most likely to leave.
 */
export function readershipCountOf(node) {
  const raw = (node && typeof node === 'object' && !Array.isArray(node)) ? node.count : node;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return 0;
  return raw;
}

/**
 * ⭑ THE LINE.
 *
 * Returns null below the threshold — null, not an empty string, so every call site's
 * `{line && …}` omits the element entirely rather than rendering an empty one that still
 * occupies its margins.
 *
 *   0   → null                              (absent is absent)
 *   1   → "In one reader's library"
 *   2   → "In 2 readers' libraries"
 *   1204→ "In 1,204 readers' libraries"
 *
 * THE SINGULAR IS SPELT, THE PLURALS ARE NOT, and the asymmetry is deliberate. "In 1
 * reader's library" is the sentence a template writes; "In one reader's library" is the
 * sentence a person writes, and at a count of one the shop is talking about a single human
 * being. Every other count is a quantity, and a quantity is a numeral. The apostrophe moves
 * with the noun — reader's / readers' — which is the failure the ruling named ("never
 * '1 readers'").
 *
 * Returned in sentence case and UPPERCASED BY CSS, not here: `text-transform` is what every
 * other small-caps line in this shop uses (.window-plate, .rail-eyebrow, .section-title,
 * .no-label), and a string that is already shouting cannot be reused by a surface that wants
 * it quiet. The app port gets the same string and applies its own casing.
 */
export function readershipLine(count) {
  const n = typeof count === 'number' ? count : readershipCountOf(count);
  if (!Number.isInteger(n) || n < READERSHIP_MIN) return null;
  if (n === 1) return "In one reader's library";
  return `In ${groupThousands(n)} readers' libraries`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// ⛔ THE PLATFORM GATE — one constant, and it is off
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The app cannot carry price, buy or purchase language. Readership is not any of those:
// "In 12 readers' libraries" names no sum of money, no transaction and no shop counter, so
// this component is portable to every platform exactly as it stands, and the gate below is
// open on all of them.
//
// IT EXISTS ANYWAY, because the brief asked for the day the wording changes to be one flag
// rather than a rewrite. If a future round ever prints "12 sold" here — a decision nobody has
// taken and this file does not invite — the register flips to 'sales' and the same line
// becomes money language the app may not render. Flipping REGISTER is then the entire
// per-platform gate: no call site changes, no component moves, and the two surfaces cannot
// disagree about which one they are showing, because they read the same constant.
//
// Same shape as the four flags this platform already runs on — MEMBERSHIPS_ON_SALE,
// BOOKSTORE_LAUNCHED, GATING_ENABLED and SERIES_TIER_GATE_ENABLED: real code, fully built,
// and set to the value today's ruling calls for.
export const REGISTER_READERSHIP = 'readership';
export const REGISTER_SALES = 'sales';

/** ⭑ THE FLAG. Ikenna's ruling, 19 Aug 2026: readership, not sales. */
export const READERSHIP_REGISTER = REGISTER_READERSHIP;

/**
 * Platforms that may render the line, by register.
 *
 * 'readership' — every platform. It is not money language; there is nothing to gate.
 * 'sales'      — web only, beside the existing money surfaces. The app's money wall is older
 *                than this feature and is not negotiable by a line that would look nice.
 */
export const READERSHIP_PLATFORMS = {
  [REGISTER_READERSHIP]: ['web', 'ios', 'android'],
  [REGISTER_SALES]: ['web'],
};

/**
 * May THIS platform print the line? Call sites pass their own platform; the web's components
 * default to 'web' so nothing on this repo's side has to thread it.
 *
 * `register` is a parameter rather than a closed-over constant purely so the harness can
 * assert both positions of the switch without editing the file — the pattern
 * app/lib/series/access.js established with TIER_GATE_OFF.
 */
export function readershipAllowedOn(platform = 'web', register = READERSHIP_REGISTER) {
  const allowed = READERSHIP_PLATFORMS[register];
  return Array.isArray(allowed) && allowed.includes(platform);
}

/**
 * The one call a surface makes: the string to print, or null.
 *
 * Folding the gate and the threshold into a single function is what makes "a title's line
 * appearing for the first time requires no code change" true — a surface renders
 * `readershipFor(node)` and never learns why the answer was null.
 */
export function readershipFor(node, platform = 'web', register = READERSHIP_REGISTER) {
  if (!readershipAllowedOn(platform, register)) return null;
  return readershipLine(readershipCountOf(node));
}
