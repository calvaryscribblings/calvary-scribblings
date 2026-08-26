// ═══════════════════════════════════════════════════════════════════════════════════════════
// WITHDRAWAL AND DELETION — the two ways a title leaves the shop, and the one thing neither
// of them may ever touch.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// R21. Two standing rulings govern every line in this file, and they pull in opposite
// directions on purpose:
//
//   1. ADMIN HAS COMPLETE CONTROL over what the shop sells. No title is unremovable, for any
//      reason. There is no "you cannot delete this" branch below, and there must never be one.
//
//   2. WE NEVER TAKE BACK BOUGHT TITLES — "no grounds for that." A purchase is permanent. No
//      admin act removes a book from the library of someone who paid for it, and
//      functions/api/bookstore/stream.js keeps serving it forever.
//
// The two coexist because REMOVAL FROM THE SHOP AND REVOCATION FROM AN OWNER ARE DIFFERENT
// ACTS, and only the first one exists in this codebase. Withdrawal and deletion both operate
// on `bookstore_titles/{id}` and on Storage. Ownership lives at
// `bookstore_purchases/{uid}/{titleId}`, and NOTHING in this module, in admin-writes.js or in
// the CMS writes to that node at all. The only writer of a purchase record in the whole tree
// is functions/api/bookstore/_lib.js, reached only by the two payment webhooks, and the only
// thing that ever sets `status: 'revoked'` there is a refund or a chargeback — money going
// back, which is the one event that is not an admin taking a book away.
//
// ── WHY WITHDRAWAL IS A STATUS AND NOT A FLAG ──────────────────────────────────────────────
//
// Every public surface in this repo already asks exactly one question of a title:
//
//     status === 'published'
//
// app/bookstore/page.js, app/bookstore/[slug]/page.js (generateStaticParams AND
// generateMetadata), app/reader/[slug]/page.js, getAllPublishedTitles, getTitlesByGenre,
// getFeaturedTitles, getBestsellers and resolveSections all key on it. A withdrawal expressed
// as a NEW STATUS is therefore excluded from all of them by construction, with no new filter
// to add and — the point — none to forget. A withdrawal expressed as a boolean beside a
// still-'published' status would have needed nine new `&& !t.withdrawn` terms, and the round
// would have been one grep away from a title that left the shelf but kept its detail page.
//
// ⚠ TITLE_SCHEMA IS STILL LOCKED, AND THIS DID NOT UNLOCK IT. What R21 adds to schema.js is a
// member of the `status` ENUM, not a field: the shape of a title record is unchanged, and
// validateTitle's rule that a 'published' title must carry a cover and an EPUB is untouched.
// The withdrawal's own provenance — when, by whom, why, and what to put back — rides as a
// SCHEMA-EXTERNAL `withdrawal` block, exactly as samplePath, the Bookseller's Fields, the
// house glossary, the R18 author block and R20's coverSizes already do. The loader spreads it
// through untouched and database.rules.json has no `$other` deny on bookstore_titles to refuse
// it.
//
// ── AND WHY DELETION IS NOT A STATUS ───────────────────────────────────────────────────────
//
// Because ruling 1 says so. `deleteTitle` in this repo used to be
// `setTitleStatus(id, 'unpublished')` — a soft delete wearing a hard delete's name, with a
// comment reading "Hard delete is a manual Firebase Console operation." That is precisely the
// state ruling 1 was made against: Ikenna could not remove a title at all, and the honest
// answer was a console. R21 makes deletion real, and withdrawal is what the soft act was
// always trying to be.
//
// This module is PURE. No firebase import, no clock read, no network. Every decision below is
// a function of its arguments, so tests/bookstore/withdrawal.test.mjs can play the whole state
// machine — including "an owner of a deleted title can still stream it" — without a database.

import { SECTION_TYPES } from './sections.js';

// ── THE VOCABULARY ─────────────────────────────────────────────────────────────────────────

/** The status. Added to TITLE_STATUSES in schema.js; see the note there. */
export const WITHDRAWN = 'withdrawn';

/** The schema-external block's key on the title record. */
export const WITHDRAWAL_KEY = 'withdrawal';

/**
 * What a withdrawn title goes back to.
 *
 * ALWAYS 'published', and deliberately not `previousStatus`. Only a published title can be
 * withdrawn — a draft leaving the shelf is not a withdrawal, it is a draft — so the block
 * records the previous status for the audit trail and this function ignores it. Reading it
 * back would mean a hand-edited record could restore a title into a status it was never in.
 */
export const RESTORE_STATUS = 'published';

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isMs = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0;

// Long enough for a licence note, short enough that it cannot be used as storage. Matches the
// spirit of the revokedReason cap on the purchase side.
export const MAX_WITHDRAWAL_REASON = 400;

// ── THE BLOCK ──────────────────────────────────────────────────────────────────────────────

/**
 * The `withdrawal` block, normalised.
 *
 *   scheduledFor  ms|null   the licence's end date. null = withdraw now.
 *   appliedAt     ms|null   when the flip to 'withdrawn' actually happened. null while a
 *                           scheduled withdrawal is still in the future.
 *   by            uid|null  who set it
 *   reason        str|null  free text, for the founder's own record
 *   previousStatus str|null what the title held when the withdrawal was set — audit only
 *
 * EMPTY NORMALISES TO null, never {}. Same shape decision the glossary made in loader.js and
 * coverSizes made in admin-writes.js: a caller tests `title.withdrawal` without also testing
 * Object.keys().length, and RTDB drops an empty object anyway, so null says it plainly.
 */
export function normaliseWithdrawal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  if (isMs(input.scheduledFor)) out.scheduledFor = input.scheduledFor;
  if (isMs(input.appliedAt)) out.appliedAt = input.appliedAt;
  if (isStr(input.by)) out.by = input.by.trim();
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason) out.reason = reason.slice(0, MAX_WITHDRAWAL_REASON);
  if (isStr(input.previousStatus)) out.previousStatus = input.previousStatus;
  return Object.keys(out).length ? out : null;
}

/** Shape errors, in the same never-throw style as validateTitle. */
export function validateWithdrawal(block) {
  const errors = [];
  if (block === null || block === undefined) return errors;
  if (typeof block !== 'object' || Array.isArray(block)) {
    return ['withdrawal must be an object or null'];
  }
  if (block.scheduledFor !== undefined && !isMs(block.scheduledFor)) {
    errors.push('withdrawal.scheduledFor must be a positive millisecond timestamp');
  }
  if (block.appliedAt !== undefined && !isMs(block.appliedAt)) {
    errors.push('withdrawal.appliedAt must be a positive millisecond timestamp');
  }
  if (block.reason !== undefined && typeof block.reason !== 'string') {
    errors.push('withdrawal.reason must be a string when present');
  }
  if (typeof block.reason === 'string' && block.reason.length > MAX_WITHDRAWAL_REASON) {
    errors.push(`withdrawal.reason must be ${MAX_WITHDRAWAL_REASON} characters or fewer`);
  }
  return errors;
}

/** The one test every surface should use, rather than repeating the string. */
export function isWithdrawn(title) {
  return !!title && title.status === WITHDRAWN;
}

/**
 * Is this title SCHEDULED to be withdrawn and not yet withdrawn?
 *
 * A fixed-term licence is set once — "this comes off the shelf on 31 March" — and the record
 * carries the date from the moment it is set. Until the date passes the title is an ordinary
 * published title, on the shelf, sellable, in every section that claims it. Nothing about a
 * pending withdrawal is visible to a reader, and that is correct: a book on a two-year licence
 * is not a book with a countdown printed on it.
 */
export function isScheduled(title) {
  return !!title
    && title.status === 'published'
    && isMs(title?.[WITHDRAWAL_KEY]?.scheduledFor);
}

/**
 * Has a scheduled withdrawal come due?
 *
 * ⚠ THIS IS A PREDICATE, NOT A MECHANISM, and the difference is the whole honesty of the
 * feature. next.config.mjs sets output:'export'. Every /bookstore/{slug} is a FILE, enumerated
 * at build time. A date passing changes NOTHING a reader can see: the shelf they are looking
 * at was rendered by the last deploy, and it will keep serving the withdrawn book until
 * another build runs. There is no clock in a static file.
 *
 * So a date-based withdrawal needs TWO things this function is only half of:
 *   · something that flips the record when the date passes  → scripts/bookstore/withdrawals.mjs
 *   · something that runs a build afterwards                 → the deploy hook that script fires
 * and that pair is on a schedule at .github/workflows/withdrawals.yml. Read the header there
 * for the latency, stated honestly. If that workflow is ever removed, scheduled withdrawal
 * stops working and this function keeps returning true to nobody.
 *
 * `<=` and not `<`: the licence ends AT the date, so the millisecond it names is already out.
 */
export function withdrawalDue(title, nowMs) {
  if (!isScheduled(title)) return false;
  if (!Number.isFinite(nowMs)) return false;   // no clock, no dated decision — as sections.js
  return title[WITHDRAWAL_KEY].scheduledFor <= nowMs;
}

/** Every title whose licence has run out, for the reconciler. */
export function dueWithdrawals(titles, nowMs) {
  return (titles || []).filter((t) => withdrawalDue(t, nowMs));
}

/**
 * The block to write when a withdrawal is APPLIED (immediately, or by the reconciler).
 *
 * `scheduledFor` is preserved when it was a dated licence, so the record still says WHY the
 * book left rather than only when the flip ran.
 */
export function applyWithdrawalBlock({ existing, previousStatus, by, reason, nowMs }) {
  return normaliseWithdrawal({
    ...(normaliseWithdrawal(existing) || {}),
    scheduledFor: existing?.scheduledFor,
    appliedAt: nowMs,
    by,
    reason: reason ?? existing?.reason,
    previousStatus: previousStatus || 'published',
  });
}

// ── THE STATE MACHINE ──────────────────────────────────────────────────────────────────────
//
// published ──withdraw──→ withdrawn ──restore──→ published
//     │                        │
//     └────────delete──────────┴──────→ (gone; a tombstone, and the owners' copies)
//
// draft and unpublished may be deleted too — ruling 1, no title is unremovable — but they
// cannot be WITHDRAWN, because there is nothing to withdraw them from.

export const WITHDRAWABLE_FROM = ['published'];

/** Can this title be withdrawn? Returns an error string, or null when it can. */
export function withdrawalRefusal(title) {
  if (!title) return 'Title not found';
  if (isWithdrawn(title)) return 'This title is already withdrawn';
  if (!WITHDRAWABLE_FROM.includes(title.status)) {
    return `Only a published title can be withdrawn (this one is '${title.status}'). `
      + 'Delete it if it should not exist at all.';
  }
  return null;
}

/** Can this title be restored? Returns an error string, or null when it can. */
export function restoreRefusal(title) {
  if (!title) return 'Title not found';
  if (!isWithdrawn(title)) return `Only a withdrawn title can be restored (this one is '${title.status}')`;
  // The validator's own rule, restated here so the failure names the missing file rather than
  // arriving as a generic validation error from three frames up.
  if (!isStr(title.coverUrl) || !isStr(title.epubPath)) {
    return 'A restored title goes straight back on the shelf, so it needs its cover and its EPUB';
  }
  return null;
}

// ── OWNERS ─────────────────────────────────────────────────────────────────────────────────

/**
 * The owner count, as a thing that can be UNKNOWN.
 *
 * bookstore_readership/{titleId}/count is the number of purchase records whose status is
 * 'active' — see the ledger note in readership.js. It is the only number a client may learn,
 * because bookstore_purchases is readable per-uid and cannot be aggregated in a browser, and
 * it is written by the SAME atomic multi-path update that records each purchase, so it cannot
 * drift from the grants it counts.
 *
 * THE THIRD STATE IS LOAD-BEARING. `{ ok: false }` — the read failed — is not zero. A delete
 * that treats an unreadable count as "nobody owns it" would delete a master EPUB out from
 * under a reader, which is ruling 2 broken by a network hiccup. Every consumer below fails
 * CLOSED on it.
 *
 * An ABSENT node is a genuine zero, and that is the node's documented contract: absent means
 * nobody has bought it.
 */
export const OWNERS_UNKNOWN = Object.freeze({ ok: false, count: null });
export const ownersKnown = (count) => Object.freeze({ ok: true, count });

// ── THE CONFIRM STEP ───────────────────────────────────────────────────────────────────────

const WORDS = ['No one', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve'];

/** Grouping separators, hand-rolled — reused from readership.js's argument about locales. */
function group(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * "Nine readers own this book." — the count, in words, from LIVE DATA.
 *
 * Words up to twelve and digits above, which is where a number stops reading as a quantity a
 * person can picture and starts reading as a figure. The same instinct as readership.js's
 * refusal to print "1 sales".
 */
export function ownersSentence(count) {
  if (!Number.isInteger(count) || count < 0) return null;
  if (count === 0) return 'No one owns this book yet.';
  if (count === 1) return 'One reader owns this book.';
  const n = count <= 12 ? WORDS[count] : group(count);
  return `${n} readers own this book.`;
}

/**
 * THE WHOLE CONSEQUENCE, IN PLAIN WORDS, BEFORE IT HAPPENS.
 *
 * ⚠ NEVER A BARE 'ARE YOU SURE'. A confirm step that asks whether you are sure tells you
 * nothing you did not already know and trains you to click through it. This one states the
 * only two facts that matter and gets the reassuring one FIRST, because the founder's actual
 * fear at this moment — the one ruling 2 exists to answer — is that deleting a book takes it
 * off nine people's shelves. It does not, and the dialog says so before it says anything else.
 *
 * Returns null when the count is unknown. A confirm step that cannot count is not allowed to
 * guess a number, and admin-writes.js refuses the delete rather than showing a dialog with a
 * hole in it.
 */
export function confirmConsequence(count) {
  const owners = ownersSentence(count);
  if (!owners) return null;
  if (count === 0) {
    return `${owners} Deleting removes it from the shop and from the catalogue, `
      + 'and takes its cover and sample files with it.';
  }
  return `${owners} They keep it — it will stay in their library and they can still read it. `
    + 'Deleting removes it from the shop and from the catalogue.';
}

/**
 * The typed-name check.
 *
 * Trimmed, whitespace-collapsed and case-insensitive, for gate.js's reason: the founder is
 * copying a title off the row above on a keyboard that will capitalise for them, and a check
 * that rejects "the quiet house" is not safer than one that accepts it — only ruder. What it
 * IS for is making the act deliberate: you cannot type a title you did not mean to delete.
 */
export function nameMatches(typed, titleName) {
  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const t = norm(titleName);
  return !!t && norm(typed) === t;
}

// ── THE DELETION PLAN ──────────────────────────────────────────────────────────────────────

/**
 * A Firebase Storage download URL back to its object path.
 *
 * `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<percent-encoded path>?alt=media&…`
 *
 * Returns null for anything that is not one — a hand-pasted external URL, a gs:// URI, an
 * empty string. Null means "not ours to delete", which is the correct direction: an object
 * this function cannot name is left alone rather than guessed at.
 */
export function storagePathFromDownloadUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  const m = /\/v0\/b\/[^/]+\/o\/([^?]+)/.exec(url);
  if (!m) return null;
  try {
    const path = decodeURIComponent(m[1]);
    return path && !path.includes('..') ? path : null;
  } catch {
    return null;
  }
}

export const masterPathFor = (titleId) => `bookstore_epubs/${titleId}/master.epub`;
export const samplePathFor = (titleId) => `bookstore_epubs/${titleId}/sample.epub`;

/**
 * WHAT DELETION TOUCHES IN STORAGE, AND WHAT IT REFUSES TO TOUCH.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MASTER EPUB IS NOT DELETED IF ANYONE OWNS THE BOOK. THIS IS RULING 2, AT THE ONE
 *    PLACE IN THE CODEBASE WHERE IT COULD BE BROKEN.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * functions/api/bookstore/stream.js signs a URL for `bookstore_epubs/{titleId}/master.epub`
 * after checking ONE thing: that bookstore_purchases/{uid}/{titleId}.status === 'active'. It
 * never reads the title record. So a deleted title's owner still passes the entitlement check
 * and still gets a signed URL — the endpoint is untouched by this round and needs to be — and
 * the ONLY way deletion could take a paid-for book away is by deleting the bytes that URL
 * points at. That is the failure this function exists to make impossible.
 *
 * The cover object is held on the same condition, for a narrower reason: the tombstone carries
 * `coverUrl`, and app/my-library/page.js renders it as a bare <img src>. Delete the object and
 * every owner's shelf shows a broken-image glyph where their book was — a book they own,
 * rendering as a fault. So the ONE object the tombstone points at survives with the master.
 * The derivatives do not: nothing an owner sees reads coverSizes.
 *
 * When nobody owns the book, everything goes. Ruling 1 — no title is unremovable.
 *
 * ⚠ AN UNKNOWN OWNER COUNT DELETES NOTHING FROM STORAGE. See OWNERS_UNKNOWN above.
 */
export function deletionPlan({ titleId, title, owners }) {
  const del = [];
  const held = [];
  const t = title || {};

  if (!owners || owners.ok !== true) {
    return {
      ok: false,
      reason: 'The number of owners could not be read, so no files were deleted.',
      delete: [],
      held: [masterPathFor(titleId)],
    };
  }

  const owned = owners.count > 0;
  const coverPath = storagePathFromDownloadUrl(t.coverUrl);

  // ⛔ RULING 2. Held, not deleted, and named in `held` so the caller can say why.
  if (owned) held.push(masterPathFor(titleId));
  else del.push(masterPathFor(titleId));

  if (coverPath) {
    if (owned) held.push(coverPath);
    else del.push(coverPath);
  }

  // The sample is the shop's free chapter. NOTHING an owner holds points at it — My Library
  // links to /reader/{slug} and the reader streams the master — so it goes unconditionally.
  // A deleted title whose free chapter was still fetchable would be the delisted-book hole
  // app/reader/[slug]/page.js already documents, reopened one prefix along.
  del.push(samplePathFor(titleId));

  // R20's rungs. Only the shop renders a srcset; My Library does not, so these never survive.
  const sizes = t.coverSizes && typeof t.coverSizes === 'object' ? t.coverSizes : null;
  if (sizes) {
    for (const key of Object.keys(sizes)) {
      const p = storagePathFromDownloadUrl(sizes[key]);
      if (p && p !== coverPath) del.push(p);
    }
  }

  // R18's author photograph — a detail-page object, and the detail page is going.
  if (isStr(t.authorPhotoPath)) del.push(t.authorPhotoPath);

  return {
    ok: true,
    owned,
    reason: owned
      ? `${owners.count} reader${owners.count === 1 ? '' : 's'} own this book, so the master EPUB and its cover stay in Storage.`
      : 'Nobody owns this book, so every file it owns is removed.',
    delete: [...new Set(del)],
    held,
  };
}

// ── THE TOMBSTONE ──────────────────────────────────────────────────────────────────────────

/**
 * What is left behind at bookstore_titles_deleted/{titleId} when a title is deleted.
 *
 * ⚠ MY LIBRARY DOES NOT NEED THIS TO RENDER, AND THAT WAS VERIFIED BEFORE IT WAS WRITTEN.
 * app/my-library/page.js resolves every display field with a fallback chain —
 * `titleDoc?.title || p.title || 'Untitled'`, and the same for slug, author and coverUrl —
 * and functions/api/bookstore/_lib.js's denormalisedFields() has been writing exactly those
 * four onto every purchase record since R8.2. So an owner's shelf already survives a missing
 * title record and renders the book normally, with its cover, its author and a working
 * Read now. The tombstone is NOT load-bearing for the shelf.
 *
 * It exists for the two things the purchase record does NOT carry:
 *   · catalogueNumber — the bookplate's mark. My Library reads it from the title doc only, so
 *     without a tombstone a deleted title's plate silently loses its "CS 007".
 *   · the record that the deletion happened at all — who, when, and what number was used, so
 *     rule C's "the sequence keeps its gap" can be checked rather than trusted.
 *
 * It is a SEPARATE NODE and not a soft-deleted title, deliberately. A record left under
 * bookstore_titles with a `deleted: true` flag is a record every one of the nine readers of
 * that node has to remember to exclude, forever, and the round is one forgotten filter away
 * from a deleted book on the shelf. Moving it out means the shop cannot see it at all.
 */
export function tombstoneOf({ titleId, title, by, nowMs, ownerCount }) {
  const t = title || {};
  return {
    titleId,
    slug: isStr(t.slug) ? t.slug : titleId,
    title: isStr(t.title) ? t.title : null,
    author: isStr(t.author) ? t.author : null,
    coverUrl: isStr(t.coverUrl) ? t.coverUrl : null,
    catalogueNumber: Number.isInteger(t.catalogueNumber) ? t.catalogueNumber : null,
    publisherId: isStr(t.publisherId) ? t.publisherId : null,
    deletedAt: nowMs,
    deletedBy: by || null,
    // The count AT THE MOMENT OF DELETION. Not maintained afterwards — it is a note about why
    // the master EPUB is or is not still in the bucket, not a live figure.
    ownersAtDeletion: Number.isInteger(ownerCount) ? ownerCount : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE CATALOGUE NUMBER OF A REMOVED TITLE IS NEVER REUSED.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Rule C, and it is enforced by ABSENCE rather than by a check: nothing in this repo allocates
// a catalogue number. `catalogueNumber` is typed into a field by hand in the CMS
// (app/admin/bookstore/page.js), validated only as a positive integer, and the panel's
// duplicate map is a WARNING and not a refusal. There is no next-number function to fix,
// because a sequence that assigned itself would be an index — and CS 004 is already a gap the
// shop keeps on purpose.
//
// So the rule that needs writing down is the one a future round would break by adding the
// convenience: THE NUMBERS RECORD WHAT WAS CHOSEN, NOT WHERE A TITLE SITS IN A LIST. Deleting
// CS 007 does not free 007. The tombstone above keeps the number so the gap has a reason
// attached to it, and `takenCatalogueNumbers` below is what a CMS should ask before offering
// one — live titles AND tombstones, never live titles alone.
export function takenCatalogueNumbers(titles, tombstones) {
  const taken = new Map();
  for (const t of titles || []) {
    if (Number.isInteger(t?.catalogueNumber)) taken.set(t.catalogueNumber, { kind: 'title', id: t.id || t.slug, title: t.title });
  }
  for (const g of tombstones || []) {
    if (Number.isInteger(g?.catalogueNumber) && !taken.has(g.catalogueNumber)) {
      taken.set(g.catalogueNumber, { kind: 'deleted', id: g.titleId, title: g.title });
    }
  }
  return taken;
}

// ── CURATION CLAIMS ────────────────────────────────────────────────────────────────────────

/**
 * REMOVING A TITLE REMOVES THE CLAIM. Rule C.
 *
 * ⚠ AND IT IS ONLY DELETION THAT DOES THIS, NOT WITHDRAWAL. The two acts differ in exactly
 * the way that decides it:
 *
 *   WITHDRAWAL IS REVERSIBLE, so the claim is LEFT ALONE. resolveSections() already resolves
 *   every claim against the published catalogue and silently drops a slug that is not in it
 *   ("a title the curator claimed and then unpublished simply leaves the section"), so a
 *   withdrawn title is out of every section the moment its status flips, with nothing written.
 *   Pruning the claim as well would mean restoring the title put it back on the shelf but NOT
 *   back in the Editor's Choice it was chosen for — the curator's decision quietly destroyed
 *   by an act that advertises itself as reversible.
 *
 *   DELETION IS NOT REVERSIBLE, so the claim is pruned. The slug can never resolve again, and
 *   a claim naming a title that cannot exist is a section pointing at nothing.
 *
 * THE EIGHT SILENT-DROP CONDITIONS STILL HOLD. This prunes the slug and stops. It does NOT
 * retire a section that falls below its `min`, does not back-fill a replacement, and does not
 * report an empty state — resolveSections drops the section itself, silently, which is the
 * constitutional rule at the head of sections.js. A curation system whose sections could be
 * deleted by a title deletion would be one where removing a book edits the curator's shelf.
 *
 * Returns RTDB patch paths relative to `bookstore_sections`, plus what changed, so the caller
 * can fold them into the same atomic update as the deletion itself.
 */
export function pruneClaims(sections, slug, nowMs) {
  const patch = {};
  const touched = [];
  if (!isStr(slug)) return { patch, touched };

  for (const raw of sections || []) {
    const spec = SECTION_TYPES[raw?.type];
    // A data-driven section stores no slugs — its claim is an aggregate, not a curator's list.
    // Writing a `slugs` key onto one would invent a claim validateSection forbids.
    if (!spec || spec.dataDriven) continue;
    const slugs = Array.isArray(raw.slugs) ? raw.slugs : null;
    if (!slugs || !slugs.includes(slug)) continue;

    const next = slugs.filter((s) => s !== slug);
    // RTDB removes a key written as an empty array, which is exactly right: a section with no
    // claim is an unmade claim, and an unmade claim is silence.
    patch[`${raw.id}/slugs`] = next.length ? next : null;
    patch[`${raw.id}/updatedAt`] = nowMs;
    touched.push({ id: raw.id, type: raw.type, from: slugs.length, to: next.length });
  }
  return { patch, touched };
}
