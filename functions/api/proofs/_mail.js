// PROOFS-R3 — the writer emails: the engine. Underscore-prefixed, so Pages does not route it.
//
// Called by two endpoints and nothing else:
//   functions/api/proofs/writers.js    a FOUNDER: the opening list, Open (with the list), Close,
//                                      "Email them" for a writer unticked at opening, the samples
//   functions/api/proofs/mail-tick.js  the */15 job in GitHub Actions (.github/workflows/proofs-mail.yml),
//                                      with the ops service token: the scheduled, changed and
//                                      48-hour emails
//
// ── WHY THE TICK LIVES HERE, CALLED FROM ACTIONS ────────────────────────────────────────
// A schedule can change through the CMS, the scheduled-publish Worker, a script, a restore, or the
// app. A sender hooked into any one of them misses the others. The tick instead compares the
// database as it is now against the ledger of what each writer was told, so it sees a change no
// matter who made it, and the 48-hour email needs a clock anyway. It runs in this Pages project
// because the mail credentials live here (Actions holds none), and because the words, the London
// time and "what is a proof" are imported from app/lib, not hand-copied into the Worker's
// dashboard. The Actions job only POSTs a signed token: it reads and writes nothing itself.
//
// ── EXACTLY ONCE ────────────────────────────────────────────────────────────────────────
// Every ledger change is a create-only or compare-and-swap PUT (RTDB ETag), made BEFORE the email.
// Two ticks, a tick and an Open, a retry: only the winner of the swap sends. A failed send is
// recorded (why) and NOT retried, the same choice _alerts.js makes: a lost email beats a double.
// Only the ledger is written, one record at a time; no write here replaces a parent node, so the
// SAFETY-1 bulk-write risk (a PUT over a whole node) does not arise. The guard itself is a Node
// tool for scripts/ (it backs up through the Admin SDK) and cannot run in a Function.
//
// ── NOTHING PERSONAL IN A LOG ───────────────────────────────────────────────────────────
// Logs carry counts and outcome codes only: never a uid, a name, an address, a slug or a title.
import { dbBase, mintAccessToken, FIREBASE_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import { readJson } from './_proofs.js';
import { PROOFS_ACCESS_PATH } from '../../../app/lib/proofs.js';
import { RETIRED_PATH } from '../../../app/lib/retiredStories.js';
import { isId } from '../../../app/lib/ids.js';
import {
  PROOF_MAIL_PATH, PROOF_MAIL_COPY, writerPath, storyLedgerPath, dueFor, seedRecord, writerState,
  proofsByWriter, mailable, composeWriterMail, sampleMails, logKey,
} from '../../../app/lib/proofMail.js';

export const MAIL_SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/identitytoolkit',
].join(' ');
const PROJECT_ID = 'calvary-scribblings';
export const RESEND_API = 'https://api.resend.com/emails';
const MAX_WRITERS = 200;

export const mintMailToken = (env) => mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, MAIL_SCOPES);
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`).join('&');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the database, one record at a time ──────────────────────────────────────────────────
async function readTagged(env, token, path) {
  const res = await fetch(`${dbBase(env)}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  return { value: await res.json(), etag: res.headers.get('ETag') };
}
/** PUT only if the record is still what we read. → true (ours) | false (someone else's change won). */
async function swap(env, token, path, etag, value) {
  if (!etag) throw new Error('swap without an ETag');
  const res = await fetch(`${dbBase(env)}/${path}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'if-match': etag },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (res.status === 412) return false;
  if (!res.ok) throw new Error(`swap failed: ${res.status}`);
  return true;
}
/** Create only if absent. → true (created) | false (already there). */
async function create(env, token, path, value) {
  const { value: cur, etag } = await readTagged(env, token, path);
  if (cur !== null) return false;
  return swap(env, token, path, etag, value);
}
async function patch(env, token, path, fields) {
  const res = await fetch(`${dbBase(env)}/${path}.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
}
async function remove(env, token, path) {
  const res = await fetch(`${dbBase(env)}/${path}.json`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}
async function note(env, token, path, fields) {
  try { await patch(env, token, path, fields); } catch (e) { console.error(`[proofs-mail] could not record an outcome (${e?.name || 'Error'})`); }
}

// ── accounts: the Auth record's own address, never one from a request ───────────────────
export async function lookupAccounts(token, uids) {
  const out = {};
  const list = [...new Set(uids)].filter((u) => isId('uid', u));
  for (let i = 0; i < list.length; i += 100) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: list.slice(i, i + 100) }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`account lookup failed: ${res.status}`);
    for (const u of (await res.json())?.users || []) {
      if (isId('uid', u.localId)) out[u.localId] = { email: u.email || null, emailVerified: u.emailVerified === true, disabled: u.disabled === true };
    }
  }
  return out;
}

// ── mail ─────────────────────────────────────────────────────────────────────────────────
/** → { sent: true, emailId } | { sent: false, why }. Never throws. One retry on a 429. */
export async function sendMail(env, mail) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return { sent: false, why: 'mail_not_configured' };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mail),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (res.status === 429 && attempt === 0) { await wait(1100); continue; }
      if (!res.ok) return { sent: false, why: `resend_${res.status}` };
      const j = await res.json().catch(() => ({}));
      return { sent: true, emailId: typeof j?.id === 'string' ? j.id : null };
    }
  } catch (e) { return { sent: false, why: e?.name === 'TimeoutError' ? 'resend_timeout' : 'resend_error' }; }
  return { sent: false, why: 'resend_429' };
}
const outcome = (r, now) => (r.sent ? { sent: true, sentAt: now, emailId: r.emailId ?? null, why: null } : { sent: false, why: r.why });

// ── the state ────────────────────────────────────────────────────────────────────────────
export async function readState(env, token, now) {
  const [stories, retired, ledger, access] = await Promise.all([
    readJson(env, token, 'cms_stories', q({ orderBy: 'published', equalTo: false })),
    readJson(env, token, RETIRED_PATH, 'shallow=true'),
    readJson(env, token, PROOF_MAIL_PATH),
    readJson(env, token, PROOFS_ACCESS_PATH),
  ]);
  return { byWriter: proofsByWriter(stories || {}, retired || {}, now), ledger: ledger || {}, open: access?.open === true };
}
/** Every account with the writer badge (users .indexOn isAuthor): uid → display name. */
export async function readWriters(env, token) {
  const users = (await readJson(env, token, 'users', q({ orderBy: 'isAuthor', equalTo: true }))) || {};
  const out = {};
  for (const [uid, u] of Object.entries(users)) {
    if (!isId('uid', uid) || u?.isAuthor !== true) continue;
    out[uid] = typeof u.displayName === 'string' && u.displayName.trim() ? u.displayName.trim().slice(0, 80) : (typeof u.handle === 'string' ? `@${u.handle}` : 'A writer');
  }
  return out;
}

/** The opening list for /admin/proofs. Never an address: only whether there is one. */
export async function writerList(env, token, now) {
  const [{ byWriter, ledger, open }, names] = await Promise.all([readState(env, token, now), readWriters(env, token)]);
  const uids = [...new Set([...Object.keys(names), ...Object.keys(byWriter)])].slice(0, MAX_WRITERS);
  const accounts = await lookupAccounts(token, uids);
  const rows = uids.map((uid) => {
    const w = ledger[uid] || {};
    return {
      uid,
      name: names[uid] || 'A writer',
      scheduled: (byWriter[uid] || []).length,
      hasAddress: mailable(accounts[uid]),
      state: writerState(w),
      emailedAt: w.opening?.at ?? null,
      openingSent: w.opening ? w.opening.sent === true : null,
    };
  });
  rows.sort((a, b) => b.scheduled - a.scheduled || a.name.localeCompare(b.name));
  return { open, writers: rows };
}

// ── the opening email ────────────────────────────────────────────────────────────────────
/**
 * Claim one writer's opening, and seed each listed story as told (so none of them fires a
 * "scheduled" email on top). → { claimed: false } | { claimed: true, seeded: [paths] }. Sends nothing.
 */
async function claimOpening(env, token, uid, stories, { by, now }) {
  const base = writerPath(uid);
  const won = await create(env, token, `${base}/opening`, { at: now, by, stories: stories.length, sent: false });
  if (!won) return { claimed: false };
  const seeded = [];
  for (const s of stories) {
    const p = storyLedgerPath(uid, s.slug);
    if (await create(env, token, p, seedRecord(s, now))) seeded.push(p);
  }
  return { claimed: true, seeded };
}
async function deliverOpening(env, token, uid, stories, address, now) {
  const r = await sendMail(env, composeWriterMail(env.FROM_EMAIL, address, PROOF_MAIL_COPY.opening(stories)));
  await note(env, token, `${writerPath(uid)}/opening`, outcome(r, now));
  return r;
}

/**
 * OPEN (ruling 290). `include` is the ticked list. Order matters, so a quarter-hourly tick running at the
 * same moment can never email someone unticked, and nothing is claimed that cannot be sent:
 *   1. every unticked writer is marked excluded, every ticked one with an address has their
 *      opening claimed and their stories seeded;
 *   2. the switch opens (if that fails, the claims are taken back: nothing was sent);
 *   3. the claimed openings are sent, one at a time.
 * A writer already emailed is skipped: closing and reopening never sends the opening again.
 */
export async function openProofs(env, token, { by, include, now, pause = 600 }) {
  const ticked = new Set(include);
  const [{ byWriter, ledger }, names] = await Promise.all([readState(env, token, now), readWriters(env, token)]);
  const uids = [...new Set([...Object.keys(names), ...Object.keys(byWriter)])].slice(0, MAX_WRITERS);
  const accounts = await lookupAccounts(token, uids);
  const counts = { claimed: 0, sent: 0, failed: 0, excluded: 0, already: 0, noAddress: 0 };
  const toSend = [];
  const taken = [];
  for (const uid of uids) {
    const state = writerState(ledger[uid]);
    if (state === 'opened') { counts.already++; continue; }
    if (!ticked.has(uid)) {
      if (state !== 'excluded') await patch(env, token, writerPath(uid), { excluded: { at: now, by } });
      counts.excluded++;
      continue;
    }
    if (!mailable(accounts[uid])) { counts.noAddress++; continue; }
    const stories = byWriter[uid] || [];
    const c = await claimOpening(env, token, uid, stories, { by, now });
    if (!c.claimed) { counts.already++; continue; }
    if (state === 'excluded') await remove(env, token, `${writerPath(uid)}/excluded`);
    taken.push(`${writerPath(uid)}/opening`, ...c.seeded);
    toSend.push({ uid, stories, address: accounts[uid].email });
    counts.claimed++;
  }
  try {
    await fetch(`${dbBase(env)}/${PROOFS_ACCESS_PATH}.json`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: true, changedAt: now, changedBy: by }),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    }).then((r) => { if (!r.ok) throw new Error(`switch ${r.status}`); });
  } catch (e) {
    for (const p of taken) await remove(env, token, p).catch(() => {});
    throw new Error('the switch could not be opened; nothing was sent');
  }
  for (const [i, w] of toSend.entries()) {
    if (i && pause) await wait(pause);   // Resend's default limit is 2 a second
    const r = await deliverOpening(env, token, w.uid, w.stories, w.address, now);
    if (r.sent) counts.sent++; else counts.failed++;
  }
  console.log(`[proofs-mail] open: ${JSON.stringify(counts)}`);
  return counts;
}

export async function closeProofs(env, token, { by, now }) {
  const res = await fetch(`${dbBase(env)}/${PROOFS_ACCESS_PATH}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ open: false, changedAt: now, changedBy: by }),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`switch ${res.status}`);
  return { open: false };
}

/** "Email them": a writer unticked at opening (or never emailed) gets the opening email now. */
export async function includeWriter(env, token, { by, uid, now }) {
  const { byWriter, ledger, open } = await readState(env, token, now);
  if (!open) return { result: 'closed' };
  if (writerState(ledger[uid]) === 'opened') return { result: 'already' };
  const account = (await lookupAccounts(token, [uid]))[uid];
  if (!mailable(account)) return { result: 'no_address' };
  const stories = byWriter[uid] || [];
  const c = await claimOpening(env, token, uid, stories, { by, now });
  if (!c.claimed) return { result: 'already' };
  if (ledger[uid]?.excluded) await remove(env, token, `${writerPath(uid)}/excluded`);
  const r = await deliverOpening(env, token, uid, stories, account.email, now);
  return { result: r.sent ? 'sent' : 'failed' };
}

// ── THE TICK (ruling 291) ────────────────────────────────────────────────────────────────
export async function runTick(env, token, { now, pause = 600 }) {
  const counts = { open: false, writers: 0, opening: 0, scheduled: 0, changed: 0, reminder: 0, failed: 0, excluded: 0, noAddress: 0, raced: 0 };
  const { byWriter, ledger, open } = await readState(env, token, now);
  if (!open) return counts;   // closed: nothing is sent and nothing queues up
  counts.open = true;
  const uids = Object.keys(byWriter);
  counts.writers = uids.length;
  const accounts = uids.length ? await lookupAccounts(token, uids) : {};
  let sends = 0;
  const gap = async () => { if (sends++ && pause) await wait(pause); };

  for (const uid of uids) {
    const w = ledger[uid] || {};
    const state = writerState(w);
    if (state === 'excluded') { counts.excluded++; continue; }
    if (!mailable(accounts[uid])) { counts.noAddress++; continue; }   // nothing claimed: sent once they have one
    const address = accounts[uid].email;
    const stories = byWriter[uid];

    if (state === 'new') {
      const c = await claimOpening(env, token, uid, stories, { by: 'tick', now });
      if (!c.claimed) { counts.raced++; continue; }
      await gap();
      const r = await deliverOpening(env, token, uid, stories, address, now);
      if (r.sent) counts.opening++; else counts.failed++;
      continue;
    }

    for (const s of stories) {
      if (!dueFor(w.stories?.[s.slug] || null, s, now)) continue;   // the cheap look, from the bulk read
      const path = storyLedgerPath(uid, s.slug);
      const { value, etag } = await readTagged(env, token, path);
      const due = dueFor(value, s, now);                              // decided again on the fresh record
      if (!due) continue;
      if (!(await swap(env, token, path, etag, due.next))) { counts.raced++; continue; }
      const words = due.kind === 'changed' ? PROOF_MAIL_COPY.changed(s, due.prevMs) : PROOF_MAIL_COPY[due.kind](s);
      await gap();
      const r = await sendMail(env, composeWriterMail(env.FROM_EMAIL, address, words));
      const o = outcome(r, now);
      const seq = logKey(due.next.seq);
      await note(env, token, path, due.kind === 'reminder'
        ? { remindSent: o.sent, [`log/${seq}/sent`]: o.sent, ...(o.why ? { [`log/${seq}/why`]: o.why } : {}) }
        : { ...o, [`log/${seq}/sent`]: o.sent, ...(o.why ? { [`log/${seq}/why`]: o.why } : {}) });
      if (r.sent) counts[due.kind]++; else counts.failed++;
    }
  }
  console.log(`[proofs-mail] tick: ${JSON.stringify(counts)}`);
  return counts;
}

// ── THE SAMPLES (ruling 292) ─────────────────────────────────────────────────────────────
/** Every email, filled with invented stories, to ONE address: the signed-in founder's own. */
export async function sendSamples(env, { to, now, pause = 600 }) {
  let sent = 0, failed = 0;
  for (const [i, m] of sampleMails(now).entries()) {
    if (i && pause) await wait(pause);
    const r = await sendMail(env, composeWriterMail(env.FROM_EMAIL, to, m, { sample: true }));
    if (r.sent) sent++; else failed++;
  }
  return { sent, failed };
}
