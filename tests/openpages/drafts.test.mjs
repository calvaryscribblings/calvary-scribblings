// R37 — the drafts contract.
//
// The conflict resolution is the part that matters and the part no UI test would
// catch, so it is a pure function and this file drives it through every divergence
// shape. The rule it is protecting is Ikenna's: NEVER resolve a conflict silently in
// a way that loses words.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFTS_NODE, MAX_DRAFTS, SLOT_RE, slotName, isSlot,
  DRAFT_BODY_MAX, DRAFT_TITLE_MAX,
  LOCAL_DEBOUNCE_MS, REMOTE_DEBOUNCE_MS, REMOTE_MAX_WAIT_MS,
  buildDraft, draftIsEmpty, draftLabel, draftWords, sameContent,
  firstFreeSlot, reconcile, forkNotice, capNotice, localKey,
} from '../../app/lib/openPagesDrafts.js';

const NOW = 1_800_000_000_000;
const d = (over = {}) => ({ title: 'T', body: 'B', genre: 'General', coverImage: null, createdAt: NOW, updatedAt: NOW, rev: 1, deviceId: 'dev1', ...over });

// ═══════════════════════════════════════════════════════════════════════════════
describe('R37 · the conflict — nothing a writer can still see is ever discarded', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('only one side has it — no conflict either way', () => {
    assert.equal(reconcile(d(), null, null).action, 'push');
    assert.equal(reconcile(null, d(), null).action, 'pull');
    assert.equal(reconcile(null, null, null).action, 'none');
  });

  test('one side moved, the other did not — fast-forward, no fork', () => {
    const base = d({ rev: 3 });
    const pulled = reconcile(base, d({ rev: 4, body: 'newer from the phone' }), 3);
    assert.equal(pulled.action, 'pull');
    assert.equal(pulled.fork, null, 'a fast-forward must not litter the list with forks');

    const pushed = reconcile(d({ rev: 4, body: 'newer from the laptop' }), base, 3);
    assert.equal(pushed.action, 'push');
    assert.equal(pushed.fork, null);
  });

  test('⭐ BOTH SIDES MOVED — THE LOSER IS KEPT, NOT OVERWRITTEN', () => {
    // The scenario Ikenna named: two devices, both with a copy, both edited. Plain
    // last-write-wins destroys the older one. Here it becomes its own draft.
    const laptop = d({ rev: 5, updatedAt: NOW + 2000, body: 'the laptop paragraph' });
    const phone  = d({ rev: 4, updatedAt: NOW + 1000, body: 'the phone paragraph' });
    const r = reconcile(laptop, phone, 3);

    assert.equal(r.action, 'fork');
    assert.equal(r.live.body, 'the laptop paragraph', 'the newer copy is the one that opens');
    assert.ok(r.fork, 'THE OLDER COPY MUST SURVIVE');
    assert.equal(r.fork.body, 'the phone paragraph');
    assert.notEqual(r.live.body, r.fork.body, 'two distinct pieces of writing, both kept');
  });

  test('⭐ THE SAME WORDS ON BOTH SIDES IS NOT A CONFLICT', () => {
    // Forking here would hand the writer two identical rows and teach them to ignore
    // the warning — which is how a real conflict later gets dismissed unread.
    const r = reconcile(d({ rev: 5 }), d({ rev: 9 }), 3);
    assert.equal(r.action, 'converged');
    assert.equal(r.fork, null);
    assert.equal(r.live.rev, 9, 'the higher revision is adopted so the counter keeps moving');
  });

  test('a skewed clock can only choose which copy OPENS, never which survives', () => {
    // The phone's clock is an hour fast; its copy is genuinely older.
    const laptop = d({ rev: 9, updatedAt: NOW, body: 'the real latest' });
    const phone  = d({ rev: 4, updatedAt: NOW + 3600e3, body: 'stale but time-stamped ahead' });
    const r = reconcile(laptop, phone, 3);
    assert.equal(r.action, 'fork');
    assert.equal(r.live.body, 'stale but time-stamped ahead', 'the clock decided, and it was wrong');
    assert.equal(r.fork.body, 'the real latest', 'AND THE RIGHT ONE IS STILL THERE — that is the point');
  });

  test('a lost sync marker is treated as a conflict, because keeping both is the safe way to be wrong', () => {
    const r = reconcile(d({ body: 'one' }), d({ body: 'two' }), null);
    assert.equal(r.action, 'fork');
    assert.ok(r.fork, 'unknown history must never authorise a delete');
  });

  test('the writer is told, in words, and the notice names the other copy', () => {
    const msg = forkNotice('Enough (from your phone)');
    assert.match(msg, /also edited on another device/i);
    assert.match(msg, /Both versions are kept/i);
    assert.match(msg, /Enough \(from your phone\)/);
  });

  test('every reconcile outcome carries a reason, so a support question is answerable', () => {
    for (const args of [[d(), null, null], [null, d(), null], [d({ rev: 5 }), d({ rev: 4, body: 'x' }), 3], [d(), d(), 1]]) {
      const r = reconcile(...args);
      assert.ok(r.reason && r.reason.length > 10, `${r.action} must explain itself`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R37 · the cap — refuse, never evict', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('slots are exactly d0..d19 and nothing else', () => {
    for (let i = 0; i < MAX_DRAFTS; i++) assert.ok(isSlot(slotName(i)), `${slotName(i)} must be a slot`);
    for (const bad of ['d20', 'd99', 'd', 'd1x', 'draft1', '-OabcPushId', '', 'D0', 'd 1', 'd-1']) {
      assert.equal(isSlot(bad), false, `${JSON.stringify(bad)} must not be a slot`);
    }
    assert.ok(SLOT_RE.test('d0') && SLOT_RE.test('d19') && !SLOT_RE.test('d20'));
  });

  test('the lowest free slot is reused, so deleting one makes room', () => {
    assert.equal(firstFreeSlot({}), 'd0');
    assert.equal(firstFreeSlot({ d0: {}, d1: {} }), 'd2');
    assert.equal(firstFreeSlot({ d0: {}, d2: {} }), 'd1', 'a gap is filled before growing');
  });

  test('⭐ AT THE CAP THE ANSWER IS null — the caller must refuse, and cannot evict', () => {
    const full = Object.fromEntries(Array.from({ length: MAX_DRAFTS }, (_, i) => [slotName(i), {}]));
    assert.equal(firstFreeSlot(full), null, 'there is no slot to take, so no draft can be displaced');
    const msg = capNotice();
    assert.match(msg, /limit/i);
    assert.match(msg, /nothing has been thrown away/i, 'the writer must be told nothing was lost');
  });

  test('the draft body cap is the PUBLISH cap — a draft you cannot publish is a trap', () => {
    assert.equal(DRAFT_BODY_MAX, 50000);
    assert.equal(DRAFT_TITLE_MAX, 200);
  });

  test('buildDraft clamps rather than exploding, and drops empty optional fields', () => {
    const big = buildDraft({ title: 'x'.repeat(500), body: 'y'.repeat(60000) }, { now: NOW, deviceId: 'dev' });
    assert.equal(big.title.length, DRAFT_TITLE_MAX);
    assert.equal(big.body.length, DRAFT_BODY_MAX);
    assert.equal('genre' in big, false, 'RTDB drops nulls; do not write them');
    assert.equal('coverImage' in big, false);
    assert.equal('forkedFrom' in big, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R37 · the list row', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('the row is titled by the title, or by the first real line of the body', () => {
    assert.equal(draftLabel({ title: 'Enough', body: 'x' }), 'Enough');
    assert.equal(draftLabel({ title: '   ', body: '\n\n# The Outliers\nrest' }), 'The Outliers',
      'markdown furniture is stripped — a reader recognises the words, not the hashes');
    assert.equal(draftLabel({ title: '', body: '\n\n> **a quoted opening**\n' }), 'a quoted opening');
    assert.equal(draftLabel({ title: '', body: '' }), 'Untitled');
    assert.equal(draftLabel({}), 'Untitled');
    assert.equal(draftLabel({ title: 'z'.repeat(200) }).length, 60, 'long titles are cut for the row');
  });

  test('length is in WORDS — writers think in words, characters are a database unit', () => {
    assert.equal(draftWords({ body: 'one two three' }), 3);
    assert.equal(draftWords({ body: '  \n spaced   out \n\n words ' }), 3);
    assert.equal(draftWords({ body: '' }), 0);
    assert.equal(draftWords({}), 0);
  });

  test('an empty draft is nothing to keep', () => {
    assert.equal(draftIsEmpty({ title: '', body: '' }), true);
    assert.equal(draftIsEmpty({ title: '   ', body: '\n\n' }), true);
    assert.equal(draftIsEmpty(null), true);
    assert.equal(draftIsEmpty({ title: '', body: 'a' }), false);
    assert.equal(draftIsEmpty({ title: 'a', body: '' }), false);
  });

  test('sameContent compares the words, not the bookkeeping', () => {
    assert.equal(sameContent(d({ rev: 1, updatedAt: 1, deviceId: 'a' }), d({ rev: 99, updatedAt: 99, deviceId: 'b' })), true);
    assert.equal(sameContent(d({ body: 'one' }), d({ body: 'two' })), false);
    assert.equal(sameContent(d({ coverImage: 'https://a' }), d({ coverImage: 'https://b' })), false);
    assert.equal(sameContent(null, d()), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R37 · cadence and placement', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('local is near-continuous and remote is lazy — they are not the same number', () => {
    assert.ok(LOCAL_DEBOUNCE_MS <= 1000, 'the device copy must feel instant');
    assert.ok(REMOTE_DEBOUNCE_MS >= 5000, 'the network copy must not fire on every pause');
    assert.ok(REMOTE_DEBOUNCE_MS > LOCAL_DEBOUNCE_MS * 4, 'if these converge the design has been lost');
    assert.ok(REMOTE_MAX_WAIT_MS > REMOTE_DEBOUNCE_MS, 'a continuous typist must still sync');
    assert.ok(REMOTE_MAX_WAIT_MS <= 120000, 'and must not be able to lose more than a couple of minutes');
  });

  test('⭐ DRAFTS ARE NOT UNDER users/, WHICH IS WORLD-READABLE', () => {
    assert.equal(DRAFTS_NODE, 'open_pages_drafts');
    assert.ok(!DRAFTS_NODE.startsWith('users'),
      'users/$uid carries .read:true and RTDB read rules cascade — a child cannot take it back');
  });

  test('the device key is namespaced by uid, so two accounts on one browser do not mix', () => {
    assert.notEqual(localKey('a'), localKey('b'));
    assert.match(localKey('abc'), /abc/);
  });
});
