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
  [
    'top_stories',
    'R9.0: deliberately NOT closed. .write is true (unauthenticated) and ' +
    'top_stories/weekly is regenerated on a schedule by something that is not in ' +
    'this repo, so locking it blind risks silently killing a live daily job. ' +
    'Needs the writer identified before it can be closed. REMOVE THIS ENTRY once ' +
    'it is.',
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // NOT BLESSED — these four are OPEN FINDINGS this ratchet surfaced the first
  // time it ran, all the same shape as R9.0 LB-5 (a write grant sitting at the
  // root of a subtree, so any signed-in account can wipe it in one request).
  // They were outside the scope of the R9.0 round-2 fix and are recorded here so
  // the suite passes on a known baseline RATHER THAN on a clean bill of health.
  // Each one is real work still to do. Delete the entry as you fix it.
  // ───────────────────────────────────────────────────────────────────────────
  [
    'cms_stories/$slug/reads',
    'OPEN FINDING (R9.0 PL-1, not yet fixed). Any signed-in account can write or ' +
    'wipe the per-story reads subtree. Needs the same treatment as storyReads: ' +
    'grant at the $uid leaf, owner-scoped, validated.',
  ],
  [
    'user_square_posts/$uid',
    'OPEN FINDING (R9.0 PL-1, not yet fixed). The grant is above $uid\'s contents, ' +
    'so any signed-in account can write into — or wipe — ANOTHER user\'s post ' +
    'index. Needs auth.uid === $uid and a grant at the leaf.',
  ],
  [
    'storyReactions/$slug/$type',
    'OPEN FINDING (R9.0 PL-1, not yet fixed). Grant sits above the per-uid ' +
    'children, so one request wipes every reaction on a story. Mirror ' +
    'storyReactionUsers, which already scopes to $uid correctly.',
  ],
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
