#!/usr/bin/env node
// R13 — ONE-SHOT MIGRATION: the genre taxonomy and the Window's claim.
//
// Writes two nodes that did not exist before this round:
//
//   bookstore_genres/{slug}     twelve records — label, group, order. The vocabulary the shop
//                               already renders, moved out of three hard-coded tables.
//   bookstore_sections/{id}     ONE record: the WINDOW section carrying whichever published
//                               title currently has `featured` set. Nothing else. The other
//                               five section types are Ikenna's to claim in the CMS, and this
//                               script deliberately seeds none of them.
//
// ── THE PROOF THIS MIGRATION OWES ────────────────────────────────────────────────────────
//
// The shop must render IDENTICALLY before and after. Two halves:
//
//   TABS      — the genre records reproduce app/bookstore/page.js's pre-R13 GENRE_LABELS and
//               the FICTION_GENRES / NONFICTION_GENRES split exactly, so the same tabs appear
//               in the same order with the same words. Asserted offline, against the pre-R13
//               source, by tests/bookstore/genres.test.mjs — this script cannot be the proof
//               of its own correctness, so the test reads the old file out of git history.
//   THE WINDOW— the section claims the slug `featured` already pointed at, so the same book
//               stands in the same case. Asserted by tests/bookstore/sections.test.mjs.
//
// ── IDEMPOTENT, AND IT REFUSES RATHER THAN OVERWRITES ────────────────────────────────────
//
// Genres are upserted (a re-run restores the seed values, which is the point of a seed).
// SECTIONS ARE NOT. If bookstore_sections already holds anything, this script leaves it alone
// and says so: after the migration that node is a curator's working document, and a second
// run of a migration must never quietly flatten a shelf plan somebody has since arranged.
//
// ── AUTH, AND THE GUARD ──────────────────────────────────────────────────────────────────
//
// A service-account JSON at FIREBASE_SERVICE_ACCOUNT_PATH, handed to scripts/safety/guard.mjs,
// which mints the token and does every read and write by REST. No firebase-admin dependency.
//
// Run:
//   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json \
//     node scripts/migrate-bookstore-taxonomy.mjs            # dry run: prints the payload
//   FIREBASE_SERVICE_ACCOUNT_PATH=… node scripts/migrate-bookstore-taxonomy.mjs --apply
//
// SAFETY-1: DRY BY DEFAULT (it used to write by default, with an opt-in --dry-run). It now writes
// only with --apply, through the guard: the exact genre and section paths are backed up and
// verified, then written as one atomic update. --dry-run is still accepted, and means the
// default; given together with --apply it wins, and nothing is written.

import { buildGenreMigration, buildWindowMigration, validateSection } from '../app/lib/bookstore/sections.js';
import { validateGenre } from '../app/lib/bookstore/genres.js';
import { openGuard } from './safety/guard.mjs';

async function main() {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH env var is required');
    process.exit(2);
  }

  const guard = await openGuard('migrate-bookstore-taxonomy', {
    apply: process.argv.includes('--apply') && !process.argv.includes('--dry-run'),
    env: { ...process.env, GUARD_SERVICE_ACCOUNT: saPath },
  });
  const dry = !guard.apply;
  const at = Date.now();

  // ── 1. GENRES ──────────────────────────────────────────────────────────────────────────
  const genrePayload = buildGenreMigration(at);
  const genrePatch = {};
  for (const g of genrePayload) {
    const { valid, errors } = validateGenre(g);
    if (!valid) throw new Error(`seed genre ${g.slug} invalid: ${errors.join('; ')}`);
    genrePatch[g.slug] = g;
  }
  console.log(`[migrate] genres: ${genrePayload.length} records`);
  for (const g of genrePayload) console.log(`  ${String(g.order).padStart(2)} ${g.group.padEnd(10)} ${g.slug.padEnd(24)} "${g.label}"`);

  // ── 2. THE WINDOW ──────────────────────────────────────────────────────────────────────
  console.log('[migrate] reading bookstore_sections/…');
  const existingSections = await guard.get('bookstore_sections');
  let sectionPatch = null;

  if (existingSections && typeof existingSections === 'object' && Object.keys(existingSections).length > 0) {
    console.log(`[migrate] bookstore_sections already holds ${Object.keys(existingSections).length} record(s) — LEAVING IT ALONE.`);
    console.log('[migrate] (a migration must never flatten a shelf plan a curator has arranged)');
  } else {
    console.log('[migrate] reading published titles…');
    const titlesRaw = await guard.get('bookstore_titles');
    const titles = Object.entries(titlesRaw || {}).map(([id, v]) => ({ id, ...v }));
    const published = titles.filter((t) => t.status === 'published');
    console.log(`[migrate] ${published.length} published of ${titles.length} on file`);

    const windowPayload = buildWindowMigration(published, at);
    if (windowPayload.length === 0) {
      console.log('[migrate] ⚠ no published title carries `featured` — no Window claim to write.');
      console.log('[migrate]   The shop will render no display case, which is what it renders today.');
    } else {
      sectionPatch = {};
      for (const sec of windowPayload) {
        const { id, ...doc } = sec;
        const { valid, errors } = validateSection(doc);
        if (!valid) throw new Error(`window section invalid: ${errors.join('; ')}`);
        sectionPatch[id] = doc;
        console.log(`[migrate] sections: WINDOW "${doc.displayTitle}" claims ${doc.slugs.join(', ')} (order ${doc.order})`);
      }
    }
  }

  // One record per path, exactly as the old per-node PATCHes replaced each child: genres upserted,
  // sections only when the node was empty.
  const updates = {};
  for (const [slug, g] of Object.entries(genrePatch)) updates[`bookstore_genres/${slug}`] = g;
  for (const [id, doc] of Object.entries(sectionPatch || {})) updates[`bookstore_sections/${id}`] = doc;

  if (dry) {
    console.log('\n[migrate] DRY RUN (the default): NOTHING WRITTEN. Payload follows; re-run with --apply to write it.\n');
    console.log(JSON.stringify({ bookstore_genres: genrePatch, bookstore_sections: sectionPatch }, null, 2));
    await guard.update(updates, { label: 'taxonomy' });
    return;
  }

  console.log(`[migrate] writing bookstore_genres/${sectionPatch ? ' and bookstore_sections/' : ''}…`);
  await guard.update(updates, { label: 'taxonomy' });
  guard.summary();
  console.log('[migrate] done.');
  console.log('[migrate] NEXT: load /bookstore and confirm the tabs and the Window are unchanged.');
  // The follow-up this used to print — "delete the bootstrap branches in loader.js" — was done
  // in R17.2, on 20 Aug 2026, once both nodes were verified written in production. There are no
  // bootstrap branches left to delete, so the instruction is retired rather than left printing
  // advice about code that no longer exists.
  console.log('[migrate] (loader.js\'s getGenres/getSections bootstraps were retired in R17.2 — nothing further to remove.)');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
