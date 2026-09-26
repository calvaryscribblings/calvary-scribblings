#!/usr/bin/env node
// W7 — LAUNCH CHECKS. One command that says, at midnight, whether every switch worked.
//
//   node scripts/launch-check.mjs            print the table
//   node scripts/launch-check.mjs --email    …and mail it to Ikenna (via /api/ops/launch-email)
//   node scripts/launch-check.mjs --json     the rows as JSON
//   --since <ISO>                            the "since the last check" instant (default: the
//                                            previous launch-check workflow run, else 24h ago)
//
// READ-ONLY against production. It reads with the Firebase Admin SDK, asks the live site the
// questions a signed-out reader would, and asks /api/ops/launch-status for the membership
// switches as BOOLEANS. The only thing it ever sends is the email.
//
// Each row is GREEN, RED, or NOT YET DUE (a switch whose date has not come — before the launch date the
// gate is off by design, and that is not a failure). Every row prints the evidence it read.
// The verdicts are pure functions of that evidence and the clock, so tests/ci/w7-launch-check
// can force each row green, red and not-yet-due without a network.
//
// Credentials, in order: LAUNCH_SERVICE_ACCOUNT (a path), FIREBASE_SA_KEY (base64 JSON, the
// codespace), serviceAccountKey.json. The email is signed with the same key (see
// functions/api/ops/_opsAuth.js) — no Resend key lives outside the Pages project.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { GATE_ON_MS, gatingOn, freeUntilFor, servesAsReader } from '../app/lib/storyAccess.js';
import { endingOf } from './check-built-gate.mjs';
import { LAUNCH_DATE_SHORT } from '../app/lib/launch.js';

export const SITE = process.env.LAUNCH_SITE || 'https://calvaryscribblings.co.uk';
export const GREEN = 'green';
export const RED = 'red';
export const NYD = 'not yet due';

const MIN = 60_000;
export const STALE = {
  publish: 40 * MIN,   // the scheduled-publish Worker ticks every 15 minutes
  scrub: 45 * MIN,     // the account scrub runs every 15 minutes
  push: 45 * MIN,      // the push announcer, once armed, every 15 minutes
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

/** FREE WEEK: signed-out /api/story for an archive story, this week's, and a poem. */
export function judgeFreeWeek({ archive, thisWeek, poem }, now) {
  const ev = [
    `archive "${archive?.slug ?? '—'}" → ${said(archive?.res)}`,
    `this week "${thisWeek?.slug ?? '(none published this week)'}" → ${thisWeek ? said(thisWeek.res) : '—'}`,
    `poem "${poem?.slug ?? '—'}" → ${said(poem?.res)}`,
  ].join('; ');
  const all = [archive, thisWeek, poem].filter(Boolean);
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
    && poem.res.access === 'full' && poem.res.reason === 'poetry';
  return row('Free week', ok ? GREEN : RED, ev);
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
export function judgeHeartbeat(name, { lastAt, staleMs, armed = true }, now) {
  if (!armed) return row(name, NYD, 'not armed yet (its cron is commented out) — nothing is expected');
  const ev = `last ran ${fmt(lastAt)} (${ago(lastAt, now)}); stale after ${Math.round(staleMs / 60000)} min`;
  return row(name, Number.isFinite(lastAt) && now - lastAt <= staleMs ? GREEN : RED, ev);
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
  if (process.env.LAUNCH_SERVICE_ACCOUNT) return JSON.parse(readFileSync(process.env.LAUNCH_SERVICE_ACCOUNT, 'utf8'));
  if (process.env.FIREBASE_SA_KEY) return JSON.parse(Buffer.from(process.env.FIREBASE_SA_KEY, 'base64').toString());
  return JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'));
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
  const db = getDatabase();
  const val = async (p) => (await db.ref(p).get()).val();

  // Pick the stories from the live index: the newest archive prose story, the newest of this
  // week's, and the newest poem. Reader-mode stories are EPUBs and are not asked about.
  const index = (await val('cms_stories_index')) || {};
  const prose = Object.entries(index).map(([slug, r]) => ({ slug, ...r }))
    .filter((r) => r.published !== false && !servesAsReader(r) && Number.isFinite(r.publishedAtMs))
    .sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  const archiveRec = prose.find((r) => r.category !== 'poetry' && r.category !== 'news' && freeUntilFor(r) !== null && freeUntilFor(r) < now);
  const weekRec = prose.find((r) => r.category !== 'poetry' && r.category !== 'news' && freeUntilFor(r) !== null && freeUntilFor(r) >= now);
  const poemRec = prose.find((r) => r.category === 'poetry');
  const [aRes, wRes, pRes] = await Promise.all([archiveRec, weekRec, poemRec].map((r) => (r ? askStory(r.slug) : null)));
  const freeWeek = {
    archive: archiveRec ? { slug: archiveRec.slug, res: aRes } : null,
    thisWeek: weekRec ? { slug: weekRec.slug, res: wRes } : null,
    poem: poemRec ? { slug: poemRec.slug, res: pRes } : null,
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
  let pushArmed = false;
  try { pushArmed = pushScheduleArmed(readFileSync('.github/workflows/push-announce.yml', 'utf8')); } catch { /* treated as not armed */ }

  const since = Number.isFinite(sinceArg) ? sinceArg : ((await previousRunStart()) ?? now - 24 * 3600_000);
  const signals = { moneyFailures: await val('ops/money_failures'), publishSkips: await val('ops/publish_skips'), since };

  return {
    freeWeek, build, archiveHtml, series: { instalmentId: platinumId, res: seriesRes },
    bookStore: { pageStatus: bookPage, publishedTitles }, membership,
    jobs: {
      publish: { lastAt: Number(publishHb?.lastTickAt) || NaN },
      scrub: { lastAt: Number(scrubHb?.lastRunAt) || NaN },
      push: { lastAt: Number(pushHb?.lastRunAt) || NaN, armed: pushArmed },
    },
    signals,
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
    judgeSignals(g.signals),
  ];
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
  if (args.includes('--email')) {
    const sent = await email(g.sa, rows, now);
    console.log(`emailed: ${sent.subject} (${sent.id})`);
  }
  for (const r of rows) if (r.status === RED) console.log(`::error::[launch] ${r.name}: ${r.evidence}`);
  process.exit(red ? 1 : 0);
}
