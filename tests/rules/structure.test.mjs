// THE RATCHET.
//
// The behavioural suites next door prove that the nodes we know about behave.
// This one exists for the node NOBODY HAS WRITTEN A TEST FOR YET — the one a
// future workstream appends to database.rules.json in a hurry, with
// `".write": "auth != null"` at its root, exactly as five of the six LB-5 nodes
// were written. It needs no emulator and no network: it reads the rules file and
// asserts a structural property.
//
// THE PROPERTY: no write grant may be unconditional. A grant is "unconditional"
// when its expression constrains nothing beyond "someone is signed in" — it
// names no path variable, no auth.uid comparison, and no existing/incoming data.
// Such a grant lets any account (sign-up is open) write anything at that path,
// and — because .validate NEVER runs on a null write — delete the entire subtree
// underneath it in one request.
//
// Every genuine exception is listed in DELIBERATELY_OPEN below WITH ITS REASON.
// That list is the point as much as the check is: it turns "which of our nodes
// are deliberately world-writable?" from an archaeology exercise into a diff.
//
// To add an exception you must edit this file, which means someone reviews it.
// That is the ratchet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DB_RULES_PATH } from './helpers.mjs';

const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8')).rules;

// ─────────────────────────────────────────────────────────────────────────────
// Deliberately open write grants. Each entry is a path in the rules tree and the
// reason it is allowed to stay open. Anything open and NOT on this list fails.
// ─────────────────────────────────────────────────────────────────────────────
const DELIBERATELY_OPEN = new Map([
  [
    'comments/$slug/$commentId/heartCount',
    'Any reader may heart any comment. Bounded by .validate (number >= 0); the ' +
    'counter is not owned by anyone. R9.0 LB-13.',
  ],
  [
    'comments/$slug/$commentId/fireCount',
    'As heartCount above: any reader may react to any comment, and the counter ' +
    'belongs to nobody. Bounded by .validate (number >= 0). R9.0 LB-13.',
  ],
  [
    'comments/$slug/$commentId/replies',
    'Open-Pages threads nest replies to arbitrary depth through this same node ' +
    '(app/open-pages/[id]/page-client.js:455), so a depth-shaped ownership rule ' +
    'would break them. Tightened instead at the leaf: replies/$replyId/authorUid ' +
    'must equal auth.uid, so a reply cannot be forged. R9.0 LB-13.',
  ],
  [
    'square_posts/$postId/likeCount',
    'toggleReaction runs a transaction on ANOTHER user\'s post ' +
    '(app/square/page.js:1015), so an author-only rule would break every like. ' +
    'Bounded by .validate (number >= 0). R9.0 LB-5.',
  ],
  [
    'square_posts/$postId/fireCount',
    'As likeCount above: written by the reacting user, not the post author. ' +
    'Bounded by .validate (number >= 0). R9.0 LB-5.',
  ],
  [
    'square_posts/$postId/clapCount',
    'As likeCount above: written by the reacting user, not the post author. ' +
    'Bounded by .validate (number >= 0). R9.0 LB-5.',
  ],
  // R9.8 — the top_stories entry that stood here is GONE, which is what its own note asked
  // for: "Needs the writer identified before it can be closed. REMOVE THIS ENTRY once it is."
  //
  // The writer is calvary-hit-counter, now mirrored at
  // workers-external/calvary-hit-counter.worker.js. It was writing unauthenticated — it sent
  // the Firebase WEB API KEY as ?auth=, which RTDB ignores — so it survived only while the
  // node was world-writable. R9.6 gave it env.FIREBASE_SECRET, and the node is closed.
  //
  // The close was gated on OBSERVED evidence, not on the credential looking right: the
  // Worker's prune PATCH has to pass through the already-closed `stories` node, and day
  // buckets 2026-07-25/26 disappearing at the 21:00 run is what proved the secret was live
  // in that code path. A fresh generatedAt would have proved nothing, because top_stories
  // was open and the broken Worker had been writing it successfully throughout.

  // R9.9 — the last three PL-1 entries stood here. All three are CLOSED, and the notes
  // they carried were wrong about two of the three nodes in a way worth recording,
  // because the wrongness is what the house rule exists to catch.
  //
  // The notes were written from the RULES, not from the DATA. They described
  // `cms_stories/$slug/reads` and `storyReactions/$slug/$type` as grants sitting above a
  // per-$uid subtree, and prescribed "push the grant down to the $uid leaf". There is no
  // $uid subtree under either one. Measured live (2026-08-06):
  //
  //   cms_stories/$slug/reads   — a NUMBER. 3 of 173 slugs carry it (values 1, 2, 2).
  //                               Vestigial: read tracking moved to storyReads/$slug/$uid
  //                               and users/$uid/readCount long ago.
  //   storyReactions/$slug/$type — a NUMBER. 141 slugs, 407 counters, $type ∈
  //                               {fire, heart, quill} and nothing else. The per-uid half
  //                               is the SIBLING node storyReactionUsers/$slug/$uid,
  //                               which was already scoped correctly.
  //
  // Both grants were therefore ALREADY at the leaf. "Push it down" was a no-op; the whole
  // fix was the second half of the instruction — constrain type and shape *at* the leaf.
  // Both now carry `newData.isNumber() && newData.val() >= 0` IN THE .write EXPRESSION,
  // which is the part that matters: a `.validate` cannot close a wipe hole, because
  // .validate never runs on a null write. With the numeric term in the grant itself, a
  // null write fails the grant and the counter cannot be deleted at all.
  //
  // That lands both nodes in the same class as open_pages/$postId/readCount, described
  // below: type-constrained but not owner-constrained — forgeable, not wipeable. That is
  // a deliberate, lesser posture, and it is the honest one for a counter no account owns.
  //
  // user_square_posts/$uid WAS the shape its note described. The grant sat above $uid's
  // contents, so any signed-in account could write into or wipe another reader's post
  // index. It now mirrors square_posts/$postId exactly — owner-on-create (and the row must
  // be filed under its own authorUid), owner-or-founder-on-modify — because the two nodes
  // are written by the same code path and any divergence between them is a bug waiting.
]);

// NOT LISTED, and worth saying why: open_pages/$postId/readCount carries
// `.write: "auth != null && newData.isNumber()"`. That is still R9.0 PL-3 — any
// signed-in account can set any post's public read count — but it is NOT the
// class this file catches. The isNumber() term makes a null write fail, so the
// subtree cannot be WIPED, only forged. Type-constrained-but-not-owner-constrained
// is a real finding and a lesser one; it needs a behavioural test, not a
// structural one. Same for subscribers/$entry (`newData.exists()`), which is
// deliberately writable by signed-out readers and equally un-wipeable — see
// commit 456bf90.

// A write expression is "constrained" if it references any of these.
// Matched case-INSENSITIVELY, because `newData.` and `data.` differ only in case
// and missing that was the first bug this file caught — in itself.
const CONSTRAINT_SIGNALS = [
  '$',            // a path variable — almost always an ownership check
  'auth.uid ==',  // explicit owner / founder comparison
  'auth.uid ===',
  'data.',        // data. / newData. — shape or existence constrained
  'auth.token',
];

function isUnconditional(expr) {
  if (expr === true) return true;                 // literally anyone, signed out
  if (expr === false) return false;               // closed
  if (typeof expr !== 'string') return false;
  const e = expr.trim();
  if (e === 'true') return true;
  if (e === 'false') return false;
  const lower = e.toLowerCase();
  return !CONSTRAINT_SIGNALS.some((s) => lower.includes(s.toLowerCase()));
}

// Walk the whole rules tree, collecting every `.write` with its path.
function collectWrites(node, path = [], out = []) {
  if (node === null || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === '.write') out.push({ path: path.join('/'), expr: value });
    else if (!key.startsWith('.')) collectWrites(value, [...path, key], out);
  }
  return out;
}

const allWrites = collectWrites(rules);

test('every .write grant is either constrained or an explained exception', () => {
  const open = allWrites.filter((w) => isUnconditional(w.expr));
  const undeclared = open.filter((w) => !DELIBERATELY_OPEN.has(w.path));

  const detail = undeclared
    .map((w) => `\n  ${w.path || '<root>'}\n      .write: ${JSON.stringify(w.expr)}`)
    .join('');

  assert.equal(
    undeclared.length,
    0,
    `${undeclared.length} write grant(s) are unconditional and undeclared.${detail}\n\n` +
    'A grant that names no path variable, no auth.uid comparison and no data check\n' +
    'lets ANY signed-in account write there — and, because .validate never runs on\n' +
    'a null write, DELETE the entire subtree in one request.\n\n' +
    'Fix it by moving the grant down to the owner leaf, or — if it is genuinely\n' +
    'meant to be open — add it to DELIBERATELY_OPEN in this file WITH A REASON.\n',
  );
});

test('no node carries a .write at its own root without an ownership check', () => {
  // The specific shape that produced R9.0 LB-1, LB-3, LB-4, LB-5 and LB-11: a
  // top-level node whose grant sits above every key it contains.
  const topLevel = allWrites.filter((w) => w.path.split('/').filter(Boolean).length <= 1);
  const bad = topLevel.filter((w) => isUnconditional(w.expr) && !DELIBERATELY_OPEN.has(w.path));
  assert.deepEqual(
    bad.map((w) => w.path),
    [],
    'Top-level nodes with an unconditional root .write are one request away from ' +
    'being wiped wholesale.',
  );
});

test('the DELIBERATELY_OPEN list has no stale entries', () => {
  // If a node is fixed but its exception is left behind, the ratchet quietly
  // stops protecting it. Every declared exception must still be open.
  const openPaths = new Set(allWrites.filter((w) => isUnconditional(w.expr)).map((w) => w.path));
  const stale = [...DELIBERATELY_OPEN.keys()].filter((p) => !openPaths.has(p));
  assert.deepEqual(
    stale,
    [],
    'These paths are declared as deliberately open but are no longer open. ' +
    'Delete them from DELIBERATELY_OPEN so the ratchet holds the fix in place.',
  );
});

test('every deliberately-open exception carries a reason', () => {
  for (const [path, reason] of DELIBERATELY_OPEN) {
    assert.ok(
      typeof reason === 'string' && reason.length >= 40,
      `DELIBERATELY_OPEN entry "${path}" needs a real explanation, not a placeholder.`,
    );
  }
});

test('the two nodes that hold money or private mail are never world-readable', () => {
  // A cheap invariant over the shapes R9.0 found: these must never regain a
  // blanket public read.
  for (const node of ['wallet', 'payout_requests', 'dm_messages', 'notifications',
    'library_notifications', 'dm_conversations', 'bookstore_purchases']) {
    const r = rules[node]?.['.read'];
    assert.notEqual(r, true, `${node}/.read must never be true`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// R9.2 PL-4 · every declared index must be paid for by a real query.
//
// An .indexOn costs write throughput on every write to the node, forever. RTDB
// never complains about one nothing queries — the only feedback is the absence
// of the "Consider adding .indexOn" warning you were never going to see.
//
// bookstore_purchases/$uid declared ["purchaseDate", "titleId"] and BOTH were
// wrong, in two different ways that between them cover the whole failure mode:
// buildGrantPayload in functions/api/bookstore/_lib.js writes `purchasedAt`, not
// `purchaseDate` — so that index was on a field that has never existed — and
// `titleId` is the record KEY (bookstore_purchases/{uid}/{titleId}), not a child
// of the record, so it can never be an orderByChild target either. No
// orderByChild anywhere in the tree names this node. The whole declaration was
// removed rather than corrected: nothing sorts a shelf server-side today, and a
// speculative index is the same cost as a wrong one.
// ─────────────────────────────────────────────────────────────────────────────
test('bookstore_purchases declares no index — nothing queries it', () => {
  const node = rules.bookstore_purchases?.$uid;
  assert.ok(node, 'bookstore_purchases/$uid must still exist');
  assert.equal(
    node['.indexOn'], undefined,
    'Re-adding an index here means a query was added too. If so, name the field ' +
    'the code actually writes (purchasedAt, not purchaseDate) and point this test ' +
    'at the orderByChild that justifies it.',
  );
});

test('no index names a field the bookstore payload does not write', () => {
  // The generalisation of the bug above, held over the node that DOES index.
  // Reads the writer rather than restating its field names.
  const lib = readFileSync(
    new URL('../../functions/api/bookstore/_lib.js', import.meta.url), 'utf8',
  );
  assert.equal(
    /purchaseDate/.test(lib), false,
    'the grant payload writes purchasedAt. If purchaseDate has come back, the ' +
    'index that was removed in R9.2 may be worth restoring.',
  );
});
