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
