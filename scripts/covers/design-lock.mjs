// THE DESIGN LOCK — what stops a robot shipping a design nobody looked at.
//
// ── THE PROBLEM IT SOLVES ────────────────────────────────────────────────────────────────
// scripts/covers/migrate.mjs is hand-run, and it refuses to write unless covers-migration/
// SIGNOFF.md names the exact contact sheet on disk by its SHA-256. That gate is good, and its
// whole content is one idea: APPROVAL IS OF A SPECIFIC SET OF RENDERED IMAGES, and it must
// not silently outlive them. Touch the layout, a livery, a font or the renderer and the
// sheet's hash moves, the sign-off stops matching, and the migration refuses.
//
// scripts/covers/on-publish.mjs runs UNATTENDED. Give it the same power to write and none of
// that gate, and this becomes true: anyone who edits the ladder and pushes has re-flipped 158
// live covers, at whatever time the next scheduled run fires, with a design no one approved.
// That would make the automatic path weaker than the manual one — a regression, not a
// feature.
//
// The contact-sheet gate cannot simply be reused: it binds to covers-contact-sheet/
// manifest.json, which is gitignored, is built from LIVE story records over the network, and
// therefore moves whenever an editor fixes a typo in a title. A lock that breaks on an
// unrelated copy-edit is a lock people learn to force.
//
// ── WHAT THIS IS INSTEAD ─────────────────────────────────────────────────────────────────
// A frozen set of FULLY-SPECIFIED records — no slugs, no network, no live data — rendered and
// hashed. DESIGN-LOCK.json holds those hashes and is committed. `on-publish.mjs --apply`
// re-renders the probes and refuses if any hash has moved.
//
// So the lock file IS the sign-off, and it lives where a sign-off belongs: in a commit, with
// a diff, with a reviewer. Changing the design and updating the lock in the same commit is
// exactly the deliberate act the contact-sheet gate was asking for; changing the design and
// NOT updating it stops the reconciler dead.
//
// ── WHAT THE PROBES HAVE TO COVER ────────────────────────────────────────────────────────
// Everything a change to the design could move: every livery (both grounds, glow and no
// glow), every rung of the title ladder, the descriptor present and absent, the two
// last-resort break rules, non-ASCII, and the fallbacks for a record with no category. A
// probe set that misses a surface is a surface that can change unnoticed.
//
// These records are deliberately NOT the contact sheet's CASES: those are mostly live slugs
// fetched over the network, and a lock must not depend on the library's current contents.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCover } from './render.mjs';
import { sha } from './store.mjs';

export const LOCK_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'DESIGN-LOCK.json');

/** The probe set. Frozen: adding a probe is fine, CHANGING one silently retires a guarantee. */
export const PROBES = Object.freeze([
  // ── the five story liveries, plus the built-but-unused Series livery ──────────────────
  { slug: 'probe-short',     title: 'Odeluwa', author: 'Chimamanda Adichie', category: 'short',     subcategory: 'Drama' },
  { slug: 'probe-poetry',    title: 'Odeluwa', author: 'Chimamanda Adichie', category: 'poetry',    subcategory: 'Spoken Word' },
  { slug: 'probe-flash',     title: 'Odeluwa', author: 'Chimamanda Adichie', category: 'flash',     subcategory: 'Horror' },
  { slug: 'probe-inspiring', title: 'Odeluwa', author: 'Chimamanda Adichie', category: 'inspiring', subcategory: 'Faith' },
  { slug: 'probe-news',      title: 'Odeluwa', author: 'Chimamanda Adichie', category: 'news',      subcategory: 'Updates' },
  { slug: 'probe-series',    title: 'Halfway Around the Moon', author: 'Ikenna Okpara', liveryKey: 'series', instalmentOrdinal: 1 },

  // ── every rung of the ladder, so a change to any of the six sizes moves a hash ────────
  { slug: 'probe-rung-186', title: 'Beyond Saving', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-rung-140', title: 'Your Camera Is On', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-rung-112', title: 'May Nigeria Never Happen To You', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-rung-92',  title: 'Notting Hill Carnival: A New Spin on an Old Tradition', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-rung-78',  title: "'Release the Footage': How the Henry Nowak Case Became an International Debate", author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-rung-68',  title: 'The Age of Agentic AI: When Machines Start Hacking Without Permission or a Human in the Loop at All', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },

  // ── the descriptor, present and absent — absence is a finished design, not a gap ──────
  { slug: 'probe-descriptor', title: 'Chaff', author: 'Stanley Princewill McDaniels', category: 'short', subcategory: 'Drama', descriptor: 'stillness. betrayal. reckoning.' },
  { slug: 'probe-no-descriptor', title: 'Chaff', author: 'Stanley Princewill McDaniels', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-descriptor-light', title: 'A Heart Trained for Battle', author: 'Grace Abioye', category: 'poetry', subcategory: 'Free Verse', descriptor: 'suspicion. grief. staying.' },

  // ── the three break rules, each of which has already shipped a defect once ────────────
  //   mid-word  — UNSTOPPAB / BL      (fixed: a last-resort break does not satisfy a rung)
  //   hyphen    — BROWN-SKI / NNED    (fixed: an existing hyphen is a break opportunity)
  //   widow     — MY LIFE AT / 39     (fixed: a break that widows does not satisfy a rung)
  { slug: 'probe-break-midword', title: 'unstoppaBBL', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-break-hyphen',  title: 'Brown-Skinned Girl', author: 'A. N. Other', category: 'poetry', subcategory: 'Free Verse' },
  { slug: 'probe-break-widow',   title: 'My Life at 39', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
  { slug: 'probe-break-impossible', title: 'Antidisestablishmentarianism', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },

  // ── the edges the gate asked for: non-ASCII, and a record with no category at all ─────
  { slug: 'probe-non-ascii', title: 'Àkúdáàya', author: 'Céline Beyoncé Adékúnlé', category: 'poetry', subcategory: 'Spoken Word', descriptor: 'return. rumour. recognition.' },
  { slug: 'probe-unfiled', title: 'The Unfiled Story', author: 'A. N. Other', category: '', subcategory: '' },
  { slug: 'probe-numeral', title: '1967', author: 'A. N. Other', category: 'short', subcategory: 'Drama' },
]);

/** Render every probe and hash it. Offline, deterministic, ~20s. */
export function renderProbes() {
  const out = {};
  for (const p of PROBES) out[p.slug] = sha(renderCover(p).png);
  return out;
}

export function readLock() {
  return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
}

/**
 * Compare the renderer as it stands against the committed lock.
 * Returns { ok, moved: [{ slug, was, now }], added: [...], removed: [...] }.
 */
export function checkLock() {
  const lock = readLock();
  const now = renderProbes();
  const moved = [];
  for (const [slug, want] of Object.entries(lock.probes)) {
    if (!(slug in now)) continue;
    if (now[slug] !== want) moved.push({ slug, was: want, now: now[slug] });
  }
  const added = Object.keys(now).filter((s) => !(s in lock.probes));
  const removed = Object.keys(lock.probes).filter((s) => !(s in now));
  return { ok: !moved.length && !added.length && !removed.length, moved, added, removed, now, lock };
}

/** The message a refusal prints. Kept here so the CLI and the suite say the same thing. */
export function lockFailureMessage({ moved, added, removed }) {
  const lines = ['REFUSED — the renderer no longer matches scripts/covers/DESIGN-LOCK.json.', ''];
  for (const m of moved) lines.push(`  moved   ${m.slug}  ${m.was.slice(0, 12)} → ${m.now.slice(0, 12)}`);
  for (const s of added) lines.push(`  added   ${s}  (a new probe, not yet in the lock)`);
  for (const s of removed) lines.push(`  removed ${s}  (in the lock, no longer a probe)`);
  lines.push(
    '',
    '  Something about the DESIGN changed — the layout, a livery, a font, the ladder or the',
    '  renderer — and the reconciler will not push an unreviewed design over 158 live covers.',
    '',
    '  If the change is intended:',
    '    1. npm run covers:sheet   and have the sheet looked at;',
    '    2. npm run covers:lock    to re-record the probe hashes;',
    '    3. commit the lock WITH the change, so the diff carries the approval.',
    '',
    '  If it is not intended, something drifted. Do not update the lock — find out what.',
  );
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────
//   node scripts/covers/design-lock.mjs            # check, exit 1 if the design has moved
//   node scripts/covers/design-lock.mjs --write    # re-record the probe hashes
//
// `--write` is not a fix. It is the act of approving a design change, and it belongs in the
// same commit as the change it approves.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync, existsSync } = await import('node:fs');
  const write = process.argv.includes('--write');
  if (write) {
    const probes = renderProbes();
    writeFileSync(LOCK_FILE, `${JSON.stringify({ version: 1, probes }, null, 2)}\n`);
    console.log(`wrote ${Object.keys(probes).length} probe hashes to ${LOCK_FILE}`);
  } else if (!existsSync(LOCK_FILE)) {
    console.error(`no lock file at ${LOCK_FILE} — run with --write to record one`);
    process.exit(2);
  } else {
    const result = checkLock();
    if (result.ok) console.log(`design lock OK — ${Object.keys(result.now).length} probes unchanged`);
    else { console.error(lockFailureMessage(result)); process.exit(3); }
  }
}
