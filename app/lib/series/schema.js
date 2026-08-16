// THE SERIES SCHEMA — shape only. Referential integrity (does this seriesId exist?) is the
// writer's job, exactly as validateTitle leaves publisherId existence to admin-writes.js.
//
// ── THE VOCABULARY IS "INSTALMENT" ───────────────────────────────────────────────────────
//
// One word, one spelling, everywhere: field names, copy, row labels, card badges, log lines.
// British single-L. The membership copy deck said "episode" in its October entry and was
// corrected in the same round that shipped this file — a deck asserted against the live page
// by tests/membership/deck-parity.test.mjs cannot be allowed to name the thing differently
// from the schema that stores it.
//
// ── THREE NODES, AND THE SPLIT IS THE RELEASE GATE ───────────────────────────────────────
//
//   series/{seriesId}                    public. The parent: title, synopsis, poster.
//   series_instalments/{instalmentId}    public. The ROW — everything a locked card may show.
//   series_instalments_detail/{id}       DENY-UNTIL-RELEASE. Title, author, the epub pointer.
//
// This is not tidiness. `cms_stories` is `.read: true` and an unpublished story record is
// readable by anyone with curl — measured, 182 keys on the node against 168 in the index, so
// fourteen unpublished records are public right now. The bookstore is better but not enough:
// `bookstore_titles` is also `.read: true` and only `master.epub` is `read: false`, so its
// drafts leak title, synopsis and cover. Neither shape can deliver "nobody sees it before the
// date", so neither was copied.
//
// WHAT THE PUBLIC ROW MAY CARRY is decided by one question: would a reader learn anything
// from it before release that we did not choose to tell them? `ordinal`, `releaseAtMs`,
// `status` and `freeForGold` all answer no — "instalment 4, 14 October, Platinum" IS the
// locked card, and printing it is the point. `title`, `synopsis`, `author` and `epubPath`
// answer yes, so they live in the detail node behind the rule.
//
// THE RULE IS SERVER TIME, NOT A CRON. database.rules.json reads
// `root.child('series_instalments').child($id).child('releaseAtMs').val() <= now` — `now` is
// the RTDB server clock. Nothing has to run at midnight, nothing can forget to, and a
// release cannot be brought forward by a device with a wrong clock. That is the whole reason
// releaseAtMs is EPOCH MILLISECONDS and not an ISO date string: a rules expression can
// compare a number to `now` and cannot parse a date. It is also the reason the field is
// named for what it is. This codebase has shipped that mistake twice — activePass()'s
// `expiresAt` and publishedAtMsFor()'s refusal to guess both carry the scar in their
// comments — and both times the failure was a string silently comparing as a string.

export const SCHEMA_VERSION = 1;

export const SERIES_PATH = 'series';
export const INSTALMENTS_PATH = 'series_instalments';
export const INSTALMENTS_DETAIL_PATH = 'series_instalments_detail';
export const PROGRESS_PATH = 'series_reading_progress';

/** Series and instalments share a status vocabulary with bookstore titles, deliberately. */
export const SERIES_STATUSES = ['draft', 'published', 'unpublished'];
export const INSTALMENT_STATUSES = ['draft', 'published', 'unpublished'];

// ── THE PARENT ───────────────────────────────────────────────────────────────────────────
//
// NOTE WHAT IS ABSENT: there is no instalmentCount. The bookstore's titlesCount was examined
// and rejected as a model, for two independent reasons.
//
//   1. IT NEVER DECREMENTS. createTitle() bumps it with increment(1); deleteTitle() is
//      `setTitleStatus(id, 'unpublished')`, a soft delete that touches no counter. So
//      titlesCount is a created-ever count wearing the name of a live one.
//   2. EVEN CORRECT, IT COULD NOT SAY THE RIGHT THING. The number a reader needs is
//      "instalments released SO FAR", which changes at a moment nothing writes to the
//      database. A stored integer cannot express a value whose transitions are clock-driven.
//
// releasedCount() below derives it from the rows, at read time, against the caller's clock.
export const SERIES_SCHEMA = {
  schemaVersion: 'integer',
  slug: 'string',
  title: 'string',
  synopsis: 'string',
  // The POSTER. Distinct from any instalment's own art by design — a series card is the
  // Netflix-style tile for the whole run, and the three live multi-part works on the site
  // show why one cannot be borrowed from an instalment: the two Halfway Around the Moon
  // records share a byte-identical cover (same coverHash), the two Beta Princess parts do
  // not, and neither pair has anything that reads as a poster for the series.
  coverUrl: 'string|null',
  status: 'enum:SERIES_STATUSES',
  addedAt: 'integer',
  updatedAt: 'integer',
};

// ── THE PUBLIC ROW ───────────────────────────────────────────────────────────────────────
export const INSTALMENT_SCHEMA = {
  schemaVersion: 'integer',
  // Locked after creation by updateInstalment(), mirroring updateTitle()'s treatment of
  // publisherId — "reassigning a publisher requires a manual operation so titlesCount stays
  // consistent". The reason here is different and stronger: an instalment that changes
  // parent takes its ordinal, its release date and any reader's stored position into a run
  // where none of them mean the same thing.
  seriesId: 'string',
  ordinal: 'integer',           // 1-based, unique within a series
  releaseAtMs: 'integer',       // epoch ms, UTC. See the header.
  freeForGold: 'boolean',       // explicit. NEVER inferred from ordinal === 1.
  status: 'enum:INSTALMENT_STATUSES',
  addedAt: 'integer',
  updatedAt: 'integer',
};

// ── THE DETAIL RECORD, BEHIND THE RELEASE RULE ───────────────────────────────────────────
//
// author/authorUid/authorHandle are here and are NOT optional. An instalment without them is
// invisible to Voices, to search, and to the app's profile → myStories list, all three of
// which key off authorUid — the same three surfaces app/lib/storyIndex.js's header warns
// about when it forbids dropping authorHandle from the story index.
//
// epubPath is RECORDED AND NEVER READ AT SERVE TIME. functions/api/series/stream.js derives
// the object path from the instalment id instead, which is verbatim what
// functions/api/bookstore/stream.js does and for the reason its header gives: "a second RTDB
// round-trip to learn a constant would cost latency on every open". The field exists so the
// admin surface can show what was uploaded and so a human reading the record can see it.
//
// ── R12.4: logline, sponsor, wordCount — AND WHY THEY ARE HERE AND NOT ON THE ROW ────────
//
// Run them through the header's one question — would a reader learn anything from this before
// release that we did not choose to tell them? All four answer YES, so all four are behind
// the rule alongside title.
//
//   logline          The one-sentence pitch. It is a smaller title, not a lesser one.
//   sponsorName      A SPONSOR CREDIT IS STILL A REVEAL. "Instalment 5 is brought to you by
//                    X" tells a reader, and a competitor, and X's competitor, something
//                    nobody has announced. That it is a commercial line rather than an
//                    editorial one does not make it public early; if anything the commercial
//                    line is the one with a party who would rather choose the moment.
//   sponsorLogoUrl   Same reveal, in a picture. The URL is the secret, exactly as coverUrl
//                    already is: the OBJECT is public-read under series_covers/** (a locked
//                    instalment still shows its art, see storage.rules), and what keeps an
//                    unreleased sponsor hidden is that the unguessable download URL naming it
//                    lives on this denied node. Identical posture to the instalment cover,
//                    inherited on purpose rather than invented.
//   wordCount        A number, but a number derived FROM THE PROSE. "Instalment 6 is 14,000
//                    words" is a fact about an unpublished manuscript. It is also the input
//                    to a reading time we print next to the title, so it belongs with it.
//
// wordCount IS WRITTEN BY THE EPUB UPLOADER, NEVER BY AN EDITOR. See readingMinutes() in
// ./format.js for how it is spent and app/lib/series/admin-writes.js:uploadInstalmentEpub for
// where it comes from — the same bytes, in the same call, so the count cannot describe a file
// that is no longer there. There is deliberately no admin input bound to it: a typed figure
// is stale the moment a chapter is revised, and nothing in the record would say so.
export const INSTALMENT_DETAIL_SCHEMA = {
  schemaVersion: 'integer',
  title: 'string',
  synopsis: 'string|null',
  logline: 'string|null',
  author: 'string',
  authorUid: 'string',
  authorHandle: 'string',
  coverUrl: 'string|null',
  epubPath: 'string|null',
  sponsorName: 'string|null',
  sponsorLogoUrl: 'string|null',
  wordCount: 'integer|null',
  updatedAt: 'integer',
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Deliberately the SAME expression as TITLE_ID_RE in functions/api/bookstore/stream.js. It is
// not a slug check — it is the thing that stops a crafted id walking out of series_epubs/ and
// signing a URL for another object in the bucket.
export const INSTALMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isBool = (v) => typeof v === 'boolean';
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The Cloud Storage object path for an instalment's EPUB. ONE definition.
 *
 * The endpoint derives, the admin uploader writes, and the record's epubPath records — all
 * three through this function, so the three can never disagree about where the bytes are.
 */
export function epubObjectPath(instalmentId) {
  return `series_epubs/${instalmentId}/master.epub`;
}

/**
 * The series_covers/ key prefix for an instalment's own art, and for its sponsor's logo.
 *
 * TWO PREFIXES UNDER ONE INSTALMENT, so a bucket listing reads as itself. Both land under
 * `series_covers/**`, which storage.rules already opens to public read and admin-only write at
 * 5 MB and `image/*` — a NESTED path matches because that rule uses `{allPaths=**}`, so this
 * needed no rules change and got none.
 *
 * These are the only two callers' definition of the key, for the same reason epubObjectPath()
 * above is the only definition of the object path: the uploader writes it and the record
 * stores what came back, and a second spelling somewhere would put a sponsor logo in a folder
 * nobody looks in.
 */
export function instalmentImageKey(instalmentId, kind) {
  if (kind !== 'cover' && kind !== 'sponsor') throw new Error(`unknown image kind: ${kind}`);
  return `${instalmentId}/${kind}`;
}

export function validateSeries(doc) {
  const errors = [];
  if (!isPlainObj(doc)) return { valid: false, errors: ['doc is not an object'] };

  if (!isInt(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');
  if (!isStr(doc.slug)) errors.push('slug is required');
  else if (!SLUG_RE.test(doc.slug)) errors.push('slug must be kebab-case (lowercase, digits, hyphens)');
  if (!isStr(doc.title)) errors.push('title is required');
  if (!isStr(doc.synopsis)) errors.push('synopsis is required');

  // Same rule as bookstore v2 assets: required when published, null (never '') otherwise, so
  // a misconfigured record fails at the writer rather than rendering a broken poster.
  const publishing = doc.status === 'published';
  if (publishing) {
    if (!isStr(doc.coverUrl)) errors.push("coverUrl is required when status is 'published'");
  } else if (doc.coverUrl === '') {
    errors.push('coverUrl must be null (not empty string) when not published');
  } else if (doc.coverUrl !== null && doc.coverUrl !== undefined && !isStr(doc.coverUrl)) {
    errors.push('coverUrl must be a non-empty string or null');
  }

  if (!SERIES_STATUSES.includes(doc.status)) errors.push(`status must be one of: ${SERIES_STATUSES.join(', ')}`);
  if (!isInt(doc.addedAt) || doc.addedAt <= 0) errors.push('addedAt must be a positive integer (millisecond timestamp)');
  if (!isInt(doc.updatedAt) || doc.updatedAt <= 0) errors.push('updatedAt must be a positive integer (millisecond timestamp)');

  return { valid: errors.length === 0, errors };
}

export function validateInstalment(doc) {
  const errors = [];
  if (!isPlainObj(doc)) return { valid: false, errors: ['doc is not an object'] };

  if (!isInt(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');
  if (!isStr(doc.seriesId)) errors.push('seriesId is required');
  if (!isInt(doc.ordinal) || doc.ordinal < 1) errors.push('ordinal must be a positive integer (1-based)');

  // The whole release gate rests on this being a number. A string here would compare against
  // `now` as a string in the database rule and, being lexicographically larger than most
  // millisecond values it might meet, would deny forever or release immediately depending on
  // the digits — either way, silently.
  if (!isInt(doc.releaseAtMs) || doc.releaseAtMs <= 0) {
    errors.push('releaseAtMs must be a positive integer (epoch milliseconds, UTC)');
  }

  // Presence AND type, not truthiness. `freeForGold: undefined` on a record the admin form
  // forgot to set must fail here rather than default quietly to false — a Gold taste that
  // silently never opens is indistinguishable from a working gate until someone complains.
  if (!isBool(doc.freeForGold)) errors.push('freeForGold must be a boolean (explicit — never inferred from ordinal)');

  if (!INSTALMENT_STATUSES.includes(doc.status)) errors.push(`status must be one of: ${INSTALMENT_STATUSES.join(', ')}`);
  if (!isInt(doc.addedAt) || doc.addedAt <= 0) errors.push('addedAt must be a positive integer (millisecond timestamp)');
  if (!isInt(doc.updatedAt) || doc.updatedAt <= 0) errors.push('updatedAt must be a positive integer (millisecond timestamp)');

  return { valid: errors.length === 0, errors };
}

export function validateInstalmentDetail(doc, { publishing = false } = {}) {
  const errors = [];
  if (!isPlainObj(doc)) return { valid: false, errors: ['doc is not an object'] };

  if (!isInt(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');
  if (!isStr(doc.title)) errors.push('title is required');
  if (doc.synopsis !== null && doc.synopsis !== undefined && !isStr(doc.synopsis)) {
    errors.push('synopsis must be a non-empty string or null');
  }

  // All three, always. See the schema note above — dropping one of them is free at the
  // writer and blanks a name on three screens in another codebase.
  if (!isStr(doc.author)) errors.push('author is required');
  if (!isStr(doc.authorUid)) errors.push('authorUid is required (Voices, search and myStories key off it)');
  if (!isStr(doc.authorHandle)) errors.push('authorHandle is required (rendered by the app on three surfaces)');

  // The nullable strings, all under the SAME rule the bookstore's v1→v2 migration was needed
  // to establish: absent is null, never ''. An empty string is truthy in none of the render
  // paths and falsy in all of them, which means it renders as an empty italic line or an
  // <img src=""> rather than as nothing, and the record looks populated in the admin while the
  // page shows a hole.
  for (const field of ['coverUrl', 'epubPath', 'logline', 'sponsorName', 'sponsorLogoUrl']) {
    const v = doc[field];
    if (publishing && field === 'epubPath') {
      if (!isStr(v)) errors.push("epubPath is required when the instalment is 'published'");
    } else if (v === '') {
      errors.push(`${field} must be null (not empty string)`);
    } else if (v !== null && v !== undefined && !isStr(v)) {
      errors.push(`${field} must be a non-empty string or null`);
    }
  }

  // A LOGO WITH NO NAME IS NOT A CREDIT. The sponsor line is a tile beside two lines of text,
  // the second of which is the name; with a logo and no name it renders as an unattributed
  // mark next to "this instalment made possible by" and a blank — which is worse than no
  // sponsor line at all, and is indistinguishable from a bug. The reverse IS allowed: a name
  // with no logo is a perfectly good magazine sponsor line, and the page drops the tile.
  if (isStr(doc.sponsorLogoUrl) && !isStr(doc.sponsorName)) {
    errors.push('sponsorLogoUrl requires sponsorName — a logo with no name is not a credit');
  }

  // DERIVED, NEVER TYPED. Written by uploadInstalmentEpub() from the bytes it is uploading;
  // null means "no EPUB has been counted yet", which the page renders by dropping the reading
  // time rather than by printing a zero. 0 is rejected for that reason — an instalment with no
  // words is not a state we can describe, and it would print "0 min" under a real title.
  if (doc.wordCount !== null && doc.wordCount !== undefined
      && (!isInt(doc.wordCount) || doc.wordCount <= 0)) {
    errors.push('wordCount must be a positive integer or null (it is derived from the EPUB, never entered)');
  }

  if (!isInt(doc.updatedAt) || doc.updatedAt <= 0) errors.push('updatedAt must be a positive integer (millisecond timestamp)');

  return { valid: errors.length === 0, errors };
}
