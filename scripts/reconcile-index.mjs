// THE INDEX RECONCILER — the net under the scheduled-publish cron.
//
//   node scripts/reconcile-index.mjs                 # report only, no writes
//   node scripts/reconcile-index.mjs --apply         # repair what drifted
//   node scripts/reconcile-index.mjs --slug <slug>   # narrow to one record
//   node scripts/reconcile-index.mjs --max 25        # raise the mass-diff refusal
//
// ── WHAT IT IS FOR ───────────────────────────────────────────────────────────────────────
//
// cms_stories_index has TWO writers. The admin dual-write calls indexUpdatePaths() and is
// always complete by construction. The scheduled-publish cron is an external Cloudflare
// Worker (calvary-newsletter) whose projection is a HAND-COPY — it cannot import
// app/lib/storyIndex.js — and it has drifted: it emits no `opening` at all, and the live
// Worker in the Cloudflare dashboard is behind even the repo's mirror and also drops
// `publishedAtMs`. Roughly four stories a week publish through it.
//
// ── WHY A RECONCILER AND NOT A SECOND HAND-COPY ──────────────────────────────────────────
//
// ⚠⚠ THE ~200-LINE TRANSCRIPTION IS THE THING BEING AVOIDED. Carrying `opening` in the Worker
// means hand-copying parseBlocks() from app/lib/htmlBlocks.js AND walkToProse() from
// app/lib/prosePredicate.js — about two hundred lines across two modules — into a file that is
// edited in a web dashboard.
//
// THE OPENING LINE AND THE DROP CAP MUST PICK THE SAME PARAGRAPH. That is not a nicety: it is
// stated in app/lib/storyIndex.js where `opening` is defined, and it is why indexOpening()
// goes through walkToProse() rather than cutting characters — 17 of the live stories open on
// front-matter a cutter would show instead of the story. TWO HAND-COPIES OF ONE PREDICATE IS
// PRECISELY HOW THEY STOP AGREEING, and the drift would be invisible: the search result and
// the story page would each look fine alone.
//
// This project has already lost a year to a hand-copied list that drifted by one entry. The
// reconciler imports the real buildIndexRecord and copies nothing.
//
// ⭑ AND IT CHANGES THE CLASS OF THE PROBLEM, not just this instance. The Worker never needs a
// new field again: anything added to buildIndexRecord lands on scheduled publishes within one
// tick, with no cross-repo dashboard edit. "Every projection change is a dashboard edit"
// becomes "no action".
//
// ── ⚠ IT IS A NET, NOT A FIX. THE DASHBOARD PASTE IS STILL OWED. ─────────────────────────
//
// A */15 tick means a record can be wrong for up to fifteen minutes, and longer when GitHub's
// scheduler is busy — its floor is five minutes and it is best-effort, not guaranteed. For
// `opening` that is a search result briefly missing a line, which is cosmetic. For
// `publishedAtMs` it is FIFTEEN MINUTES OF WRONG ENTITLEMENT once the gate is switched back
// on, and that is not something to leave to a net.
//
// So `publishedAtMs` is fixed AT SOURCE, in the live Worker, and this script is the thing that
// catches what source-fixing misses. Do not read the reconciler as making that paste optional.
//
// ── ⚠ THE MECHANISM, WRITTEN DOWN BECAUSE IT IS COUNTER-INTUITIVE ────────────────────────
//
// A record with NO publishedAtMs is INVISIBLE to `orderBy="publishedAtMs"`. Firebase does not
// return nodes missing the ordered key in the tail of a limitToLast query — so the record
// cannot appear in the most-recent-N floor at all.
//
// The consequence runs BACKWARDS from what anyone expects. The floor is "the five newest
// gateable stories are always free". A newly published story with no publishedAtMs cannot take
// a slot, so:
//
//     · THE NEWEST STORY IS GATED — the one that should most certainly be free.
//     · AN OLDER STORY KEEPS A FREE SLOT it should have just lost.
//
// Both silently. Nothing errors, no page breaks, the query succeeds and returns five slugs;
// they are simply the wrong five. See functions/api/story.js:loadRecentFloor and
// STORY-SERVING-CONTRACT.md §3.2.
//
// (GATING_ENABLED is false today — app/lib/storyAccess.js — so no reader has been affected.
// This is a loaded gun, not an active wound. It fires the day the gate comes back on.)
import { buildIndexRecord, isIndexed, INDEX_PATH } from '../app/lib/storyIndex.js';

/** The mass-diff refusal. See planRepairs. */
export const DEFAULT_MAX_RECORDS = 10;

/**
 * Decide what to repair. PURE — no network, no credentials, no clock.
 *
 * ⚠ THIS IS SEPARATE FROM THE IO ON PURPOSE. A reconciler that finds nothing on a clean corpus
 * is indistinguishable from one that cannot see, and a green scheduled run proves neither.
 * Because the decision is a pure function of (source, index), the suite feeds it a
 * DELIBERATELY DAMAGED corpus and watches it find the damage — which is the only way to know
 * the instrument works before trusting a quiet night.
 *
 * @param src  the whole cms_stories node
 * @param idx  the whole cms_stories_index node
 * @returns {{repairs, refusals, orphans, missing, tooMany, max}}
 */
export function planRepairs(src, idx, { maxRecords = DEFAULT_MAX_RECORDS, slug = null } = {}) {
  const source = src || {};
  const index = idx || {};
  const slugs = (slug ? [slug] : Object.keys(source)).filter((s) => isIndexed(source[s]));

  const repairs = [];
  const refusals = [];
  for (const s of slugs) {
    const want = buildIndexRecord(s, source[s]);
    const before = index[s] || null;

    // ── RAIL 2: REFUSE TO DROP A FIELD ───────────────────────────────────────────────────
    // A key the LIVE record carries that this projection would not emit means this checkout is
    // BEHIND production — someone shipped a field and this runner has not got it. Writing here
    // would delete a field the app may be reading off the index, on a schedule, unattended.
    // The one direction a reconciler must never move in.
    const drops = before ? Object.keys(before).filter((k) => !(k in want)) : [];
    if (drops.length) {
      refusals.push({ slug: s, reason: 'would drop field(s)', drops });
      continue;
    }

    const changed = [...new Set([...Object.keys(before || {}), ...Object.keys(want)])]
      .filter((k) => JSON.stringify((before || {})[k]) !== JSON.stringify(want[k]))
      .sort();
    if (changed.length) repairs.push({ slug: s, want, before, changed, absent: !before });
  }

  // Records in the index that should not be there at all. REPORTED, NEVER DELETED BY THIS
  // SCRIPT: an orphan means a story was hidden or removed without its index entry going with
  // it, which is an editorial action to look at, not something a cron should tidy away.
  const orphans = Object.keys(index).filter((s) => !source[s] || !isIndexed(source[s]));

  // ── RAIL 3: A MASS DIFF IS A HUMAN DECISION ──────────────────────────────────────────
  // One or two drifted records is the cron having published. Fifty is somebody having changed
  // the projection — which is a backfill, and a backfill is a decision with a person behind
  // it, not something a scheduled job does at 3am while nobody is watching.
  // scripts/backfill-stories-index.mjs is the deliberate instrument for that.
  const tooMany = repairs.length > maxRecords;

  return {
    repairs,
    refusals,
    orphans,
    missing: repairs.filter((r) => r.absent).map((r) => r.slug),
    tooMany,
    max: maxRecords,
  };
}

/** Which projected fields are short across the whole plan, and how many records each. */
export function driftByField(plan) {
  const out = {};
  for (const r of plan.repairs) for (const k of r.changed) out[k] = (out[k] || 0) + 1;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The IO half. Everything below is unreachable when this module is imported by the suite.
// ─────────────────────────────────────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { readFile } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const APPLY = argv.includes('--apply');
  const ONLY = flag('--slug');
  const MAX = Number(flag('--max') || DEFAULT_MAX_RECORDS);

  const get = async (path) => {
    const r = await fetch(`${DB_URL}/${path}.json`);
    if (!r.ok) { console.error(`::error::read failed ${path}: HTTP ${r.status}`); process.exit(1); }
    return r.json();
  };

  const [src, idx] = await Promise.all([get('cms_stories'), get(INDEX_PATH)]);
  if (!src || typeof src !== 'object') {
    console.error('::error::cms_stories is empty — refusing to reconcile against nothing.');
    process.exit(1);
  }

  const plan = planRepairs(src, idx, { maxRecords: MAX, slug: ONLY });
  const eligible = Object.keys(src).filter((s) => isIndexed(src[s]));
  console.log(`cms_stories: ${Object.keys(src).length} total, ${eligible.length} eligible`);
  console.log(`${INDEX_PATH}: ${Object.keys(idx || {}).length} records`);
  console.log(`records needing repair: ${plan.repairs.length}${plan.missing.length ? ` (${plan.missing.length} absent entirely)` : ''}`);

  if (plan.orphans.length) {
    console.log(`\nIN THE INDEX BUT NOT ELIGIBLE (reported, never deleted here): ${plan.orphans.join(', ')}`);
  }
  if (plan.refusals.length) {
    for (const r of plan.refusals) {
      console.log(`::error::${r.slug}: ${r.reason} — ${r.drops.join(', ')}. This checkout is BEHIND production; pull and re-check app/lib/storyIndex.js.`);
    }
    process.exit(1);
  }

  if (!plan.repairs.length) {
    console.log('\nNothing to do — every eligible story has a complete, current index record.');
    process.exit(0);
  }

  console.log(`\ndrift by field: ${JSON.stringify(driftByField(plan))}`);
  for (const r of plan.repairs) {
    console.log(`  ${r.slug}${r.absent ? '  [ABSENT FROM INDEX]' : ''}  →  ${r.changed.join(', ')}`);
  }

  if (plan.tooMany) {
    console.log(
      `\n::error::REFUSING: ${plan.repairs.length} records differ, over the ${plan.max} limit. `
      + 'A diff this wide is a PROJECTION CHANGE, not the cron having published — and a backfill '
      + 'is a decision with a person behind it. Run scripts/backfill-stories-index.mjs --apply '
      + 'deliberately, or pass --max if you have read the list above and it is genuinely routine.',
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply.');
    process.exit(0);
  }

  const { cert } = await import('firebase-admin/app');
  const keyPath = process.env.RECONCILE_SERVICE_ACCOUNT || resolve(ROOT, 'serviceAccountKey.json');
  const svc = JSON.parse(await readFile(keyPath, 'utf8'));
  const token = (await cert(svc).getAccessToken()).access_token;

  let failed = 0;
  for (const r of plan.repairs) {
    // One COMPLETE projected record per slug — never a deep path. A deep-path write
    // (cms_stories_index/<slug>/<field>) creates the parent when the slug is absent, leaving a
    // record holding one field that still counts as a member. See rule 2 in the header of
    // app/lib/storyIndex.js; that is how a story once vanished from its author's Voices page.
    const put = await fetch(`${DB_URL}/${INDEX_PATH}/${r.slug}.json?access_token=${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r.want),
    });
    if (!put.ok) {
      console.log(`::error::${r.slug}: write failed HTTP ${put.status} — ${(await put.text()).slice(0, 200)}`);
      failed++;
      continue;
    }
    // Verify field by field, NEVER JSON.stringify(a) === JSON.stringify(b): the REST API
    // returns keys in its own order, so a byte comparison reports a mismatch on a record that
    // is perfectly correct — and a check that cries wolf is one the next person learns to skip.
    const after = await get(`${INDEX_PATH}/${r.slug}`);
    const bad = [...new Set([...Object.keys(after || {}), ...Object.keys(r.want)])]
      .filter((k) => JSON.stringify((after || {})[k]) !== JSON.stringify(r.want[k]));
    if (bad.length) {
      console.log(`::error::${r.slug}: read-back mismatch on ${bad.join(', ')}`);
      failed++;
    } else {
      console.log(`  repaired ${r.slug} (${r.changed.join(', ')}) — verified`);
    }
  }

  if (failed) { console.log(`\n${failed} record(s) failed.`); process.exit(1); }
  console.log(`\n${plan.repairs.length} record(s) repaired and verified.`);
}
