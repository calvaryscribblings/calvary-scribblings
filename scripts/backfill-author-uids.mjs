// Backfill / correct author UIDs on cms_stories in RTDB.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/backfill-author-uids.mjs            # plan only, no writes
//   node scripts/backfill-author-uids.mjs --apply    # perform writes
//
// What it does:
//   - Resolves each known author to a uid by reading usernames/<handle>
//     (authoritative — NOT by name-matching).
//   - Builds a two-tier plan over cms_stories:
//       TIER 1 (fill empties): authorUid empty/missing AND author string
//         matches one of the six known authors → that author's uid.
//       TIER 2 (correct catch-all): stories currently on the catch-all uid
//         NH7HmRbwheVFG6XZRGaJDeuBWdJ3 whose author string is Dera Okaro,
//         Stanley Princewill McDaniels, or Maurice Bur → correct uid.
//   - Sets authorHandle on every written record. Never changes the author
//     display string.
//
// Exclusions (never touched): author 'Chioma Okonkwo & Ikenna Okpara',
//   'Oluwafemi Bakare', 'Calvary'; and any NH7… story not in the three
//   TIER 2 names.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const CATCH_ALL_UID = 'NH7HmRbwheVFG6XZRGaJDeuBWdJ3';

const APPLY = process.argv.includes('--apply');

// handle (without leading @) → display name
const HANDLE_TO_NAME = {
  chioma: 'Chioma Okonkwo',
  _fedajee_: 'Ufedo Adaji',
  zubby: 'Okere Josiah',
  dera: 'Dera Okaro',
  princewill1900: 'Stanley Princewill McDaniels',
  maurice: 'Maurice Bur',
};

// TIER 2 display names eligible to be moved off the catch-all uid → handle.
const TIER2_NAME_TO_HANDLE = {
  'Dera Okaro': 'dera',
  'Stanley Princewill McDaniels': 'princewill1900',
  'Maurice Bur': 'maurice',
};

// Display strings we must never touch, regardless of tier logic.
const EXCLUDED_NAMES = new Set([
  'Chioma Okonkwo & Ikenna Okpara',
  'Oluwafemi Bakare',
  'Calvary',
]);

function isEmpty(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

async function main() {
  const keyPath = resolve(ROOT, 'serviceAccountKey.json');
  const serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: DB_URL,
  });
  const db = getDatabase();

  // --- Resolve handles → uids via usernames/<handle> -----------------------
  const handles = Object.keys(HANDLE_TO_NAME);
  const handleToUid = {};
  const nameToUid = {};
  const nameToHandle = {};

  for (const handle of handles) {
    const snap = await db.ref(`usernames/${handle}`).get();
    const val = snap.val();
    // usernames/<handle> may be a bare uid string, or an object containing a uid.
    let uid = null;
    if (typeof val === 'string') uid = val.trim() || null;
    else if (val && typeof val === 'object') uid = (val.uid || val.userId || val.value || '').toString().trim() || null;

    if (!uid) {
      throw new Error(
        `Handle @${handle} did not resolve to a uid via usernames/${handle} ` +
          `(got: ${JSON.stringify(val)}). Aborting — no plan built.`
      );
    }
    const name = HANDLE_TO_NAME[handle];
    handleToUid[handle] = uid;
    nameToUid[name] = uid;
    nameToHandle[name] = handle;
  }

  console.log('Resolved handles → uids (via usernames/<handle>):');
  for (const handle of handles) {
    console.log(`  @${handle.padEnd(15)} ${HANDLE_TO_NAME[handle].padEnd(32)} → ${handleToUid[handle]}`);
  }
  console.log('');

  // Case-insensitive / trimmed lookup map for the six known names.
  const normNameToName = {};
  for (const name of Object.keys(nameToUid)) {
    normNameToName[name.trim().toLowerCase()] = name;
  }

  // --- Read cms_stories ----------------------------------------------------
  const storiesSnap = await db.ref('cms_stories').get();
  const stories = storiesSnap.val() || {};

  const plan = []; // { tier, key, slug, author, oldUid, newUid, handle }

  for (const [key, story] of Object.entries(stories)) {
    if (!story || typeof story !== 'object') continue;
    const author = typeof story.author === 'string' ? story.author : '';
    const slug = story.slug || key;
    const currentUid = isEmpty(story.authorUid) ? '' : String(story.authorUid).trim();

    // Hard exclusion on display string.
    if (EXCLUDED_NAMES.has(author.trim())) continue;

    // --- TIER 1: fill empties ---
    if (isEmpty(currentUid)) {
      // exact match first
      let matchedName = nameToUid[author] ? author : null;
      // then trimmed / case-insensitive
      if (!matchedName) {
        const cand = normNameToName[author.trim().toLowerCase()];
        if (cand) matchedName = cand;
      }
      if (matchedName) {
        plan.push({
          tier: 1,
          key,
          slug,
          author,
          oldUid: '∅',
          newUid: nameToUid[matchedName],
          handle: nameToHandle[matchedName],
        });
      }
      continue; // empty uid handled (or not matched) — never a TIER 2 candidate
    }

    // --- TIER 2: correct catch-all ---
    if (currentUid === CATCH_ALL_UID) {
      const handle = TIER2_NAME_TO_HANDLE[author.trim()];
      if (handle) {
        plan.push({
          tier: 2,
          key,
          slug,
          author,
          oldUid: currentUid,
          newUid: handleToUid[handle],
          handle,
        });
      }
      // NH7… stories not in the three names → excluded (no-op)
    }
  }

  // --- Print the plan ------------------------------------------------------
  printPlan(plan);

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply.');
    return;
  }

  // --- APPLY: multi-path update, idempotent --------------------------------
  console.log('\n--apply: writing changes via multi-path update on cms_stories…\n');
  const updates = {};
  for (const p of plan) {
    updates[`${p.key}/authorUid`] = p.newUid;
    updates[`${p.key}/authorHandle`] = p.handle;
  }

  if (Object.keys(updates).length === 0) {
    console.log('Nothing to write.');
    return;
  }

  await db.ref('cms_stories').update(updates);

  for (const p of plan) {
    console.log(
      `  [tier ${p.tier}] ${p.slug}  author="${p.author}"  uid ${p.oldUid} → ${p.newUid}  handle=@${p.handle}`
    );
  }
  console.log(`\nApplied: ${plan.length} stor${plan.length === 1 ? 'y' : 'ies'} updated.`);
}

function printPlan(plan) {
  const tiers = [
    { n: 1, label: 'TIER 1 — fill empties' },
    { n: 2, label: 'TIER 2 — correct catch-all' },
  ];

  let grand = 0;

  for (const { n, label } of tiers) {
    const rows = plan.filter((p) => p.tier === n);
    console.log(`\n${'='.repeat(72)}\n${label}  (${rows.length})\n${'='.repeat(72)}`);

    if (rows.length === 0) {
      console.log('  (none)');
      continue;
    }

    // group by author
    const byAuthor = {};
    for (const r of rows) (byAuthor[r.author] ||= []).push(r);

    const authors = Object.keys(byAuthor).sort();
    for (const author of authors) {
      const arows = byAuthor[author];
      console.log(`\n  ${author}  (${arows.length})`);
      console.log(
        `    ${'tier'.padEnd(4)} | ${'slug'.padEnd(38)} | ${'old uid'.padEnd(30)} | ${'→ new uid'.padEnd(30)} | handle`
      );
      console.log(`    ${'-'.repeat(4)}-+-${'-'.repeat(38)}-+-${'-'.repeat(30)}-+-${'-'.repeat(30)}-+-------`);
      for (const r of arows) {
        console.log(
          `    ${String(r.tier).padEnd(4)} | ${String(r.slug).slice(0, 38).padEnd(38)} | ${String(r.oldUid).padEnd(30)} | ${String(r.newUid).padEnd(30)} | @${r.handle}`
        );
      }
      console.log(`    → ${author}: ${arows.length}`);
    }

    console.log(`\n  Tier ${n} total: ${rows.length}`);
    grand += rows.length;
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`GRAND TOTAL: ${grand} stor${grand === 1 ? 'y' : 'ies'} in plan.`);
  console.log('='.repeat(72));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
