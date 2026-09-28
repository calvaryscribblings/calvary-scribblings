// W23 — THE HOUSE DICTIONARY, as published. No network: this reads public/dict/en/<DICT_VERSION>/
// as committed and checks what Cloudflare Pages and the Reading Room depend on.
//
//   node --test tests/ci/w23-dictionary.test.mjs          (npm run test:ci)
//
// A byte-for-byte rebuild needs the pinned source zip; that is `npm run dict:check`, not CI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICT_VERSION, DICT_BASE, shardFor, shardFileName } from '../../app/lib/dictionary.js';
import { SHARD_MAX_GZ } from '../../scripts/dictionary/build.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIR = join(ROOT, 'public', DICT_BASE);
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const files = readdirSync(DIR);

test('the folder is the version the bundle reads', () => {
  assert.equal(manifest.version, DICT_VERSION);
  assert.equal(DICT_BASE, `/dict/en/${DICT_VERSION}`);
});

test('exactly the manifest\'s shards, plus the manifest and the licence', () => {
  const want = new Set([...manifest.prefixes.map(shardFileName), 'manifest.json', 'LICENSE']);
  assert.deepEqual(new Set(files), want);
  assert.equal(manifest.shards, manifest.prefixes.length);
});

test('far inside Pages\' limits: 20,000 files, 25 MiB a file — and every shard under the ceiling', () => {
  const all = readdirSync(join(ROOT, 'public'), { recursive: true });
  assert.ok(all.length < 15000, `public/ holds ${all.length} entries`);
  for (const f of files) {
    const buf = readFileSync(join(DIR, f));
    assert.ok(statSync(join(DIR, f)).size < 1024 * 1024, `${f} is over 1 MiB`);
    if (f.startsWith('p_')) assert.ok(gzipSync(buf, { level: 9 }).length <= SHARD_MAX_GZ, `${f} is over the gzip ceiling`);
  }
});

test('every headword lives in the shard the reader will ask for, in the published shape', () => {
  let n = 0;
  for (const p of manifest.prefixes) {
    const shard = JSON.parse(readFileSync(join(DIR, shardFileName(p)), 'utf8'));
    for (const [w, e] of Object.entries(shard)) {
      n++;
      assert.equal(shardFor(w, manifest.prefixes), p, `"${w}" is in ${p} but resolves elsewhere`);
      assert.equal(w, w.toLowerCase());
      assert.ok(!/\s/.test(w), `"${w}" is not one word`);
      assert.ok(e.s || e.x, `"${w}" is empty`);
      for (const [pos, def] of e.s || []) {
        assert.ok(['n', 'v', 'a', 'r'].includes(pos));
        assert.ok(typeof def === 'string' && def.length > 0);
      }
      const per = {};
      for (const [pos] of e.s || []) per[pos] = (per[pos] || 0) + 1;
      assert.ok(Object.values(per).every((c) => c <= 3), `"${w}" carries more than three senses in a part of speech`);
    }
  }
  assert.equal(n, manifest.headwords);
});

test('the licence travels with the data', () => {
  const l = readFileSync(join(DIR, 'LICENSE'), 'utf8');
  assert.match(l, /Creative Commons Attribution 4\.0/);
  assert.match(l, /Princeton University/);
});

test('the lookup names no host outside the site', () => {
  const src = readFileSync(join(ROOT, 'app', 'lib', 'dictionary.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /https?:\/\//, 'app/lib/dictionary.js must fetch only its own site');
});

test('public/_headers freezes /dict/en/* for a year', () => {
  const h = readFileSync(join(ROOT, 'public', '_headers'), 'utf8');
  assert.match(h, /^\/dict\/en\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m);
});
