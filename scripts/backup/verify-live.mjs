// SAFETY-1 — the restore drill's second half: is what came back the SAME DATABASE as live?
//
// The first half (restore-drill.mjs) proves the archive restores into the emulator and reads
// back identical to itself. That says the backup is internally sound. It does not say the
// backup is a backup OF PRODUCTION — an archive of the wrong project, or of a database that
// had already lost a node, would pass it. This compares the restored emulator against live.
//
// READ-ONLY against production: every live request is a GET. It prints COUNTS, node names,
// and verdicts — never a record, a field value, or a key. A record that differs is reported
// as a number, with whether it carries a timestamp later than the backup (an ordinary change
// since 01:00) or not (unexplained, and worth a look).

import { createHash, randomInt } from 'node:crypto';

const LIVE = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

/** The canonical form restore-drill.mjs uses: keys sorted, dense arrays ≡ numeric-keyed objects. */
export function canon(v) {
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { if (x !== null && x !== undefined) o[String(i)] = canon(x); });
    return o;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
export const hash = (v) => createHash('sha256').update(JSON.stringify(canon(v ?? null))).digest('hex');

const TIME_KEY = /(at|ms|time|date|updated|edited|last|seen|stamp)$/i;
/** Does this record carry a timestamp later than `sinceMs` anywhere inside it? */
export function touchedSince(rec, sinceMs, depth = 0) {
  if (!rec || typeof rec !== 'object' || depth > 6) return false;
  for (const [k, v] of Object.entries(rec)) {
    if (TIME_KEY.test(k)) {
      const ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN;
      if (Number.isFinite(ms) && ms > sinceMs) return true;
    }
    if (v && typeof v === 'object' && touchedSince(v, sinceMs, depth + 1)) return true;
  }
  return false;
}

const sizeOf = (v) => (v && typeof v === 'object' ? Object.keys(v).length : v === undefined || v === null ? 0 : 1);

/**
 * @param restored  the tree read back from the emulator
 * @param takenAt   ISO time of the archive
 * @param token     an admin OAuth token (GET only)
 * @param sample    records per major node
 */
export async function compareWithLive({ restored, takenAt, token, sample = 10, log = console.log }) {
  const H = { Authorization: `Bearer ${token}` };
  const sinceMs = Date.parse(takenAt);
  const get = async (path, shallow = false) => {
    const r = await fetch(`${LIVE}/${path}.json${shallow ? '?shallow=true' : ''}`, { headers: H });
    if (!r.ok) throw new Error(`live read of a node failed: HTTP ${r.status}`);
    return r.json();
  };

  let bad = 0;
  const say = (ok, label) => { if (!ok) bad++; log(`  ${ok ? '✓' : '✗'} ${label}`); };

  // 1. The top level: same set of nodes, and each node's record count.
  const liveTop = (await get('', true)) || {};
  const names = [...new Set([...Object.keys(restored), ...Object.keys(liveTop)])].sort();
  const onlyBackup = names.filter((n) => !(n in liveTop));
  const onlyLive = names.filter((n) => !(n in restored));
  log(`\nAGAINST LIVE (read-only; counts and verdicts only)`);
  log(`  top-level nodes: backup ${Object.keys(restored).length}, live ${Object.keys(liveTop).length}`);
  if (onlyBackup.length) log(`    in the backup only: ${onlyBackup.join(', ')}`);
  if (onlyLive.length) log(`    in live only (created since the backup): ${onlyLive.join(', ')}`);

  const rows = [];
  for (const n of names) {
    const liveKeys = n in liveTop ? (await get(encodeURIComponent(n), true)) : null;
    rows.push({ n, b: sizeOf(restored[n]), l: sizeOf(liveKeys) });
  }
  const same = rows.filter((r) => r.b === r.l).length;
  log(`  record counts: ${same} of ${rows.length} nodes identical; the rest:`);
  log(`    ${'node'.padEnd(34)} ${'backup'.padStart(7)} ${'live'.padStart(7)} ${'Δ'.padStart(6)}`);
  for (const r of rows) {
    if (r.b !== r.l) log(`    ${r.n.padEnd(34)} ${String(r.b).padStart(7)} ${String(r.l).padStart(7)} ${String(r.l - r.b).padStart(6)}`);
  }
  // A node that LOST more than a tenth of its records since 01:00 is not ordinary traffic.
  const shrunk = rows.filter((r) => r.b >= 20 && r.l < r.b * 0.9);
  say(shrunk.length === 0, `no node has lost >10% of its records since the backup${shrunk.length ? ` (${shrunk.map((r) => r.n).join(', ')})` : ''}`);
  say(onlyBackup.length === 0, 'every node in the backup still exists live');

  // 2. The named pairs and counts.
  const n = (name) => rows.find((r) => r.n === name) || { b: 0, l: 0 };
  const sb = n('story_bodies'), cs = n('cms_stories');
  log(`\n  story_bodies / cms_stories: backup ${sb.b} / ${cs.b}, live ${sb.l} / ${cs.l}`);
  const bodyKeys = Object.keys(restored.story_bodies || {}), storyKeys = new Set(Object.keys(restored.cms_stories || {}));
  const pairedInBackup = bodyKeys.filter((k) => storyKeys.has(k)).length;
  say(sb.b === cs.b && pairedInBackup === sb.b, `backup: every story_bodies record pairs with a cms_stories record (${pairedInBackup} of ${sb.b})`);
  say(sb.l === cs.l, `live: story_bodies and cms_stories hold the same number of records (${sb.l} / ${cs.l})`);
  for (const name of ['users', 'bookstore_purchases']) {
    const r = n(name);
    log(`  ${name}: backup ${r.b}, live ${r.l} (Δ ${r.l - r.b})`);
  }

  // 3. Random records, hash-compared. "Major" = the nodes that hold readers' and editors' work.
  const MAJOR = ['cms_stories', 'story_bodies', 'users', 'bookstore_purchases', 'bookstore_titles',
    'open_pages', 'comments', 'square_posts', 'points', 'user_search', 'series', 'series_instalments',
    'bookstore_reading_progress', 'wallet'];
  log(`\n  ${sample} random records per major node, sha-256 of the canonical record, backup vs live:`);
  log(`    ${'node'.padEnd(28)} identical  changed-since  unexplained  gone-since`);
  let unexplained = 0;
  for (const name of MAJOR) {
    const keys = Object.keys(restored[name] || {});
    if (!keys.length) { log(`    ${name.padEnd(28)} (not in this backup)`); continue; }
    const picked = new Set();
    while (picked.size < Math.min(sample, keys.length)) picked.add(keys[randomInt(keys.length)]);
    let id = 0, since = 0, odd = 0, gone = 0;
    for (const k of picked) {
      const live = await get(`${encodeURIComponent(name)}/${encodeURIComponent(k)}`);
      if (live === null) { gone++; continue; }
      if (hash(live) === hash(restored[name][k])) id++;
      else if (touchedSince(live, sinceMs)) since++;
      else odd++;
    }
    unexplained += odd;
    log(`    ${name.padEnd(28)} ${String(id).padStart(9)}  ${String(since).padStart(12)}  ${String(odd).padStart(11)}  ${String(gone).padStart(10)}`);
  }
  log(`    (changed-since: differs, and carries a timestamp later than the backup — ordinary traffic.`);
  log(`     unexplained: differs with no later timestamp — usually a counter or a list; look if many.)`);
  say(unexplained <= 3, `unexplained differences within tolerance (${unexplained})`);
  return bad;
}
