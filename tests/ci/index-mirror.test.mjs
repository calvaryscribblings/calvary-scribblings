// The newsletter Worker's hand-copied publishedAtMs derivation vs. the real one.
//
//   node --test tests/ci/index-mirror.test.mjs      (npm run test:ci)
//
// ── WHY THIS TEST EXISTS ─────────────────────────────────────────────────────────
// workers-external/calvary-newsletter.worker.js is a mirror of a Worker whose live
// source is edited in the Cloudflare dashboard. It CANNOT import app/lib/*, so its
// copy of the index projection is a hand-copy — and app/lib/storyIndex.js's contract
// header already spends a numbered rule on what happens when the two drift.
//
// Every other mirrored field is a string copy that drifts visibly (a card renders
// the wrong title). publishedAtMs is different in kind: the story-serving endpoint
// resolves the most-recent-5 free floor with an ordered query on it, so a drifted
// or missing value decides whether a reader can READ a story, silently, on a
// surface neither repo renders. See STORY-SERVING-CONTRACT.md §3.2 and §8.
//
// So the two implementations are run against the same dates and compared. The
// Worker's function is lifted out of its source by brace-matching rather than
// imported, because the Worker exports nothing — the same source-extraction trick
// tests/dropcap/dropcap.spec.mjs uses to run the real dropcap module in a browser.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedAtMsFor } from '../../app/lib/storyAccess.js';
import { buildIndexRecord } from '../../app/lib/storyIndex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_SRC = readFileSync(resolve(ROOT, 'workers-external/calvary-newsletter.worker.js'), 'utf8');

/** Lift a top-level `function name(...) { ... }` out of source by brace matching. */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in the Worker mirror — was it renamed or dropped?`);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`${name}: unbalanced braces while extracting`);
  return src.slice(start, i + 1) + `\nreturn ${name};`;
}

const publishedAtMsMirror = new Function(extractFunction(WORKER_SRC, 'publishedAtMsMirror'))();

// The shapes that actually occur, plus the ones that decide the edge cases. The
// first two columns are the live corpus's only two date formats as measured on
// 2026-08-08 (159 × "Mon D, YYYY", 16 × "Mon YYYY").
const CASES = [
  { date: 'Jul 4, 2026' },
  { date: 'Jan 15, 2026' },
  { date: 'Aug 8, 2026' },
  { date: 'Dec 31, 2026' },
  { date: 'Jan 2026' },                       // dayless → the 1st
  { date: 'Feb 2026' },
  { date: 'Mar 2026' },
  { date: 'March 2026' },                     // full month name
  { date: 'September 9, 2026' },
  { date: 'Jul 4 2026' },                     // comma dropped
  { date: '2026-07-04' },                     // ISO, if the field is ever upgraded
  { date: '' },                               // → null
  { date: 'not a date at all' },              // → null
  { date: 'Foo 3, 2026' },                    // unknown month → null
  { date: 'Jul 99, 2026' },                   // impossible day → null
  { date: 'Jul 4, 2026', publishAt: '2026-07-04T08:00:00.000Z' },   // publishAt wins
  { date: 'Jan 2026', publishAt: '2026-06-17T08:00:00.000Z' },      // …even over a dayless date
  { date: 'Jul 4, 2026', publishAt: 'nonsense' },                   // bad publishAt falls through
  { date: 'Jul 4, 2026', publishAt: '' },
];

describe('the Worker mirror derives publishedAtMs identically', () => {
  for (const story of CASES) {
    const label = `${JSON.stringify(story.date)}${story.publishAt !== undefined ? ` + publishAt ${JSON.stringify(story.publishAt)}` : ''}`;
    test(label, () => {
      assert.equal(
        publishedAtMsMirror(story),
        publishedAtMsFor(story),
        'the Worker mirror has drifted from app/lib/storyAccess.js:publishedAtMsFor',
      );
    });
  }

  test('both return epoch milliseconds as a number, never a string', () => {
    const v = publishedAtMsMirror({ date: 'Jul 4, 2026' });
    assert.equal(typeof v, 'number');
    assert.equal(v, Date.UTC(2026, 6, 4));
  });

  test('a dayless date takes the 1st — the earliest day it can mean', () => {
    assert.equal(publishedAtMsMirror({ date: 'Jan 2026' }), Date.UTC(2026, 0, 1));
  });

  test('the mirror is wired into the projection, not merely defined', () => {
    assert.match(
      WORKER_SRC,
      /publishedAtMs:\s*publishedAtMsMirror\(s\)/,
      'buildIndexRecordMirror must project publishedAtMs, or scheduled publishes write records the free-floor query cannot see',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R48 — THE WHOLE KEY SET, because a guard scoped to ONE FIELD could not fail on the next one.
//
// ⚠ THIS SECTION EXISTS BECAUSE THE SECTION ABOVE DID ITS JOB PERFECTLY AND STILL MISSED A
// LIVE DEFECT. Everything above tests publishedAtMs — chosen, correctly, as the field whose
// drift is invisible and decides whether a reader can READ a story. Then R46 added `opening`
// to app/lib/storyIndex.js:buildIndexRecord and did not add it to the mirror. Nothing failed.
// On 10 Sep 2026 the scheduled-publish cron published `things-i-m-owed` and wrote an index
// record with no opening line; `npm run test:search` caught it two days later, by accident,
// as "171 !== 172", on a suite about search results.
//
// The lesson is not "also test opening". It is that the CONTRACT is the whole projection, so
// the test has to be about the whole projection: the mirror must emit THE SAME KEYS as
// buildIndexRecord, and adding a field to one without the other must fail on the commit that
// does it rather than on a shelf count a fortnight later.
describe('the mirror projects THE SAME FIELDS as buildIndexRecord', () => {
  // ⚠ KNOWN, DELIBERATE, OWNED GAPS. A key listed here is one the Worker genuinely cannot
  // carry, with the reason and the owner written down. THE LIST IS CHECKED IN BOTH
  // DIRECTIONS: an unlisted missing key fails, AND a listed key that has since been
  // implemented fails too — so closing a gap forces the entry out of this list rather than
  // leaving a stale exemption that quietly widens.
  const KNOWN_GAPS = {
    opening:
      'indexOpening() runs parseBlocks() + walkToProse() — ~200 lines of shared HTML predicate '
      + 'across two modules. Hand-copying that into a Worker edited in the Cloudflare dashboard '
      + 'is a worse risk than the gap: the opening line and the drop cap MUST pick the same '
      + 'paragraph, and two hand-copies of one predicate is how they stop agreeing. '
      + 'OWNER: Ikenna. A scheduled publish therefore lands without an opening line until a '
      + 're-projection fills it in — repair with scripts/repair-index-record.mjs <slug> --apply, '
      + 'and see the R48 hand-off note for the reconciler option.',
  };

  const mirrorKeys = () => {
    // The literal keys of the object buildIndexRecordMirror builds, read out of the source —
    // the Worker exports nothing, so this is the same extraction trick used above.
    const fn = extractFunction(WORKER_SRC, 'buildIndexRecordMirror');
    const body = fn.slice(fn.indexOf('const rec = {'), fn.indexOf('return rec;'));
    const keys = new Set([...body.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9_]*):/gm)].map((m) => m[1]));
    // The conditional tail — rec.publishAt / rec.coverSizes / rec.quiz — is assigned after the
    // literal, so it is picked up separately or the comparison reports three false gaps.
    for (const m of fn.matchAll(/rec\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)) keys.add(m[1]);
    return keys;
  };

  test('every field the real projection emits is in the mirror, or is a listed gap', () => {
    // A record with everything populated, so no key is skipped for being empty.
    const real = buildIndexRecord('slug', {
      title: 'T', author: 'A', authorUid: 'u', authorHandle: 'h', category: 'short',
      categoryName: 'Short Story', subcategory: 'Drama', cover: 'c', coverHash: 'x',
      trailerQuote: 'q', content: '<p>Some prose that is long enough to be an opening.</p>',
      date: 'Jul 4, 2026', published: true, publishAt: '2026-07-04T00:00:00.000Z',
      coverSizes: { w360: 'a', w720: 'b' }, quizMeta: { hasQuiz: true, scribblesReward: 50 },
    });
    const realKeys = Object.keys(real);
    assert.ok(realKeys.length > 15, 'the sample record did not populate the projection');
    assert.ok(realKeys.includes('opening'), 'the sample produced no opening — the check is vacuous');

    const mirror = mirrorKeys();
    assert.ok(mirror.size > 15, 'buildIndexRecordMirror key extraction found almost nothing — it has been reshaped');

    const missing = realKeys.filter((k) => !mirror.has(k));
    const unexplained = missing.filter((k) => !(k in KNOWN_GAPS));
    assert.deepEqual(unexplained, [],
      `buildIndexRecordMirror is missing ${unexplained.join(', ')}. A scheduled publish will write `
      + 'records without them. Add the field to workers-external/calvary-newsletter.worker.js AND '
      + 'to the live Worker in the Cloudflare dashboard, or add it to KNOWN_GAPS with a reason and '
      + 'an owner.');

    // ⭑ THE OTHER DIRECTION: a gap that has been closed must leave the list, or the exemption
    // outlives the problem and the next real gap hides behind it.
    const stale = Object.keys(KNOWN_GAPS).filter((k) => mirror.has(k));
    assert.deepEqual(stale, [],
      `${stale.join(', ')} is listed as a known gap but the mirror now projects it — delete the entry.`);
  });

  test('the mirror adds no field the real projection does not have', () => {
    const real = new Set(Object.keys(buildIndexRecord('slug', {
      title: 'T', published: true, date: 'Jul 4, 2026', content: '<p>Prose.</p>',
      publishAt: '2026-07-04T00:00:00.000Z', coverSizes: { w360: 'a' },
      quizMeta: { hasQuiz: true },
    })));
    const extra = [...mirrorKeys()].filter((k) => !real.has(k));
    assert.deepEqual(extra, [],
      `the mirror writes ${extra.join(', ')}, which buildIndexRecord does not — the index would `
      + 'carry a field only scheduled publishes have.');
  });
});
