// ═══════════════════════════════════════════════════════════════════════════════════════════
// SCHEDULED WITHDRAWALS — the thing that makes a fixed-term licence take effect by itself.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/bookstore/withdrawals.mjs            # report what is due. Writes nothing.
//   node scripts/bookstore/withdrawals.mjs --apply    # flip the due ones, then summon a deploy.
//
// ── WHY THIS EXISTS, AND WHY IT CANNOT LIVE ANYWHERE ELSE ──────────────────────────────────
//
// A licence to distribute for a fixed term is a real deal, and the shop must be able to honour
// one that ENDS. The CMS lets a founder set the date once. What it cannot do is make the date
// arrive.
//
// next.config.mjs sets `output: 'export'`. Every /bookstore/{slug} page, the shelf, the genre
// counts and the curated sections are FILES, enumerated from live RTDB at build time and then
// served from a CDN. NOTHING about a static file consults a clock. A licence-end date passing
// at midnight changes precisely nothing a reader can see: they keep getting the shelf the last
// deploy rendered, with the withdrawn book on it, for as long as no build runs.
//
// So a date-based withdrawal needs TWO acts, and both of them are here:
//
//   1. FLIP THE RECORD.  status → 'withdrawn', withdrawal.appliedAt → now. One atomic PATCH.
//   2. SUMMON A DEPLOY.  POST the Cloudflare Pages deploy hook, so the export is rebuilt
//                        without the title.
//
// Neither can happen in the browser (nobody is looking), in a Pages Function (nothing invokes
// one on a schedule) or in the publish path (the date is in the future when it is set). It has
// to be a scheduled job on a runner, and it is: .github/workflows/withdrawals.yml.
//
// ── THE LATENCY, STATED HONESTLY ───────────────────────────────────────────────────────────
//
// GitHub's schedule is best-effort with a five-minute floor. This runs HOURLY, and a Cloudflare
// build takes about two minutes. So a book whose licence ends on 31 March leaves the shop
// within roughly an hour of the end of that day — NOT at the stroke of midnight. If a contract
// ever requires the minute, this is the thing that would have to change, and no amount of
// front-end work would help.
//
// ── WHY IT FIRES THE HOOK DIRECTLY AND NOT /api/rebuild ────────────────────────────────────
//
// /api/rebuild authorises by verifying a FOUNDER'S Firebase ID token — see the AUTHORISATION
// block in functions/api/rebuild.js. A cron runner has no founder signed in and cannot get one
// without storing a founder credential, which would be a worse secret than the hook. So this
// job holds the hook itself, from a GitHub Actions secret, exactly as the Pages Function holds
// it from a Cloudflare environment variable.
//
// ⚠ THAT IS NOT A LOOPHOLE IN R19.7's RULE. The rule is that a hook URL never reaches a
// BROWSER — nothing under app/ may hold or read one, because Next inlines it into the bundle
// and possession of a deploy hook is authorisation. A server-side runner holding one from a
// secret store is the same shape as the worker, and tests/ci/deploy-hook-secrecy.test.mjs
// scans app/ and out/, neither of which this file is in.
//
// The URL is never printed. `fireDeployHook` returns a status and nothing else.
//
// ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────────────────
//
// It never deletes anything, never touches Storage, and never reads or writes
// bookstore_purchases. A scheduled withdrawal is the SHOP's act: the title leaves the shelf and
// every reader who bought it keeps it, exactly as an immediate withdrawal does. Ruling 2 is not
// negotiable on a timer either.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DB_URL, accessToken, rtdbPatch } from '../covers/store.mjs';
import { WITHDRAWAL_KEY, withdrawalDue, applyWithdrawalBlock } from '../../app/lib/bookstore/withdrawal.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TITLES_PATH = 'bookstore_titles';

const HOOK_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    // For a dry run against a date that has not arrived yet, when proving the wiring.
    now: (() => {
      const i = argv.indexOf('--now');
      if (i === -1) return Date.now();
      const v = Number(argv[i + 1]);
      return Number.isFinite(v) ? v : Date.now();
    })(),
  };
}

async function readTitles(token) {
  const res = await fetch(`${DB_URL}/${TITLES_PATH}.json?access_token=${token}`);
  if (!res.ok) throw new Error(`RTDB GET ${TITLES_PATH} failed: HTTP ${res.status} ${await res.text()}`);
  const raw = (await res.json()) || {};
  return Object.entries(raw).map(([id, doc]) => ({ id, ...(doc || {}) }));
}

/**
 * POST the deploy hook. Returns a status; NEVER the URL, and never throws.
 *
 * An unconfigured hook is LOUD but not fatal to the flip. The records are already correct, and
 * a job that failed the whole run because a deploy could not be summoned would leave the flip
 * to be re-detected on the next hour anyway — while hiding the fact that the writes worked.
 */
async function fireDeployHook(url) {
  if (!url) {
    console.error('::error::BOOKSTORE_DEPLOY_HOOK_URL is not set — the records were flipped but the shop was NOT rebuilt.');
    return { ok: false, status: null };
  }
  try {
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`::error::deploy hook refused: HTTP ${res.status}. The records were flipped but the shop was NOT rebuilt.`);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    // The message, not the URL: a fetch error can embed the request target.
    console.error(`::error::deploy hook unreachable (${e?.name || 'Error'}). The records were flipped but the shop was NOT rebuilt.`);
    return { ok: false, status: null };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const svcPath = process.env.BOOKSTORE_SERVICE_ACCOUNT || join(ROOT, 'serviceAccountKey.json');
  const svc = JSON.parse(readFileSync(svcPath, 'utf8'));
  const token = await accessToken(svc);

  const titles = await readTitles(token);
  const due = titles.filter((t) => withdrawalDue(t, args.now));

  const scheduled = titles.filter((t) => t.status === 'published' && t[WITHDRAWAL_KEY]?.scheduledFor);
  console.log(`scheduled withdrawals on file: ${scheduled.length}`);
  for (const t of scheduled) {
    const when = new Date(t[WITHDRAWAL_KEY].scheduledFor).toISOString();
    console.log(`  ${withdrawalDue(t, args.now) ? 'DUE  ' : '     '} ${t.id.padEnd(32)} ${when}`);
  }

  if (!due.length) {
    console.log('nothing due. No writes, no deploy.');
    return;
  }

  if (!args.apply) {
    console.log(`\n  ${due.length} title(s) are due. Run with --apply.`);
    return;
  }

  // ONE PATCH FOR ALL OF THEM. Two licences ending on the same night must not produce a shop
  // that has dropped one and not the other, and a multi-path update at the root replaces each
  // named path and leaves every sibling alone — the same shape patchPurchase() uses.
  const updates = {};
  for (const t of due) {
    updates[`${TITLES_PATH}/${t.id}/status`] = 'withdrawn';
    updates[`${TITLES_PATH}/${t.id}/${WITHDRAWAL_KEY}`] = applyWithdrawalBlock({
      existing: t[WITHDRAWAL_KEY],
      previousStatus: t.status,
      by: 'scheduled',
      nowMs: args.now,
    });
    updates[`${TITLES_PATH}/${t.id}/updatedAt`] = args.now;
  }

  // ⚠ THE CURATOR'S CLAIMS ARE NOT PRUNED, and that is the same rule an immediate withdrawal
  // follows. A withdrawal is reversible; resolveSections() already drops a claimed slug that is
  // not in the published catalogue, silently, so the title is out of every section the instant
  // this PATCH lands. Pruning as well would destroy the curator's choice on an act that
  // advertises itself as undoable. See pruneClaims() in app/lib/bookstore/withdrawal.js.
  await rtdbPatch(token, updates);
  console.log(`\n✓ withdrew ${due.length} title(s): ${due.map((t) => t.id).join(', ')}`);

  const verdict = await fireDeployHook(process.env.BOOKSTORE_DEPLOY_HOOK_URL);
  console.log(verdict.ok
    ? '✓ deploy summoned — the shop will be rebuilt without them in about two minutes.'
    : '✗ deploy NOT summoned. Retry from the Cloudflare Pages dashboard.');
}

main().catch((e) => {
  console.error('::error::scheduled withdrawals failed:', e?.message || e);
  process.exit(1);
});
