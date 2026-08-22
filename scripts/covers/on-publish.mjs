// COVERS ON PUBLISH — the standing reconciler.
//
//   node scripts/covers/on-publish.mjs              # PLAN. Renders, compares, writes nothing.
//   node scripts/covers/on-publish.mjs --check      # same, but exits 1 if anything is stale.
//   node scripts/covers/on-publish.mjs --apply      # generate, upload, flip.
//   node scripts/covers/on-publish.mjs --slug foo   # one story, any of the above modes.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS IS NOT A HOOK IN THE PUBLISH PATH, AND CANNOT BE
// ════════════════════════════════════════════════════════════════════════════════════════
// The obvious design is: the CMS saves a story and generates its cover in the same breath.
// It is not available here, for a reason that is structural rather than a matter of effort.
//
// The renderer is @napi-rs/canvas, PINNED EXACTLY at 1.0.6, and the pin is load-bearing:
// the title auto-sizer picks a rung by asking measureText whether a line fits, so MEASUREMENT
// AND DRAWING MUST COME FROM THE SAME ENGINE BUILD. There are exactly two places CMS-publish
// code runs, and neither can host that engine:
//
//   • THE BROWSER. app/admin/page.js is a React client. A browser canvas measures with
//     Blink's Skia, not ours, so a cover rendered there would be a DIFFERENT IMAGE from the
//     one tests/covers/determinism.test.mjs proves and from the 158 already in Storage.
//     Worse, it would be silently different — and idempotence in this subsystem is decided by
//     comparing render hashes, so every cover would appear permanently stale to every other
//     tool. Rendering in the browser does not solve the problem; it poisons the invariant.
//
//   • CLOUDFLARE PAGES FUNCTIONS. Every live endpoint runs on workerd (next.config.mjs sets
//     output: 'export', so Route Handlers are not built). workerd runs no native N-API
//     addons at all. There is no Node server anywhere in this architecture.
//
// So generation has to happen in a Node worker, out of band, and the only question left is
// what the publish path does in the meantime. That is answered below, and in app/admin/page.js.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// THE TWO PROMISES, AND HOW EACH IS KEPT
// ════════════════════════════════════════════════════════════════════════════════════════
// The ruling is that a story must never be published with NO cover and never with a STALE
// one. Out-of-band generation threatens both, and they are kept by different mechanisms
// because they are different risks.
//
// NEVER WITH NO COVER — `coverHold`.
//   A story saved from the CMS that has no typographic cover yet is written with
//   `published: false` and `coverHold: true`. It is a draft, and the CMS says so. This run
//   generates its cover and publishes it IN THE SAME ATOMIC PATCH — so there is no instant at
//   which the story is visible and coverless. If generation fails, the story simply stays a
//   draft and this process exits non-zero. NOTHING SHIPS WRONG; something is merely late,
//   loudly.
//
//   `coverHold` is what distinguishes "waiting for a cover" from "deliberately hidden". A
//   story an editor hid with the Hide button has published:false and NO hold, and this
//   reconciler will regenerate its cover but will never un-hide it.
//
// NEVER WITH A STALE ONE — `descriptorPending`, and content-addressed paths.
//   An EDIT to an already-published story is the hard case, and the honest answer is an
//   asymmetry rather than a rule:
//
//     • Un-publishing a live story to wait for a new cover would pull it off the site over a
//       cosmetic change. That is worse than the thing it prevents, so edits do not hold. The
//       story stays live, wearing its own last-good typographic cover, until this run gives
//       it the new one.
//
//     • EXCEPT the descriptor, which is the one field that can be stale ON THE COVER ITSELF.
//       A record claiming "duty. sacrifice. ruin." over a cover that shows no such words is a
//       story lying about itself. So the CMS never writes `descriptor` directly: an edit goes
//       to `descriptorPending`, and this run moves it into `descriptor` in THE SAME PATCH as
//       the cover that displays it. Until then the record still says what the cover says.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// STALENESS IS DECIDED BY THE PATH, NOT BY A STATE FILE
// ════════════════════════════════════════════════════════════════════════════════════════
// migrate.mjs carries a resumable manifest because a one-off sweep of 158 stories has to
// survive a kill -9 halfway through. A reconciler that runs forever must not: a state file is
// a second source of truth that drifts, and it is not shared with the runner this executes on.
//
// Instead, staleness is read off the live record. Generation-2 objects live at
// covers-typographic/{slug}/{sha12}/… — the directory IS the render's own hash — so:
//
//     render the record  →  sha12  →  the three object paths that hash implies
//     the cover is CURRENT exactly when `cover`, `coverSizes.w360` and `coverSizes.w720`
//     already name those three paths, and nothing is pending.
//
// No bookkeeping, nothing to corrupt, and self-healing: a record half-flipped by any means at
// all reads as stale and is repaired on the next run. Identical bytes mean no upload and no
// flip, so a quiet library costs three RTDB reads and a minute of rendering.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCover } from './render.mjs';
import { toRecord, parseArgs } from './generate.mjs';
import { isIndexed } from '../../app/lib/storyIndex.js';
import { checkLock, lockFailureMessage } from './design-lock.mjs';
import {
  BUCKET, DB_URL, SOURCE_NODE, WIDTHS,
  assertStoryScope, coverDir, coverFlipPaths, deriveFrom, rtdbPatch, accessToken,
  sha12, uploadCoverSet, urlPointsAt,
} from './store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DELAY_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every record this reconciler is allowed to touch.
 *
 * A PUBLISHED story, or one HELD for its cover. The second half is the whole point of the
 * hold: `isIndexed` is false for a held story, so reading only published records would leave
 * the held ones waiting forever for a cover nobody was going to generate.
 */
async function fetchStories() {
  const res = await fetch(`${DB_URL}/${SOURCE_NODE}.json`);
  if (!res.ok) throw new Error(`${SOURCE_NODE} read failed: HTTP ${res.status}`);
  const all = await res.json();
  return Object.entries(all ?? {})
    .filter(([, s]) => isIndexed(s) || s?.coverHold === true)
    .map(([slug, s]) => ({ slug, story: s, held: s.coverHold === true }));
}

/**
 * What this record's cover SHOULD be, and whether it already is.
 *
 * The descriptor question is settled here, before the render, because a pending descriptor is
 * an input to the image and not an afterthought to it: render with the words that are about
 * to be true, then write the words and the picture together.
 */
function assess({ slug, story, held }) {
  const record = toRecord(slug, story);
  const pending = typeof story.descriptorPending === 'string' ? story.descriptorPending : null;
  if (pending !== null) record.descriptor = pending || null;

  const { png, plan } = renderCover(record);
  const dir = coverDir(slug, png);
  const current =
    urlPointsAt(story.cover, `${dir}/cover.png`) &&
    WIDTHS.every((w) => urlPointsAt(story.coverSizes?.[`w${w}`], `${dir}/w${w}.webp`));

  // A held story is never "current", however good its cover is: the flip is also what
  // publishes it, and skipping the flip would leave it a draft forever.
  const reasons = [];
  if (!current) {
    reasons.push(
      !story.cover ? 'no cover'
        : /covers-typographic/.test(story.cover) ? 'typographic cover is stale'
          : 'cover is uploaded artwork, not the generated cover',
    );
  }
  if (pending !== null) reasons.push('descriptor pending');
  if (held) reasons.push('held for its cover');

  return { slug, story, record, png, plan, dir, pending, held, stale: reasons.length > 0, reasons };
}

/**
 * THE FOLLOWER NOTIFICATION FOR A STORY THAT WAS HELD.
 *
 * app/admin/page.js notifies an author's followers on publish. A held story is not published
 * when it is saved, so that notification would point every follower at a story that does not
 * exist yet — and the admin now skips it, deliberately. It travels with the publication
 * instead, which happens here.
 *
 * BEST-EFFORT, AND DELIBERATELY AFTER THE FLIP. The cover and the publication are the atomic
 * part; an announcement is not. A story that is live with an unsent notification is a story
 * with a quiet launch. A notification sent before a failed flip would be a lie. So this runs
 * last, and a failure warns rather than failing the run — the cover is already correct.
 */
async function notifyFollowers(token, slug, story) {
  const uid = story.authorUid;
  if (!uid) return 0;
  const res = await fetch(`${DB_URL}/followers/${uid}.json?shallow=true&access_token=${token}`);
  if (!res.ok) throw new Error(`followers read failed: HTTP ${res.status}`);
  const followers = Object.keys((await res.json()) ?? {});
  for (const fid of followers) {
    const body = {
      type: 'new_story', fromUid: uid, fromName: story.author || '',
      storySlug: slug, storyTitle: story.title || '',
      read: false, createdAt: Date.now(),
    };
    const r = await fetch(`${DB_URL}/library_notifications/${fid}.json?access_token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`notification POST failed for ${fid}: HTTP ${r.status}`);
  }
  return followers.length;
}

/** The extra fields that must not be allowed to travel separately from the cover. */
function extraFields({ pending, held }) {
  const extra = {};
  if (pending !== null) {
    extra.descriptor = pending;
    extra.descriptorPending = null;
  }
  if (held) {
    extra.published = true;
    extra.coverHold = null;
  }
  return extra;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const APPLY = !!args.apply;
  const CHECK = !!args.check;
  const only = args.slug ? String(args.slug) : null;

  // ── THE DESIGN GATE ────────────────────────────────────────────────────────────────────
  // Checked BEFORE anything is read or rendered for real, and only when writing. A plan or a
  // --check is allowed to run against a changed renderer — that is exactly how you find out
  // what a design change would do. Writing is not. See design-lock.mjs.
  if (APPLY) {
    const lock = checkLock();
    if (!lock.ok) { console.error(lockFailureMessage(lock)); process.exit(3); }
    console.log(`design lock OK — ${Object.keys(lock.now).length} probes unchanged\n`);
  }

  let stories = await fetchStories();
  if (only) {
    stories = stories.filter((s) => s.slug === only);
    if (!stories.length) { console.error(`no published or held story with slug: ${only}`); process.exit(2); }
  }

  // Series is out of scope BY RULING — see store.mjs and CLAUDE.md. Asserted every run.
  assertStoryScope(SOURCE_NODE, stories);
  const nameless = stories.filter((s) => !s.slug || !String(s.story.title ?? '').trim());
  if (nameless.length) {
    console.error(`REFUSED — ${nameless.length} record(s) without a slug or a title: ${nameless.map((s) => s.slug).join(', ')}`);
    process.exit(4);
  }

  console.log(
    `${APPLY ? 'APPLYING' : CHECK ? 'CHECK' : 'PLAN'} — ${stories.length} record(s) in scope ` +
    `(${stories.filter((s) => s.held).length} held for a cover)\n`,
  );

  let bucket, token;
  if (APPLY) {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getStorage } = await import('firebase-admin/storage');
    const svc = JSON.parse(readFileSync(process.env.COVERS_SERVICE_ACCOUNT || join(ROOT, 'serviceAccountKey.json'), 'utf8'));
    initializeApp({ credential: cert(svc), storageBucket: BUCKET });
    bucket = getStorage().bucket();
    token = await accessToken(svc);
  }

  let current = 0, flipped = 0, failed = 0;
  const stale = [];

  for (const entry of stories) {
    let a;
    try {
      a = assess(entry);
    } catch (e) {
      failed++;
      console.log(`✗ ${entry.slug} — render failed: ${e.message}`);
      continue;
    }
    if (!a.stale) { current++; continue; }
    stale.push(a);
    if (!APPLY) {
      console.log(`· ${a.slug.padEnd(46)} ${a.reasons.join(', ')}`);
      continue;
    }
    try {
      const { sizes, hash } = await deriveFrom(a.png);
      const urls = await uploadCoverSet(bucket, a.dir, a.png, sizes);
      // ── THE FLIP: ONE ATOMIC PATCH, TWO NODES ──────────────────────────────────────────
      // Six fields — cover, coverSizes.w360, coverSizes.w720, coverHash, and the whole
      // re-projected cms_stories_index record — plus whatever must not travel without them.
      await rtdbPatch(token, coverFlipPaths(a.slug, a.story, { ...urls, coverHash: hash }, extraFields(a)));
      flipped++;
      console.log(
        `✓ ${a.slug.padEnd(46)} ${a.plan.livery.key.padEnd(10)} ${a.plan.title.size}px×${a.plan.title.lines.length}` +
        `  ${sha12(a.png)}${a.pending !== null ? '  +descriptor' : ''}${a.held ? '  PUBLISHED' : ''}`,
      );
      if (a.held) {
        try {
          const n = await notifyFollowers(token, a.slug, { ...a.story, ...extraFields(a) });
          if (n) console.log(`  ↳ notified ${n} follower(s)`);
        } catch (e) {
          console.log(`  ⚠ ${a.slug} is live and correct, but follower notifications failed: ${e.message}`);
        }
      }
      await sleep(DELAY_MS);
    } catch (e) {
      failed++;
      console.log(`✗ ${a.slug} — ${e.message}`);
    }
  }

  console.log('\n── SUMMARY ────────────────────────────────────────────');
  console.log(`  already current   ${current}`);
  console.log(`  ${APPLY ? 'flipped          ' : 'stale            '} ${APPLY ? flipped : stale.length}`);
  console.log(`  failed            ${failed}`);
  if (!APPLY) console.log('\n  NOTHING WAS WRITTEN.');

  // A failure is always an exit code, in every mode: this runs unattended, and a red run is
  // the only way anyone finds out. --check additionally fails on staleness, which is what
  // makes it usable as a gate on a pull request.
  if (failed) process.exit(1);
  if (CHECK && stale.length) {
    console.log(`\n  ${stale.length} record(s) are stale. Run with --apply.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
