// DESIDERATA — the books a reader has marked to come back to. W22, Ikenna's rulings of 27 Sept 2026:
//
//   75  the list is called Desiderata.
//   76  it lives ONLY in the Book Store, and a book already in your library never shows in it.
//   77  a readers line under every book on the shelf — the count, then the +. The + also goes on
//       the book's page, after its readership line.
//   79–81  no separate basket. Before launch each row has its own BUY on the proven checkout;
//       ticking several books and paying once comes later.
//
// THE NODE:  desiderata/{uid}/{titleId} = { addedAt: <server timestamp> }
// Private to its owner (database.rules.json), deleted with the account (OWNED_NODES), and
// handed to the app round in docs/APP-HANDOFF-DESIDERATA.md.
//
// This module is PURE — no firebase, no clock, no DOM — so tests/bookstore/desiderata.test.mjs
// can play every state the + can be in. The live store is ./desiderataStore.js.

export const DESIDERATA_PATH = 'desiderata';
export const DESIDERATA_ROUTE = '/bookstore/desiderata';
export const SEARCH_ROUTE = '/bookstore/search';

// ── THE WORDS ─────────────────────────────────────────────────────────────────────────────
// RULED lines were ruled with the canvas "Book Store rooms", 27 Sept 2026. DRAFT lines await
// Ikenna's word — docs/COPY-RULINGS.md carries both, and a draft changes there first.
export const DESIDERATA_COPY = {
  // RULED (canvas, 27 Sept)
  name: 'Desiderata',
  subline: 'Books you’ve marked to come back to.',
  foot: 'When a book comes into your library, it leaves this list.',
  added: 'Added to Desiderata. You’ll find it under the ribbon at the top of the shop.',
  searchHint: 'Titles, authors and genres on these shelves.',
  searchLabel: 'Search the shelves',
  // DRAFT — awaiting Ikenna
  removed: 'Removed from Desiderata',
  failed: 'Couldn’t save that change. Try again.',
  empty: 'Nothing marked yet. The + under any book on the shelves adds it here.',
  signedOut: 'Sign in to see your Desiderata.',
  noResults: (q) => `Nothing on these shelves matches “${q}”.`,
  // House words, not new copy.
  undo: 'Undo',
  signIn: 'Sign in',
};

/** The + and the disc, as a screen reader hears them. */
export const markLabel = (title, marked) => (marked
  ? `Take ${title} out of Desiderata`
  : `Add ${title} to Desiderata`);

/** "1 TITLE" / "N TITLES" — the hero's rule, uppercased by CSS. */
export const titlesLabel = (n) => `${n} ${n === 1 ? 'title' : 'titles'}`;

/** Is the title on sale? A withdrawn (or any non-published) title takes no +. */
export const isOnSale = (title) => !!title && title.status === 'published';

/**
 * Which state the + is in for one book.
 *
 *   'owned'     the book is in the reader's library (holdsBook — sales and comps alike): no +
 *   'off-sale'  not on sale (withdrawn): no +
 *   'marked'    in Desiderata: the filled disc
 *   'open'      the ring with its plus — including every book a signed-out reader sees
 */
export function markState({ owns = false, onSale = true, marked = false } = {}) {
  if (owns) return 'owned';
  if (!onSale) return 'off-sale';
  return marked ? 'marked' : 'open';
}

/** Does this state draw a + (ring or disc)? */
export const drawsMark = (state) => state === 'marked' || state === 'open';

/**
 * The room's rows, and the entries it should quietly remove.
 *
 *   entries    { titleId: { addedAt } } — the reader's node
 *   titlesById { titleId: title } — ONLY the titles on the shelves (the storefront's visibility)
 *   owned      Set of titleIds the reader holds
 *
 * A held book never shows and its entry is swept (ruling 76: "never shows in it"). A title no
 * longer on the shelves does not show either — but its entry STAYS: a withdrawn book can come
 * back, and the reader marked it. Newest first.
 */
export function roomRows(entries, titlesById, owned) {
  const rows = [];
  const sweep = [];
  for (const [titleId, entry] of Object.entries(entries || {})) {
    if (owned && owned.has(titleId)) { sweep.push(titleId); continue; }
    const title = titlesById ? titlesById[titleId] : null;
    if (!title || !isOnSale(title)) continue;
    const addedAt = Number(entry && entry.addedAt) || 0;
    rows.push({ titleId, addedAt, title });
  }
  rows.sort((a, b) => b.addedAt - a.addedAt || a.titleId.localeCompare(b.titleId));
  return { rows, sweep };
}

// ── THE WAITING ADD ───────────────────────────────────────────────────────────────────────
// A signed-out reader taps the +: AuthModal opens in place, and once they are signed in the
// book they tapped is added without a second tap. The tap is remembered for a short while and
// no longer — a reader who closed the modal and signed in an hour later elsewhere did not ask
// for that book to be added.
export const PENDING_KEY = 'cs_desiderata_pending_v1';
export const PENDING_TTL_MS = 10 * 60 * 1000;

export function readPending(raw, nowMs) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (!v || typeof v.titleId !== 'string' || !v.titleId || typeof v.at !== 'number') return null;
    if (nowMs - v.at > PENDING_TTL_MS || v.at > nowMs + 60_000) return null;
    return v.titleId;
  } catch { return null; }
}
