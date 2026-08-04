// R9.2 (c) — THE WORKFLOWS' ACTION MAJORS, HELD ABOVE THE DEPRECATED NODE RUNTIME.
//
//   node --test tests/ci/*.test.mjs      (npm run test:ci)
//
// GitHub deprecated the `node20` action runtime. Every `uses:` in this repo sat on @v4, which
// runs on it, and a deprecated runtime does not fail — it warns, until the day it stops
// working, which is a day nobody picks.
//
// WHY A FLOOR TABLE AND NOT "USE THE LATEST". Pinning to latest is how a workflow acquires a
// breaking change nobody asked for; checkout, setup-node and upload-artifact are all several
// majors ahead of what this repo needs and each has shipped real breaking changes on the way.
// The floor is the OLDEST major that runs on node24 — the minimum that clears the deprecation
// and nothing more. Going above it is fine and this suite will not object; going below it is
// the regression.
//
// THE NUMBER IS NOT THE SAME FOR EVERY ACTION, which is the trap. upload-artifact@v5's release
// notes announce node24 support, and the action still declares `runs.using: node20` — the
// default did not move until v6. So the floors below were read from each action's action.yml,
// not from its changelog. Do the same before raising any of them.
//
// Offline: parses the two workflow files as text. No network, no YAML dependency — the
// `uses:` line is regular enough to read exactly, and adding a parser to assert one field
// would be a dependency for nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOW_DIR = join(ROOT, '.github/workflows');

// action → { floor, runtime at that floor }. The runtime string is documentation that has to
// stay true: it is the whole reason the floor is the number it is.
const FLOORS = new Map([
  ['actions/checkout', { floor: 5, runtime: 'node24' }],
  ['actions/setup-node', { floor: 5, runtime: 'node24' }],
  ['actions/setup-java', { floor: 5, runtime: 'node24' }],
  // v5 declares node20 despite its release notes. v6 is the first that actually moves.
  ['actions/upload-artifact', { floor: 6, runtime: 'node24' }],
]);

function workflows() {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: `.github/workflows/${f}`, src: readFileSync(join(WORKFLOW_DIR, f), 'utf8') }));
}

/** Every `uses: owner/name@vN` in the workflows, with the file and major it was found at. */
function allUses() {
  const out = [];
  for (const { file, src } of workflows()) {
    for (const m of src.matchAll(/^\s*(?:-\s*)?uses:\s*([\w-]+\/[\w-]+)@v(\d+)/gm)) {
      out.push({ file, action: m[1], major: Number(m[2]) });
    }
  }
  return out;
}

describe('(c) · GitHub Actions runtimes', () => {
  test('the workflows are found and do use actions', () => {
    // Guards the extractor itself. A regex that silently matches nothing would make every
    // assertion below vacuously true — which is the way this kind of test usually rots.
    const uses = allUses();
    assert.ok(workflows().length >= 2, 'expected at least the reader and rules workflows');
    assert.ok(uses.length >= 8, `the uses: extractor found only ${uses.length} entries — it has stopped working`);
  });

  test('THE FINDING: no action is pinned below its node24 floor', () => {
    const stale = allUses()
      .filter(({ action, major }) => FLOORS.has(action) && major < FLOORS.get(action).floor)
      .map(({ file, action, major }) => {
        const { floor, runtime } = FLOORS.get(action);
        return `${file}: ${action}@v${major} → needs @v${floor} (${runtime})`;
      });

    assert.deepEqual(stale, [], `actions still on the deprecated runtime:\n  ${stale.join('\n  ')}`);
  });

  test('every action used is one this table knows about', () => {
    // The other half of the ratchet. A new action added at @v4 would otherwise sail past the
    // check above simply by not being listed — the exact way the four in FLOORS got old.
    const unknown = [...new Set(
      allUses().filter(({ action }) => !FLOORS.has(action)).map(({ action }) => action),
    )];

    assert.deepEqual(
      unknown, [],
      `these actions have no floor recorded: ${unknown.join(', ')}. Read runs.using out of ` +
      `each one's action.yml and add it to FLOORS, rather than deleting this test.`,
    );
  });

  test('no action is pinned by a floating tag or a bare name', () => {
    // `uses: actions/checkout` or `@main` would pass the major check by having no major at
    // all, and would silently follow whatever upstream ships next.
    const floating = [];
    for (const { file, src } of workflows()) {
      for (const m of src.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
        if (!/@v\d+/.test(m[1])) floating.push(`${file}: ${m[1]}`);
      }
    }
    assert.deepEqual(floating, [], `unpinned action references: ${floating.join(', ')}`);
  });

  test('the asymmetry is written down where someone will change it', () => {
    // upload-artifact@v6 next to checkout@v5 looks like a mistake unless the reason is beside
    // it. If the note goes, the next person "tidies" them to the same number.
    const reader = readFileSync(join(WORKFLOW_DIR, 'reader-tests.yml'), 'utf8');
    assert.match(reader, /node20/, 'reader-tests.yml must record why these majors differ');
    assert.match(reader, /upload-artifact@v5\s+runs:\s+node20/,
      'the note must state the specific fact that forces upload-artifact one major higher');
  });
});
