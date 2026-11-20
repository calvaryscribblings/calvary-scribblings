#!/usr/bin/env node
// W7 — LAUNCH CHECKS. One command that says, at midnight, whether every switch worked.
//
//   node scripts/launch-check.mjs            print the table
//   node scripts/launch-check.mjs --email    …and mail it to Ikenna (via /api/ops/launch-email)
//   node scripts/launch-check.mjs --email-if-red   …only when a row is red (the daily run, ALERTS-1)
//   node scripts/launch-check.mjs --json     the rows as JSON
//   --since <ISO>                            the "since the last check" instant (default: the last
//                                            occasion that was reported, from ops/launch_check; else the
//                                            previous launch-check workflow run; else 24h ago)
//   --slot "<cron>" --apply                  CLOCK-1.1: a scheduled or clock-dispatched run. The email is
//                                            claimed in ops/launch_check/slots/<London date-time> before it
//                                            goes, so a second run of the same occasion never sends it again.
//
// READ-ONLY against production, but for one thing: with --slot and --apply it claims the occasion's
// email in ops/launch_check (through the guard) before sending it. It reads with the Firebase Admin SDK, asks the live site the
// questions a signed-out reader would, and asks /api/ops/launch-status for the membership
// switches as BOOLEANS. The only thing it ever sends is the email.
//
// Each row is GREEN, RED, or NOT YET DUE (a switch whose date has not come — before the launch date the
// gate is off by design, and that is not a failure). Every row prints the evidence it read.
// The verdicts are pure functions of that evidence and the clock, so tests/ci/w7-launch-check
// can force each row green, red and not-yet-due without a network.
//
// Credentials, in order: LAUNCH_SERVICE_ACCOUNT (a path), FIREBASE_SA_KEY (the key file or
// base64 of it, the codespace), serviceAccountKey.json. The email is signed with the same key (see
// functions/api/ops/_opsAuth.js) — no Resend key lives outside the Pages project.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { GATE_ON_MS, gatingOn, freeUntilFor, servesAsReader, isFreeByPolicy, isSpotlight } from '../app/lib/storyAccess.js';
import { endingOf } from './check-built-gate.mjs';
import { LAUNCH_DATE_SHORT } from '../app/lib/launch.js';
import { dictionaryLookup, DICT_BASE, DICT_SOURCE } from '../app/lib/dictionary.js';
import { readServiceAccountFile, readSaKeySecret } from './security/service-account.mjs';
import { readOnlyDb, openGuard } from './safety/guard.mjs'; // SAFETY-1: reads read-only, enforced; the one claim goes through the guard
import { takeFn, settleFn, runIdOf, LEASE_MS } from './ops/once.mjs';
import { SCHEDULES as GATE_SCHEDULES, slotOf, slotKey } from './launch-check-gate.mjs';
import { P4_ARMED, DRAIN_STALE_MS } from '../app/lib/pushP4.js';
import { CLOCK_ARMED, CLOCK_HEARTBEAT_URL, judgeClockHeartbeat } from '../app/lib/clock.js';

export const SITE = process.env.LAUNCH_SITE || 'https://calvaryscribblings.co.uk';
export const GREEN = 'green';
export const RED = 'red';
export const NYD = 'not yet due';

const MIN = 60_000;
export const STALE = {
  publish: 40 * MIN,   // the scheduled-publish Worker ticks every 15 minutes
  scrub: 45 * MIN,     // the account scrub runs every 15 minutes
  push: 45 * MIN,      // the push announcer, once armed, every 15 minutes
  drain: DRAIN_STALE_MS, // P4-B1: the personal-push drain, once armed, every minute (5 min)
};

// ── London time ───────────────────────────────────────────────────────────────────────────
const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
export function londonParts(ms) {
  return Object.fromEntries(LONDON.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}
/** The most recent 00:00 Europe/London at or before `now`, as epoch ms. */
export function lastLondonMidnight(now) {
  const p = londonParts(now);
  const sinceMidnight = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + (now % 1000);
  return now - sinceMidnight;
}
export const fmt = (ms) => (Number.isFinite(ms) ? `${new Date(ms).toISOString().replace('.000', '')}` : 'never');
const ago = (ms, now) => (Number.isFinite(ms) ? `${Math.round((now - ms) / 60000)} min ago` : 'never');

// ── the verdicts (pure) ───────────────────────────────────────────────────────────────────
const row = (name, status, evidence) => ({ name, status, evidence });
const said = (r) => (r ? `${r.status ?? '?'} ${r.access ?? r.code ?? ''}${r.reason ? `/${r.reason}` : ''}` : 'no answer');

/**
 * FREE WEEK: signed-out /api/story for an archive story, this week's, a poem, and a Spotlight.
 *
 * SPOT-1: every Spotlight is free to everyone (isFreeByPolicy in app/lib/storyAccess.js), so the
 * row also asks about the newest one and expects full/spotlight. While nothing is filed as a
 * Spotlight it says so and stays out of the verdict: an empty subcategory is not a failure.
 */
export function judgeFreeWeek({ archive, thisWeek, poem, spotlight = null }, now) {
  const ev = [
    `archive "${archive?.slug ?? '—'}" → ${said(archive?.res)}`,
    `this week "${thisWeek?.slug ?? '(none published this week)'}" → ${thisWeek ? said(thisWeek.res) : '—'}`,
    `poem "${poem?.slug ?? '—'}" → ${said(poem?.res)}`,
    spotlight ? `spotlight "${spotlight.slug}" → ${said(spotlight.res)}` : 'spotlight (no story is filed as a Spotlight yet) → —',
  ].join('; ');
  const all = [archive, thisWeek, poem, spotlight].filter(Boolean);
  if (!archive || !poem) return row('Free week', RED, `could not pick the stories to ask about. ${ev}`);
  if (all.some((x) => !x.res || x.res.status !== 200)) return row('Free week', RED, ev);
  if (!gatingOn(now)) {
    // Before the switch every story must still read in full, as today. Anything else is the
    // gate open EARLY, and that is red.
    const early = all.some((x) => x.res.access !== 'full' || x.res.reason !== 'gating_off');
    return row('Free week', early ? RED : NYD, early ? `the gate is ON before ${LAUNCH_DATE_SHORT}. ${ev}` : `gating_off everywhere, as it should be before ${LAUNCH_DATE_SHORT}. ${ev}`);
  }
  const ok = archive.res.access === 'preview' && archive.res.reason === 'archive'
    && (!thisWeek || (thisWeek.res.access === 'full' && thisWeek.res.reason === 'free_week'))
    && poem.res.access === 'full' && poem.res.reason === 'poetry'
    && (!spotlight || (spotlight.res.access === 'full' && spotlight.res.reason === 'spotlight'));
  return row('Free week', ok ? GREEN : RED, ev);
}

/**
 * The stories the Free week row asks about, from the live index (newest first). The archive and
 * this-week samples are never free by policy, so neither is ever a poem or a Spotlight; news is
 * left out of both as it always was. Pure, so the choice is tested.
 */
export function pickFreeWeekSamples(index, now) {
  const prose = Object.entries(index || {}).map(([slug, r]) => ({ ...r, slug }))
    // SPOT-1.1: live NOW, not merely indexed. The index holds exactly the live stories today, but
    // a sample must never be a story /api/story would answer 404 for, so a future publishAt or
    // publishedAtMs is refused here too, whatever the index's rules become.
    .filter((r) => r.published !== false && !servesAsReader(r) && Number.isFinite(r.publishedAtMs) && r.publishedAtMs <= now
      && !(typeof r.publishAt === 'string' && Date.parse(r.publishAt) > now))
    .sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  const sample = (r) => !isFreeByPolicy(r) && r.category !== 'news' && freeUntilFor(r) !== null;
  return {
    archiveRec: prose.find((r) => sample(r) && freeUntilFor(r) < now) || null,
    weekRec: prose.find((r) => sample(r) && freeUntilFor(r) >= now) || null,
    poemRec: prose.find((r) => r.category === 'poetry') || null,
    spotRec: prose.find((r) => isSpotlight(r)) || null,
  };
}

/** STATIC PAGES (1): the live build ran after the latest London midnight. */
export function judgeRebuilt({ build }, now) {
  const midnight = lastLondonMidnight(now);
  if (!build || !Number.isFinite(build.builtAt)) return row('Rebuilt since midnight', RED, 'no /build.json on the live site — the build that serves it is older than W7, or the file is missing');
  const ev = `live build ${build.nextBuildId ?? '?'} (commit ${build.commit ?? '?'}) built ${fmt(build.builtAt)}; latest London midnight ${fmt(midnight)}`;
  return row('Rebuilt since midnight', build.builtAt >= midnight ? GREEN : RED, ev);
}

/** STATIC PAGES (2): an archive story's built HTML carries nothing beyond its preview. */
export function judgeArchiveHtml({ slug, htmlStatus, ending, found }, now) {
  if (!slug) return row('Archive page is preview-only', RED, 'no archive story to check');
  if (htmlStatus !== 200) return row('Archive page is preview-only', RED, `/stories/${slug} answered ${htmlStatus}`);
  if (!ending) return row('Archive page is preview-only', RED, `could not take a sample from beyond /stories/${slug}'s preview`);
  const ev = `/stories/${slug}: the ending "…${ending}" is ${found ? 'IN' : 'not in'} the built HTML`;
  if (!gatingOn(now)) return row('Archive page is preview-only', NYD, `${ev} (before ${LAUNCH_DATE_SHORT} the page carries the body, locked by its own script at the switch)`);
  return row('Archive page is preview-only', found ? RED : GREEN, ev);
}

/** SERIES: a Platinum-only instalment is refused signed out. */
export function judgeSeries({ instalmentId, res }, now) {
  if (!instalmentId) return row('Series', RED, 'no Platinum-only instalment found to ask about');
  const ev = `signed-out /api/series/stream for ${instalmentId} → ${res ? `${res.status} ${res.code || (res.url ? 'a stream URL' : '')}` : 'no answer'}`;
  if (!res) return row('Series', RED, ev);
  if (!gatingOn(now)) {
    return row('Series', res.status === 200 ? NYD : RED, res.status === 200 ? `${ev} — open to all before ${LAUNCH_DATE_SHORT}, as it should be` : `${ev} — refused BEFORE the switch`);
  }
  return row('Series', res.status === 401 || res.status === 403 ? GREEN : RED, ev);
}

/** BOOK STORE: the curtain lifts by date, and the catalogue renders. */
export function judgeBookStore({ pageStatus, publishedTitles }, now) {
  const ev = `/bookstore → ${pageStatus ?? 'no answer'}; ${publishedTitles ?? '?'} published titles`;
  if (now < GATE_ON_MS) return row('Book Store', NYD, `the curtain lifts at ${LAUNCH_DATE_SHORT} 00:00 London (by date, no deploy). ${ev}`);
  return row('Book Store', pageStatus === 200 && publishedTitles > 0 ? GREEN : RED, ev);
}

/** MEMBERSHIPS: the switches, as booleans. Never a key. */
export function judgeMemberships({ status, httpStatus }, now) {
  if (!status) return row('Memberships', RED, `/api/ops/launch-status answered ${httpStatus ?? 'nothing'}`);
  const s = status;
  const flags = {
    'sale flag': s.saleFlagOn,
    'Stripe live key': s.stripe?.liveKey, 'Stripe live prices': s.stripe?.livePricesConfigured,
    'Stripe webhook secret': s.stripe?.membershipWebhookSecretSet,
    'Paystack live key': s.paystack?.liveKey, 'Paystack live plans': s.paystack?.livePlansConfigured,
    'Paystack webhook secret': s.paystack?.webhookSecretSet,
  };
  const ev = Object.entries(flags).map(([k, v]) => `${k} ${v === true ? 'yes' : 'NO'}`).join(', ');
  if (now < GATE_ON_MS) return row('Memberships', NYD, `on sale from ${LAUNCH_DATE_SHORT}. ${ev}`);
  return row('Memberships', Object.values(flags).every((v) => v === true) ? GREEN : RED, ev);
}

/** The push announcer is armed when its workflow carries an uncommented cron line — the switch. */
export const pushScheduleArmed = (yml) => /^\s*-\s*cron:/m.test(String(yml || ''));

/** JOBS: one heartbeat. `armed` false means the job is not live yet (not yet due). */
export function judgeHeartbeat(name, { lastAt, staleMs, armed = true, unarmed = 'not armed yet (its cron is commented out) — nothing is expected' }, now) {
  if (!armed) return row(name, NYD, unarmed);
  const ev = `last ran ${fmt(lastAt)} (${ago(lastAt, now)}); stale after ${Math.round(staleMs / 60000)} min`;
  return row(name, Number.isFinite(lastAt) && now - lastAt <= staleMs ? GREEN : RED, ev);
}

/** CLOCK-1: the clock that dispatches the scheduled workflows. Its heartbeat is the Worker's own
 *  GET /heartbeat (app/lib/clock.js); `armed` false until the go-live round. */
export function judgeClock({ hb, armed }, now) {
  const name = 'Job: clock (workflow dispatch)';
  if (!armed) return row(name, NYD, 'not armed yet (the go-live round uploads the Worker and turns on its cron) — nothing is expected');
  const { ok, evidence } = judgeClockHeartbeat(hb, now);
  return row(name, ok ? GREEN : RED, evidence);
}

/** SIGNALS: nothing new in ops/money_failures or ops/publish_skips since the last check. */
export function judgeSignals({ moneyFailures, publishSkips, since }) {
  const newMoney = Object.entries(moneyFailures || {})
    .filter(([, v]) => v && v.resolved !== true && Number(v.lastAt ?? v.firstAt ?? 0) > since).map(([k]) => k);
  const newSkips = Object.entries(publishSkips || {})
    .filter(([, v]) => v && Number(v.at ?? 0) > since).map(([k]) => k);
  // W12: money-failure KEYS are never printed — they can carry a reader's uid or a provider
  // reference, and this row lands in a public Actions log. The count, and where to look.
  const ev = `since ${fmt(since)}: ${newMoney.length} new unresolved money failure(s)${newMoney.length ? ' (see ops/money_failures)' : ''}, `
    + `${newSkips.length} new publish skip(s)${newSkips.length ? ` (${newSkips.slice(0, 3).join(', ')})` : ''}`;
  return row('Signals', newMoney.length || newSkips.length ? RED : GREEN, ev);
}

// ── the table ─────────────────────────────────────────────────────────────────────────────
// W23 — the Reading Room's dictionary. For weeks every Define was the calm miss and nobody saw an
// error, because the miss IS calm by design. So the house dictionary answers to this row instead:
// the live shard, read as a reader's browser reads it, must answer "serendipity" with a sense.
// ── ALERTS-1: COVERS HEALTH (UNRELEASED-1's proposal, ruling 261) ─────────────────────────────
// covers:verify pinned to live data and failed every run from 30 Oct; reconcile never ran and 26
// held stories waited for covers for over a day with nobody seeing it. Red when either is true:
//   · the last SUCCESSFUL scheduled reconcile is more than an hour old (it runs every 15 minutes);
//   · any story held for a cover goes live within 72 hours (or is already overdue).
// Evidence is counts and times only, never a slug: Actions logs are public, and an unreleased
// story's slug is its title (W12).
export const COVERS_RECONCILE_STALE_MS = 60 * MIN;
export const COVERS_HELD_HORIZON_MS = 72 * 60 * MIN;

/** Pure. The held stories that go live within the horizon (overdue included): { count, earliestMs }. */
export function heldGoingLive(stories, now) {
  const due = Object.values(stories || {})
    .filter((s) => s && s.coverHold === true && s.published === false && !s.hiddenAt)
    .map((s) => Date.parse(s.publishAt))
    .filter((t) => Number.isFinite(t) && t <= now + COVERS_HELD_HORIZON_MS)
    .sort((a, b) => a - b);
  return { count: due.length, earliestMs: due.length ? due[0] : NaN };
}

export function judgeCovers({ lastReconcileOkAt, held }, now) {
  const age = Number.isFinite(lastReconcileOkAt) ? Math.round((now - lastReconcileOkAt) / MIN) : null;
  const stale = age === null || now - lastReconcileOkAt > COVERS_RECONCILE_STALE_MS;
  const n = held?.count ?? 0;
  const ev = [
    `last successful reconcile ${fmt(lastReconcileOkAt)}${age === null ? '' : ` (${age} min ago)`}`,
    n ? `${n} held for a cover and going live within 72 h, the first at ${fmt(held.earliestMs)}` : 'none held for a cover within 72 h',
  ].join('; ');
  return row('Covers', stale || n > 0 ? RED : GREEN, ev);
}

// ── WHICH covers RUNS COUNT AS A RECONCILE ─────────────────────────────────────────────
//
// CLOCK-5. This used to read only `event=schedule` runs. Since CLOCK-1 the clock dispatches covers
// every 15 minutes (apply true) and GitHub's own schedule fires only some of the time, so the row
// read 5–8 hours stale on 17, 18 and 19 Nov while the library reconciled on time, and the daily
// check emailed red for it each day.
//
// A run counts when its `reconcile covers` job succeeded AND it wrote over the whole library:
//   · GitHub's schedule (always --apply, never a slug);
//   · a dispatch, the clock's or a person's, with apply ticked and no slug.
// A dry run never counts; it writes nothing. Nor does a one-title run: it reconciles one story and
// says nothing about the rest of the library, which is what this row judges.
// A dispatch's inputs are not in the runs list, so covers.yml names each run by them (its
// `run-name`), and that title is read here. tests/ci/clock-5.test.mjs evaluates the workflow's own
// expression and holds the two together. A dispatch from before the run-name has the bare title
// "covers" and does not count: unknown is not a write.
export const COVERS_WRITE_TITLE = 'covers · apply · library';
export function reconcileWrote(run) {
  if (!run) return false;
  if (run.event === 'schedule') return true;
  if (run.event === 'workflow_dispatch') return run.display_title === COVERS_WRITE_TITLE;
  return false;
}

/**
 * The newest qualifying run whose `reconcile covers` job succeeded: its completion time (ms), or NaN.
 * `runs` newest first, as the runs list gives them; `jobsOf(run)` resolves to that run's jobs.
 * Looks at no more than `maxLookups` runs' jobs.
 */
export async function lastReconcileOkFrom(runs, jobsOf, { maxLookups = 12 } = {}) {
  let looked = 0;
  for (const run of runs || []) {
    if (!reconcileWrote(run)) continue;
    if (looked++ >= maxLookups) break;
    const jobs = (await jobsOf(run)) || [];
    const rec = jobs.find((j) => j.name === 'reconcile covers');
    if (rec && rec.conclusion === 'success') return Date.parse(rec.completed_at || run.updated_at);
  }
  return NaN;
}

/** When the covers workflow last reconciled the library successfully (any run that wrote), from Actions. */
async function lastReconcileOk() {
  const token = process.env.GITHUB_TOKEN || (() => { try { return execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })();
  const repo = process.env.GITHUB_REPOSITORY || 'calvaryscribblings/calvary-scribblings';
  if (!token) return NaN;
  const gh = (path) => fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const runs = (await gh('actions/workflows/covers.yml/runs?status=completed&per_page=50'))?.workflow_runs || [];
  return lastReconcileOkFrom(runs, async (run) => (await gh(`actions/runs/${run.id}/jobs`))?.jobs || []);
}

export const DICTIONARY_PROBE = 'serendipity';
export function judgeDictionary({ entry, error, ms }) {
  const t = Number.isFinite(ms) ? ` in ${ms} ms` : '';
  if (error) return row('Dictionary', RED, `${DICT_BASE}: "${DICTIONARY_PROBE}" could not be read${t} (${error})`);
  const sense = entry && Array.isArray(entry.senses) && entry.senses[0];
  if (!sense || !sense.definition || entry.source !== DICT_SOURCE) {
    return row('Dictionary', RED, `${DICT_BASE}: "${DICTIONARY_PROBE}" found no sense${t} — every Define is a miss`);
  }
  return row('Dictionary', GREEN, `${DICT_BASE}: "${DICTIONARY_PROBE}" → ${sense.partOfSpeech || '?'}, "${sense.definition.slice(0, 48)}…"${t}`);
}

export function summarise(rows) {
  const red = rows.filter((r) => r.status === RED).length;
  return { red, subject: red ? `[launch] ${red} red` : '[launch] all green' };
}
const MARK = { [GREEN]: 'GREEN', [RED]: 'RED  ', [NYD]: 'not yet due' };
export function renderText(rows, now) {
  const w = Math.max(...rows.map((r) => r.name.length));
  return [`Launch check — ${fmt(now)} (London ${londonParts(now).weekday} ${londonParts(now).hour}:${londonParts(now).minute})`, '',
    ...rows.map((r) => `${MARK[r.status].padEnd(11)}  ${r.name.padEnd(w)}  ${r.evidence}`)].join('\n');
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderHtml(rows, now) {
  const colour = { [GREEN]: '#1a7f4b', [RED]: '#b42318', [NYD]: '#6b6b80' };
  return `<p style="font-family:Georgia,serif">Launch check — ${esc(fmt(now))}</p>`
    + '<table cellpadding="6" style="border-collapse:collapse;font-family:Georgia,serif;font-size:14px">'
    + rows.map((r) => `<tr><td style="color:${colour[r.status]};font-weight:bold;white-space:nowrap">${esc(MARK[r.status].trim())}</td>`
      + `<td style="white-space:nowrap">${esc(r.name)}</td><td style="color:#333">${esc(r.evidence)}</td></tr>`).join('')
    + '</table>';
}

// ── gathering (I/O) ───────────────────────────────────────────────────────────────────────
function serviceAccount() {
  // Parsed by service-account.mjs: a failed JSON.parse prints its whole input (SECURITY-R1).
  if (process.env.LAUNCH_SERVICE_ACCOUNT) return readServiceAccountFile(process.env.LAUNCH_SERVICE_ACCOUNT);
  if (process.env.FIREBASE_SA_KEY) return readSaKeySecret(process.env.FIREBASE_SA_KEY);
  return readServiceAccountFile('serviceAccountKey.json');
}

/** The launch check's own short-lived token for /api/ops/* (verified by functions/api/ops/_opsAuth.js). */
export function opsToken(sa, nowS = Math.floor(Date.now() / 1000)) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id });
  const body = enc({ iss: sa.client_email, sub: sa.client_email, aud: 'calvary-ops', iat: nowS, exp: nowS + 300 });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

async function askStory(slug) {
  try {
    const r = await fetch(`${SITE}/api/story`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, client: 'launch-check' }) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, access: j.access, reason: j.reason, code: j.code, body: j };
  } catch (e) { return null; }
}

async function previousRunStart() {
  const token = process.env.GITHUB_TOKEN || (() => { try { return execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })();
  const repo = process.env.GITHUB_REPOSITORY || 'calvaryscribblings/calvary-scribblings';
  if (!token) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/launch-check.yml/runs?per_page=10`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const runs = (await r.json()).workflow_runs || [];
    const mine = String(process.env.GITHUB_RUN_ID || '');
    const prev = runs.find((x) => String(x.id) !== mine && x.status === 'completed');
    return prev ? Date.parse(prev.run_started_at || prev.created_at) : null;
  } catch { return null; }
}

export async function gather(now = Date.now(), { since: sinceArg } = {}) {
  const sa = serviceAccount();
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
  const db = readOnlyDb(getDatabase());
  const val = async (p) => (await db.ref(p).get()).val();

  // Pick the stories from the live index: the newest archive prose story, the newest of this
  // week's, the newest poem and the newest Spotlight. Reader-mode stories are EPUBs and are not
  // asked about.
  const index = (await val('cms_stories_index')) || {};
  const { archiveRec, weekRec, poemRec, spotRec } = pickFreeWeekSamples(index, now);
  const [aRes, wRes, pRes, sRes] = await Promise.all([archiveRec, weekRec, poemRec, spotRec].map((r) => (r ? askStory(r.slug) : null)));
  const freeWeek = {
    archive: archiveRec ? { slug: archiveRec.slug, res: aRes } : null,
    thisWeek: weekRec ? { slug: weekRec.slug, res: wRes } : null,
    poem: poemRec ? { slug: poemRec.slug, res: pRes } : null,
    spotlight: spotRec ? { slug: spotRec.slug, res: sRes } : null,
  };

  const build = await fetch(`${SITE}/build.json?t=${now}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  let archiveHtml = { slug: archiveRec?.slug ?? null };
  if (archiveRec) {
    const body = await val(`story_bodies/${archiveRec.slug}/content`);
    const ending = body ? endingOf(body, index[archiveRec.slug] || {}) : null;
    const res = await fetch(`${SITE}/stories/${archiveRec.slug}`).catch(() => null);
    const html = res && res.ok ? await res.text() : '';
    // The built HTML escapes quotes and apostrophes; compare letters and spaces only.
    const flat = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');
    archiveHtml = { slug: archiveRec.slug, htmlStatus: res?.status ?? null, ending, found: !!ending && flat(html).includes(flat(ending).trim()) };
  }

  const instalments = (await val('series_instalments')) || {};
  const platinumId = Object.entries(instalments)
    .filter(([, r]) => r && r.status === 'published' && r.freeForGold === false && Number(r.releaseAtMs) <= now)
    .sort(([, a], [, b]) => a.ordinal - b.ordinal).map(([id]) => id)[0] || null;
  let seriesRes = null;
  if (platinumId) {
    try {
      const r = await fetch(`${SITE}/api/series/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instalmentId: platinumId }) });
      const j = await r.json().catch(() => ({}));
      seriesRes = { status: r.status, code: j.code, url: !!j.url };
    } catch { /* no answer */ }
  }

  const titles = (await val('bookstore_titles')) || {};
  const publishedTitles = Object.values(titles).filter((t) => t && t.status === 'published').length;
  const bookPage = await fetch(`${SITE}/bookstore`).then((r) => r.status).catch(() => null);

  let membership = { status: null, httpStatus: null };
  try {
    const r = await fetch(`${SITE}/api/ops/launch-status`, { headers: { Authorization: `Bearer ${opsToken(sa)}` } });
    membership = { httpStatus: r.status, status: r.ok ? await r.json() : null };
  } catch { /* no answer */ }

  const publishHb = await val('ops/publish_heartbeat');
  const scrubHb = await val('ops/account_scrub');
  const pushHb = await val('ops/push_announcer');
  const drainHb = await val('ops/push_drain/lastRunAt');
  // CLOCK-1: a GET of the Worker's public heartbeat, once armed. Times and a status code only.
  let clockHb = null;
  if (CLOCK_ARMED && CLOCK_HEARTBEAT_URL) {
    try {
      const r = await fetch(CLOCK_HEARTBEAT_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      clockHb = r.ok ? await r.json() : null;
    } catch { /* unreadable: judged red */ }
  }
  let pushArmed = false;
  try { pushArmed = pushScheduleArmed(readFileSync('.github/workflows/push-announce.yml', 'utf8')); } catch { /* treated as not armed */ }

  // The dictionary, from the live site, with a fresh cache and a bound on the wait.
  let dictionary;
  {
    const t0 = Date.now();
    try {
      const entry = await Promise.race([
        dictionaryLookup(DICTIONARY_PROBE, { base: `${SITE}${DICT_BASE}`, fetchImpl: (u) => fetch(u, { cache: 'no-store' }), cache: new Map() }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('no answer in 10 s')), 10_000)),
      ]);
      dictionary = { entry, ms: Date.now() - t0 };
    } catch (e) { dictionary = { error: String(e.message || e).slice(0, 80), ms: Date.now() - t0 }; }
  }

  const since = Number.isFinite(sinceArg) ? sinceArg
    : (lastReportedAt(await val(LEDGER), now) ?? (await previousRunStart()) ?? now - 24 * 3600_000);
  const signals = { moneyFailures: await val('ops/money_failures'), publishSkips: await val('ops/publish_skips'), since };

  const covers = { lastReconcileOkAt: await lastReconcileOk(), held: heldGoingLive(await val('cms_stories'), now) };

  return {
    covers,
    freeWeek, build, archiveHtml, series: { instalmentId: platinumId, res: seriesRes },
    bookStore: { pageStatus: bookPage, publishedTitles }, membership,
    jobs: {
      publish: { lastAt: Number(publishHb?.lastTickAt) || NaN },
      scrub: { lastAt: Number(scrubHb?.lastRunAt) || NaN },
      push: { lastAt: Number(pushHb?.lastRunAt) || NaN, armed: pushArmed },
      drain: { lastAt: Number(drainHb) || NaN, armed: P4_ARMED },
      clock: { hb: clockHb, armed: CLOCK_ARMED },
    },
    signals,
    dictionary,
    sa,
  };
}

export function judgeAll(g, now) {
  return [
    judgeFreeWeek(g.freeWeek, now),
    judgeRebuilt({ build: g.build }, now),
    judgeArchiveHtml(g.archiveHtml, now),
    judgeSeries(g.series, now),
    judgeBookStore(g.bookStore, now),
    judgeMemberships(g.membership, now),
    judgeHeartbeat('Job: scheduled publish', { lastAt: g.jobs.publish.lastAt, staleMs: STALE.publish }, now),
    judgeHeartbeat('Job: account scrub', { lastAt: g.jobs.scrub.lastAt, staleMs: STALE.scrub }, now),
    judgeHeartbeat('Job: push announcer', { lastAt: g.jobs.push.lastAt, staleMs: STALE.push, armed: g.jobs.push.armed }, now),
    // P4-B1: armed at switch-on (P4_ARMED in app/lib/pushP4.js, flipped with the Worker's cron).
    judgeHeartbeat('Job: personal-push drain', { lastAt: g.jobs.drain?.lastAt, staleMs: STALE.drain, armed: g.jobs.drain?.armed === true, unarmed: 'not armed yet (switch-on adds the Worker\'s cron) — nothing is expected' }, now),
    judgeClock(g.jobs.clock || { armed: false }, now),
    judgeSignals(g.signals),
    judgeDictionary(g.dictionary),
    judgeCovers(g.covers, now),
  ];
}

// ── CLOCK-1.1: ONE EMAIL PER OCCASION ─────────────────────────────────────────────────────────
// The clock dispatches this workflow on time and GitHub's schedule still runs it too, often hours
// late. Each London occasion (the Monday 00:10, the daily 08:05) is a SLOT, keyed by its London date
// and time (scripts/launch-check-gate.mjs slotKey). Before an email goes, the run claims the slot:
//   · claimed → sent. A second run finds `sent` and does not send.
//   · claimed → failed (the send threw). A later run of the same slot may claim it and send.
//   · a daily run that is all green sends nothing and records `quiet`: the occasion was judged.
//   · a claim left `claimed` by a run that died is free again after LEASE_MS (the job times out first).
// "Since the last check" is the last slot that was judged and reported (sent or quiet), so a second
// run that stood down never narrows the next day's window.
export const LEDGER = 'ops/launch_check/slots';

/** The latest judged-and-reported slot before `now` (sent or quiet), or null. */
export function lastReportedAt(slots, now) {
  let best = null;
  for (const v of Object.values(slots || {})) {
    const t = Number(v?.checkedAt);
    if ((v?.state === 'sent' || v?.state === 'quiet') && Number.isFinite(t) && t < now && (best === null || t > best)) best = t;
  }
  return best;
}

/**
 * Report one occasion once. `db` is the guarded handle (ref(path).transaction). `wantEmail` is this
 * run's verdict (always on a Monday, only when red on a daily). Returns
 *   { state: 'sent' | 'quiet' | 'stood-down', prior? }
 * and throws if the send fails (after recording `failed`, so a later run may retry).
 */
export async function reportOnce(db, { key, now, runId, wantEmail, send, log = () => {}, leaseMs = LEASE_MS }) {
  const ref = db.ref(`${LEDGER}/${key}`);
  const record = wantEmail
    ? { state: 'claimed', at: now, runId, checkedAt: now }
    : { state: 'quiet', at: now, runId, checkedAt: now };
  const res = await ref.transaction(takeFn(record, now, { leaseMs }));
  if (!res.committed) {
    const prior = res.snapshot?.val?.()?.state ?? 'unknown';
    log(`[once] ${key}: already ${prior} by another run — this run sends nothing`);
    return { state: 'stood-down', prior };
  }
  if (!wantEmail) { log(`[once] ${key}: all green, nothing to send — recorded`); return { state: 'quiet' }; }
  try {
    const sent = await send();
    await ref.transaction(settleFn(runId, { state: 'sent', sentAt: Date.now() }));
    log(`[once] ${key}: sent`);
    return { state: 'sent', sent };
  } catch (e) {
    await ref.transaction(settleFn(runId, { state: 'failed', failedAt: Date.now() })).catch(() => {});
    throw e;
  }
}

async function email(sa, rows, now) {
  const { subject } = summarise(rows);
  const r = await fetch(`${SITE}/api/ops/launch-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${opsToken(sa)}` },
    body: JSON.stringify({ subject, text: renderText(rows, now), html: renderHtml(rows, now) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`the email was NOT sent: ${r.status} ${j.error || ''}`);
  return { subject, id: j.id };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const sinceIdx = args.indexOf('--since');
  const now = Date.now();
  const g = await gather(now, { since: sinceIdx >= 0 ? Date.parse(args[sinceIdx + 1]) : undefined });
  const rows = judgeAll(g, now);
  if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else console.log(renderText(rows, now));
  const { red, subject } = summarise(rows);
  console.log(`\n${subject}`);
  // ALERTS-1: --email sends the table whatever it says (Mondays, the launch day, a dispatch);
  // --email-if-red sends it only when something is red (the daily run).
  const wantEmail = args.includes('--email') || (args.includes('--email-if-red') && red);
  const slotIdx = args.indexOf('--slot');
  let stoodDown = false;
  if (slotIdx >= 0) {
    // CLOCK-1.1: a scheduled or clock-dispatched run. The cron must be one of the gate's.
    const cron = args[slotIdx + 1] || '';
    if (!GATE_SCHEDULES[cron]) { console.error('::error::--slot is not one of the launch check\'s crons'); process.exit(1); }
    const slot = slotOf(cron, now);
    if (slot === null) { console.error('::error::that cron has not fired in the last 48 hours'); process.exit(1); }
    const guard = await openGuard('launch-check', { apply: args.includes('--apply') });
    if (!guard.apply) {
      console.log(`[once] ${slotKey(slot)}: DRY RUN (no --apply) — nothing claimed, nothing sent`);
    } else {
      const { getDatabase } = await import('firebase-admin/database');
      const out = await reportOnce(guard.adminDb(getDatabase()), {
        key: slotKey(slot), now, runId: runIdOf(process.env, now), wantEmail,
        send: async () => { const sent = await email(g.sa, rows, now); console.log(`emailed: ${sent.subject} (${sent.id})`); return sent; },
        log: (l) => console.log(l),
      });
      stoodDown = out.state === 'stood-down' && out.prior === 'sent';
    }
  } else if (wantEmail) {
    const sent = await email(g.sa, rows, now);
    console.log(`emailed: ${sent.subject} (${sent.id})`);
  }
  // A run that stood down because this occasion's table already went out does not fail as well:
  // the red rows are in the email that was sent, and GitHub would otherwise mail a second alarm.
  for (const r of rows) if (r.status === RED) console.log(`::${stoodDown ? 'warning' : 'error'}::[launch] ${r.name}: ${r.evidence}`);
  process.exit(red && !stoodDown ? 1 : 0);
}
