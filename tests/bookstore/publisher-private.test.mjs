// R9.2 PL-11 — THE PRIVATE PUBLISHER NODE IS REACHED FROM ADMIN SURFACES AND NOWHERE ELSE.
//
//   node --test tests/bookstore/publisher-private.test.mjs      (npm run test:purchases)
//
// bookstore_publishers_private holds contactEmail and paymentDetails.method
// (app/lib/bookstore/schema.js) and is founder-read-only in database.rules.json, beside a
// world-readable bookstore_publishers twin. The R9.0 audit could not settle from the rules
// alone whether a public page read the private half, and set the remedy as "one grep at launch
// prep". This file IS that grep, run on every push instead of once.
//
// The answer at R9.2 was: nothing leaked. page-detail.js read the merged getPublisher() but
// used only `pub.name`, so the private fields were fetched-and-discarded for founders and
// permission-denied for everyone else. The fix was not a disclosure fix — it was removing a
// request that could only ever fail on a reader's book page, and closing the door on a later
// edit rendering one of those fields by accident.
//
// TWO ASSERTIONS, BECAUSE THERE ARE TWO WAYS BACK IN: naming the node directly, and calling
// the getter that merges it. Offline; reads the tree and nothing else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Where a founder session is a precondition of the page rendering at all. Everything else
// under app/ is a surface an anonymous reader can reach.
const ADMIN_PREFIXES = ['app/admin/'];

// Two modules under app/lib/ are admin machinery despite not living under app/admin/, and both
// necessarily name the private node: loader.js defines the getters, and admin-writes.js is the
// curator's write path. Neither is a surface. The last test below holds them to that by
// checking who imports admin-writes.js — an allowlist nobody re-checks is just a hole with a
// comment on it.
const ADMIN_MODULES = [
  'app/lib/bookstore/loader.js',
  'app/lib/bookstore/admin-writes.js',
];

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.jsx?$/.test(name)) continue;
      out.push(relative(ROOT, full));
    }
  })(join(ROOT, 'app'));
  return out;
}

const isAdmin = (rel) => ADMIN_PREFIXES.some((p) => rel.startsWith(p)) || ADMIN_MODULES.includes(rel);

// COMMENTS DO NOT COUNT. Both fixes in this round left a note behind naming what they moved
// away from, and a grep that cannot tell a reference from an explanation would fail on its own
// documentation — which teaches everyone to delete the explanation.
const code = (rel) => readFileSync(join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\/.*$/gm, '');

describe('PL-11 · the private publisher node', () => {
  test('no public surface names bookstore_publishers_private', () => {
    const offenders = sourceFiles().filter((rel) =>
      !isAdmin(rel) && code(rel).includes('bookstore_publishers_private'));

    assert.deepEqual(
      offenders, [],
      'these files reach a founder-only node from a surface an anonymous reader can open: ' +
      offenders.join(', '),
    );
  });

  test('no public surface calls the merged getPublisher()', () => {
    // getPublisherPublic() is the storefront's getter and must not trip this — hence the
    // negative lookahead rather than a bare substring.
    const merged = /\bgetPublisher\b(?!Public)/;
    const offenders = sourceFiles().filter((rel) => !isAdmin(rel) && merged.test(code(rel)));

    assert.deepEqual(
      offenders, [],
      'getPublisher() merges the founder-only record. A public page wants getPublisherPublic(): ' +
      offenders.join(', '),
    );
  });

  test('the storefront detail page does use the public getter', () => {
    // The mirror of the two negatives above. Without it, deleting the call altogether would
    // pass this suite while quietly dropping the publisher line from every book page.
    const src = readFileSync(join(ROOT, 'app/bookstore/[slug]/page-detail.js'), 'utf8');
    assert.match(src, /getPublisherPublic/, 'the detail page must still resolve a publisher name');
  });

  test('getPublisherPublic reads only the public path', () => {
    const src = readFileSync(join(ROOT, 'app/lib/bookstore/loader.js'), 'utf8');
    const start = src.indexOf('export async function getPublisherPublic');
    assert.notEqual(start, -1, 'loader.js must still export getPublisherPublic');
    const end = src.indexOf('\n}', start);
    const body = src.slice(start, end);

    assert.match(body, /PUBLISHERS_PATH/);
    assert.equal(
      /PUBLISHERS_PRIVATE_PATH/.test(body), false,
      'the public getter must not touch the private node — that is the whole of its job',
    );
  });

  test('the admin surfaces that DO need the merge still have it', () => {
    // Stated so the fix cannot be "over-applied" into breaking the publisher edit form, which
    // needs contactEmail and paymentDetails to populate its fields.
    const src = readFileSync(join(ROOT, 'app/admin/publishers/page.js'), 'utf8');
    assert.match(src, /\bgetPublisher\b(?!Public)/, 'the admin form still needs the merged record');
  });

  test('admin-writes.js is imported by admin pages only', () => {
    // The allowlist above earns its place here. admin-writes.js may name the private node
    // because nothing outside /admin loads it — if that stops being true, the exemption stops
    // being safe and this is where it shows.
    const importers = sourceFiles().filter((rel) =>
      !ADMIN_MODULES.includes(rel) && /from\s+['"][^'"]*bookstore\/admin-writes['"]/.test(code(rel)));
    const leaked = importers.filter((rel) => !rel.startsWith('app/admin/'));

    assert.deepEqual(
      leaked, [],
      `admin-writes.js is the curator's write path and reaches the founder-only node. ` +
      `Imported outside /admin by: ${leaked.join(', ')}`,
    );
  });
});
