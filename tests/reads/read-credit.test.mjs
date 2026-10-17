// W49 §4 — app/lib/readCredit.js: an instalment read credits the reader exactly as a story read
// does (ruling 179), through the same function, with the firebase/database calls driven against an
// in-memory tree.
//
//   · the first read sets the marker and adds one to readCount; a second credits nothing;
//   · the tenth read pays 5 points, a history row and the library notification — for either kind;
//   · a story and an instalment write the same things, except the marker's node;
//   · instalments never touch readStories (other surfaces read it as story slugs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { creditFirstRead, READ_NODES } from '../../app/lib/readCredit.js';

function fakeDb(initial = {}) {
  const tree = structuredClone(initial);
  const at = (path, make = false) => {
    const segs = path.split('/');
    let cur = tree;
    for (const s of segs.slice(0, -1)) { if (!(s in cur)) { if (!make) return [null, null]; cur[s] = {}; } cur = cur[s]; }
    return [cur, segs.at(-1)];
  };
  const read = (path) => { const [p, k] = at(path); return p && k in p ? p[k] : null; };
  const write = (path, v) => { const [p, k] = at(path, true); p[k] = v; };
  let pushes = 0;
  const fb = {
    ref: (_db, path) => path,
    get: async (path) => ({ exists: () => read(path) !== null, val: () => read(path) }),
    set: async (path, v) => write(path, v),
    runTransaction: async (path, fn) => write(path, fn(read(path))),
    update: async (path, obj) => { for (const [k, v] of Object.entries(obj)) write(`${path}/${k}`, v); },
    push: async (path, v) => write(`${path}/p${(pushes += 1)}`, v),
  };
  return { tree, fb };
}

describe('W49 · creditFirstRead', () => {
  test('first read credits; the second credits nothing', async () => {
    const { tree, fb } = fakeDb({ users: { u: { readCount: 3 } } });
    assert.deepEqual(await creditFirstRead('u', null, { node: READ_NODES.instalment, key: 's-i1' }, fb), { credited: true, readCount: 4 });
    assert.deepEqual(await creditFirstRead('u', null, { node: READ_NODES.instalment, key: 's-i1' }, fb), { credited: false, readCount: null });
    assert.equal(tree.users.u.readCount, 4);
    assert.equal(tree.users.u.readInstalments['s-i1'], true);
    assert.equal(tree.users.u.readStories, undefined, 'an instalment is never written into readStories');
  });

  test('the tenth read pays the milestone, whichever kind it was', async () => {
    for (const node of [READ_NODES.story, READ_NODES.instalment]) {
      const { tree, fb } = fakeDb({ users: { u: { readCount: 9 } }, points: { u: { total: 20 } } });
      await creditFirstRead('u', null, { node, key: 'k' }, fb);
      assert.equal(tree.points.u.total, 25, node);
      assert.equal(Object.values(tree.points.u.history)[0].description, '10 stories read milestone');
      assert.equal(Object.values(tree.library_notifications.u)[0].type, 'reward');
    }
  });

  test('a story and an instalment write the same credit; only the marker’s node differs', async () => {
    const strip = (t, node) => { const c = structuredClone(t); delete c.users.u[node]; for (const h of Object.values(c.points?.u?.history || {})) delete h.createdAt; for (const n of Object.values(c.library_notifications?.u || {})) delete n.createdAt; return c; };
    const a = fakeDb({ users: { u: { readCount: 19 } } });
    const b = fakeDb({ users: { u: { readCount: 19 } } });
    await creditFirstRead('u', null, { node: READ_NODES.story, key: 'k' }, a.fb);
    await creditFirstRead('u', null, { node: READ_NODES.instalment, key: 'k' }, b.fb);
    assert.deepEqual(strip(a.tree, 'readStories'), strip(b.tree, 'readInstalments'));
    assert.equal(a.tree.users.u.readStories.k, true);
    assert.equal(b.tree.users.u.readInstalments.k, true);
  });

  test('the nodes are fixed: readStories for stories, readInstalments for instalments', () => {
    assert.deepEqual({ ...READ_NODES }, { story: 'readStories', instalment: 'readInstalments' });
  });
});
