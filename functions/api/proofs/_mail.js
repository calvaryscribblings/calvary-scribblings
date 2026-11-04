// PROOFS-R3 / R3.1 — the writer emails: the engine. Underscore-prefixed, so Pages does not route it.
//
// Called by two endpoints and nothing else:
//   functions/api/proofs/writers.js    a FOUNDER: the opening list, Open, Close, "Email them",
//                                      Send (the batches /admin/proofs runs in a loop), the samples
//   functions/api/proofs/mail-tick.js  the quarter-hourly job in GitHub Actions (proofs-mail.yml),
//                                      with the ops service token: the same Send, as the safety net
//
// ── R3.1: EVERY CALL FITS CLOUDFLARE'S LIMITS ───────────────────────────────────────────
// On 2 Nov 2026 the first Open died on its 51st subrequest: a Pages Function may make 50 per
// request on the plan we build for, and the old Open made 9 + 4 per writer + 2 per story in ONE
// call (119 at production size). It had claimed 4 openings and 17 stories, sent nothing, and never
// opened the switch. So now:
//   · OPEN IS ONE ATOMIC WRITE. A single multi-path PATCH at the root queues every ticked writer
//     (proofs_mail/queue/{uid}), marks every unticked one excluded, and opens the switch: all of it
//     or none of it, at a constant cost whatever the number of writers or stories.
//   · SENDING IS BATCHED UNDER A BUDGET. Every outbound call is charged to a Budget (45 per call,
//     5 under the platform's 50: functions/api/_budget.js) BEFORE it is made, and an item is started only if its whole cost fits: an opening is 4 (read
//     the writer's record, one conditional write that claims the opening AND carries its stories,
//     the send, one write recording the outcome and dequeuing it); a story email is the same 4.
//     A call that runs out stops cleanly and answers { more: true }; the caller calls again, and
//     each call is a new request with a new budget.
//   · NOTHING IS CLAIMED THAT ISN'T SENT IN THE SAME CALL, because the cost is checked first. If a
//     call dies anyway between the claim and the outcome, the next call finds the claim, records it
//     as 'interrupted' and does NOT send: a lost email beats a double one (ruling 302).
//
// ── WHY THE TICK LIVES HERE, CALLED FROM ACTIONS ────────────────────────────────────────
// A schedule can change through the CMS, the scheduled-publish Worker, a script, a restore, or the
// app. The tick compares the database as it is now against the ledger of what each writer was
// told, so it sees a change no matter who made it. It runs in this Pages project because the mail
// credentials live here (Actions holds none), and because the words, the London time and "what is
// a proof" are imported from app/lib, not hand-copied. The Actions job only POSTs a signed token.
//
// ── EXACTLY ONCE ────────────────────────────────────────────────────────────────────────
// Every ledger change that leads to an email is a create-only or compare-and-swap PUT (RTDB ETag)
// made BEFORE the email. Only the winner of the swap sends. A failed send is recorded (why) and not
// retried. No write here replaces a parent node except the one writer record being claimed, read
// with its ETag a moment before.
//
// ── NOTHING PERSONAL IN A LOG ───────────────────────────────────────────────────────────
// Logs carry counts and outcome codes only: never a uid, a name, an address, a slug or a title.
import { dbBase, mintAccessToken, FIREBASE_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import { PROOFS_ACCESS_PATH } from '../../../app/lib/proofs.js';
import { RETIRED_PATH } from '../../../app/lib/retiredStories.js';
import { isId } from '../../../app/lib/ids.js';
import {
  PROOF_MAIL_ROOT, PROOF_MAIL_QUEUE_PATH, PROOF_MAIL_COPY, writerPath, dueFor, seedRecord, writerState,
  proofsByWriter, mailable, composeWriterMail, sampleMails, logKey,
} from '../../../app/lib/proofMail.js';

export const MAIL_SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/identitytoolkit',
].join(' ');
const PROJECT_ID = 'calvary-scribblings';
export const RESEND_API = 'https://api.resend.com/emails';
const MAX_WRITERS = 1000;

// ── THE BUDGET ───────────────────────────────────────────────────────────────────────────
// LIMITS-1 (ship): the Budget is the shared one in ../_budget.js, which plans every call to 45 of
// the platform's 50 (R3.1 decision 4: 50, whatever the plan). Re-exported for the callers here.
import { Budget, BudgetExceeded, SUBREQUEST_LIMIT, SUBREQUEST_BUDGET } from '../_budget.js';
export { Budget, BudgetExceeded, SUBREQUEST_LIMIT, SUBREQUEST_BUDGET };
/** What one opening or one story email costs: read, conditional write, send, record. */
export const ITEM_COST = 4;
/** Every outbound call in this module goes through here: charged first, then made. */
async function sub(budget, url, init = {}) {
  budget.take(1);
  return fetch(url, init);
}

export const mintMailToken = (env, budget) => { budget.take(1); return mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, MAIL_SCOPES); };
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`).join('&');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (token, extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
const T = () => AbortSignal.timeout(FIREBASE_TIMEOUT_MS);

// ── the database ─────────────────────────────────────────────────────────────────────────
async function read(env, token, budget, path, query = '') {
  const res = await sub(budget, `${dbBase(env)}/${path}.json${query ? `?${query}` : ''}`, { headers: H(token), signal: T() });
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  return res.json();
}
async function readTagged(env, token, budget, path) {
  const res = await sub(budget, `${dbBase(env)}/${path}.json`, { headers: H(token, { 'X-Firebase-ETag': 'true' }), signal: T() });
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  return { value: await res.json(), etag: res.headers.get('ETag') };
}
/** PUT only if the record is still what we read. → true (ours) | false (someone else's change won). */
async function swap(env, token, budget, path, etag, value) {
  if (!etag) throw new Error('swap without an ETag');
  const res = await sub(budget, `${dbBase(env)}/${path}.json`, {
    method: 'PUT', headers: H(token, { 'Content-Type': 'application/json', 'if-match': etag }), body: JSON.stringify(value), signal: T(),
  });
  if (res.status === 412) return false;
  if (!res.ok) throw new Error(`swap failed: ${res.status}`);
  return true;
}
/** One multi-path PATCH: every path in `fields` changes together, or none does. */
async function patch(env, token, budget, path, fields) {
  const res = await sub(budget, `${dbBase(env)}/${path ? `${path}.json` : '.json'}`, {
    method: 'PATCH', headers: H(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(fields), signal: T(),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
}
async function note(env, token, budget, path, fields) {
  try { await patch(env, token, budget, path, fields); } catch (e) { console.error(`[proofs-mail] could not record an outcome (${e?.name || 'Error'})`); }
}

// ── accounts: the Auth record's own address, never one from a request ───────────────────
export async function lookupAccounts(token, budget, uids) {
  const out = {};
  const list = [...new Set(uids)].filter((u) => isId('uid', u));
  for (let i = 0; i < list.length; i += 100) {
    const res = await sub(budget, `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`, {
      method: 'POST', headers: H(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ localId: list.slice(i, i + 100) }), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`account lookup failed: ${res.status}`);
    for (const u of (await res.json())?.users || []) {
      if (isId('uid', u.localId)) out[u.localId] = { email: u.email || null, emailVerified: u.emailVerified === true, disabled: u.disabled === true };
    }
  }
  return out;
}
const lookupCost = (n) => Math.ceil(n / 100);

// ── mail ─────────────────────────────────────────────────────────────────────────────────
/** → { sent: true, emailId } | { sent: false, why }. Never throws on a send failure. ONE subrequest,
 *  no retry, so an item's cost is exact (a 429 is recorded like any other failure, ruling 302). */
export async function sendMail(env, budget, mail) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return { sent: false, why: 'mail_not_configured' };
  try {
    const res = await sub(budget, RESEND_API, {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) return { sent: false, why: `resend_${res.status}` };
    const j = await res.json().catch(() => ({}));
    return { sent: true, emailId: typeof j?.id === 'string' ? j.id : null };
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    return { sent: false, why: e?.name === 'TimeoutError' ? 'resend_timeout' : 'resend_error' };
  }
}
const outcome = (r, now) => (r.sent ? { sent: true, sentAt: now, emailId: r.emailId ?? null, why: null } : { sent: false, why: r.why });

// ── the state: four reads at once (under the six-connection limit) ───────────────────────
export async function readState(env, token, budget, now) {
  const [stories, retired, mail, access] = await Promise.all([
    read(env, token, budget, 'cms_stories', q({ orderBy: 'published', equalTo: false })),
    read(env, token, budget, RETIRED_PATH, 'shallow=true'),
    read(env, token, budget, PROOF_MAIL_ROOT),   // writers + queue in one read
    read(env, token, budget, PROOFS_ACCESS_PATH),
  ]);
  return {
    byWriter: proofsByWriter(stories || {}, retired || {}, now),
    ledger: mail?.writers || {},
    queue: mail?.queue || {},
    open: access?.open === true,
  };
}
/** Every account with the writer badge (users .indexOn isAuthor): uid → display name. One read. */
export async function readWriters(env, token, budget) {
  const users = (await read(env, token, budget, 'users', q({ orderBy: 'isAuthor', equalTo: true }))) || {};
  const out = {};
  for (const [uid, u] of Object.entries(users)) {
    if (!isId('uid', uid) || u?.isAuthor !== true) continue;
    out[uid] = typeof u.displayName === 'string' && u.displayName.trim() ? u.displayName.trim().slice(0, 80) : (typeof u.handle === 'string' ? `@${u.handle}` : 'A writer');
  }
  return out;
}

/** The opening list for /admin/proofs. Never an address: only whether there is one. */
export async function writerList(env, token, budget, now) {
  const [{ byWriter, ledger, queue, open }, names] = await Promise.all([readState(env, token, budget, now), readWriters(env, token, budget)]);
  const uids = [...new Set([...Object.keys(names), ...Object.keys(byWriter)])].slice(0, MAX_WRITERS);
  const accounts = await lookupAccounts(token, budget, uids);
  const rows = uids.map((uid) => {
    const w = ledger[uid] || {};
    return {
      uid,
      name: names[uid] || 'A writer',
      scheduled: (byWriter[uid] || []).length,
      hasAddress: mailable(accounts[uid]),
      state: writerState(w, !!queue[uid]),
      emailedAt: w.opening?.at ?? null,
      openingSent: w.opening ? w.opening.sent === true : null,
    };
  });
  rows.sort((a, b) => b.scheduled - a.scheduled || a.name.localeCompare(b.name));
  return { open, writers: rows, queued: Object.keys(queue).length };
}

// ── OPEN (ruling 290): one atomic write ──────────────────────────────────────────────────
/**
 * Queue every ticked writer not yet emailed, mark every unticked writer excluded, open the switch:
 * ONE multi-path PATCH at the root, so it all happens or none of it does. Sends nothing; the
 * page then calls `send` until nothing is left. Constant cost: two reads and one write after auth.
 */
export async function openProofs(env, token, budget, { by, include, now }) {
  const ticked = new Set(include);
  const [mail, names] = await Promise.all([read(env, token, budget, PROOF_MAIL_ROOT), readWriters(env, token, budget)]);
  const ledger = mail?.writers || {}, queue = mail?.queue || {};
  const uids = [...new Set([...Object.keys(names), ...ticked])].filter((u) => isId('uid', u)).slice(0, MAX_WRITERS);
  const update = { [PROOFS_ACCESS_PATH]: { open: true, changedAt: now, changedBy: by } };
  const counts = { queued: 0, excluded: 0, already: 0 };
  for (const uid of uids) {
    const w = ledger[uid];
    if (w?.opening) { counts.already++; continue; }
    if (ticked.has(uid)) {
      if (!queue[uid]) update[`${PROOF_MAIL_QUEUE_PATH}/${uid}`] = { at: now, by };
      if (w?.excluded) update[`${writerPath(uid)}/excluded`] = null;
      counts.queued++;
    } else {
      if (!w?.excluded) update[`${writerPath(uid)}/excluded`] = { at: now, by };
      if (queue[uid]) update[`${PROOF_MAIL_QUEUE_PATH}/${uid}`] = null;
      counts.excluded++;
    }
  }
  await patch(env, token, budget, '', update);
  console.log(`[proofs-mail] open: ${JSON.stringify(counts)}`);
  return counts;
}

export async function closeProofs(env, token, budget, { by, now }) {
  await patch(env, token, budget, '', { [PROOFS_ACCESS_PATH]: { open: false, changedAt: now, changedBy: by } });
  return { open: false };
}

/** "Email them": queue one writer not yet emailed (and clear their exclusion), atomically. */
export async function includeWriter(env, token, budget, { by, uid, now }) {
  const [w, access] = await Promise.all([read(env, token, budget, writerPath(uid)), read(env, token, budget, PROOFS_ACCESS_PATH)]);
  if (access?.open !== true) return { result: 'closed' };
  if (w?.opening) return { result: 'already' };
  await patch(env, token, budget, '', { [`${PROOF_MAIL_QUEUE_PATH}/${uid}`]: { at: now, by }, [`${writerPath(uid)}/excluded`]: null });
  return { result: 'queued' };
}

// ── SEND: the openings, then the story emails, in one budget (rulings 290, 291) ─────────
/**
 * One batch. → counts and { more }: true when work is left that this call had no budget for.
 * The page and the quarter-hourly job call it again until more is false.
 */
export async function runSend(env, token, budget, { now, pause = 600 }) {
  const counts = { open: false, writers: 0, opening: 0, scheduled: 0, changed: 0, reminder: 0, failed: 0, excluded: 0, noAddress: 0, raced: 0, interrupted: 0, more: false, used: 0 };
  const done = () => { counts.used = budget.used; return counts; };
  const { byWriter, ledger, queue, open } = await readState(env, token, budget, now);
  counts.open = open;
  if (!open) return done();   // closed: nothing is sent, nothing queues up
  counts.writers = Object.keys(byWriter).length;

  // A writer with a scheduled story who was never on an opening list (badged later, or had no
  // address then) is queued for the opening email, in the same batch machinery.
  const queued = new Map(Object.entries(queue).filter(([u]) => isId('uid', u)));
  const fresh = Object.keys(byWriter).filter((u) => writerState(ledger[u], queued.has(u)) === 'new');
  if (fresh.length && budget.fits(1 + 1 + ITEM_COST)) {
    await patch(env, token, budget, PROOF_MAIL_QUEUE_PATH, Object.fromEntries(fresh.map((u) => [u, { at: now, by: 'tick' }])));
    for (const u of fresh) queued.set(u, { at: now, by: 'tick' });
  }

  // The work, in order: openings (oldest queued first), then story emails (soonest go-live first).
  const work = [];
  for (const [uid, e] of [...queued].sort((a, b) => (a[1]?.at || 0) - (b[1]?.at || 0))) work.push({ type: 'opening', uid, by: e?.by || 'tick' });
  const story = [];
  for (const [uid, list] of Object.entries(byWriter)) {
    const w = ledger[uid];
    const state = writerState(w, queued.has(uid));
    if (state === 'excluded') { counts.excluded++; continue; }
    if (state !== 'opened') continue;
    for (const s of list) if (dueFor(w.stories?.[s.slug] || null, s, now)) story.push({ type: 'story', uid, s });
  }
  story.sort((a, b) => a.s.goLiveMs - b.s.goLiveMs);
  work.push(...story);
  if (!work.length) return done();

  // Addresses first, for every writer with work (one lookup per 100), so a writer with no address
  // is set aside here and never takes a batch slot from the work behind it.
  const workUids = [...new Set(work.map((w) => w.uid))];
  if (!budget.fits(lookupCost(workUids.length) + ITEM_COST)) { counts.more = true; return done(); }
  const accounts = await lookupAccounts(token, budget, workUids);
  const ready = work.filter((w) => mailable(accounts[w.uid]));
  counts.noAddress = new Set(work.filter((w) => !mailable(accounts[w.uid])).map((w) => w.uid)).size;

  // Take as many as the budget holds, ITEM_COST each. The rest is "more": the caller calls again.
  const room = Math.max(0, Math.floor(budget.left / ITEM_COST));
  const batch = ready.slice(0, room);
  counts.more = batch.length < ready.length;

  let sends = 0;
  const gap = async () => { if (sends++ && pause) await wait(pause); };   // Resend's default is 2 a second
  for (const item of batch) {
    const account = accounts[item.uid];
    if (item.type === 'opening') await sendOpening(env, token, budget, item, byWriter[item.uid] || [], account.email, now, counts, gap);
    else await sendStory(env, token, budget, item, account.email, now, counts, gap);
  }
  // A writer with no address stays queued, claimed by nobody, and is not "more": another call
  // couldn't send it either. It goes with the first call after the account has an address.
  console.log(`[proofs-mail] send: ${JSON.stringify(done())}`);
  return counts;
}

/** One opening: read the writer's record, claim the opening WITH its stories in one conditional
 *  write, send, then record the outcome and dequeue in one write. 4 subrequests. */
async function sendOpening(env, token, budget, { uid, by }, stories, address, now, counts, gap) {
  const path = writerPath(uid);
  const { value: cur, etag } = await readTagged(env, token, budget, path);
  if (cur?.opening) {
    // Already claimed: by another run (raced), or by a call that died before recording (interrupted).
    // Never sent again. Dequeue it, and say which.
    const interrupted = cur.opening.status === 'sending' && cur.opening.sent !== true && !cur.opening.why;
    await note(env, token, budget, PROOF_MAIL_ROOT, {
      [`queue/${uid}`]: null,
      ...(interrupted ? { [`writers/${uid}/opening/why`]: 'interrupted', [`writers/${uid}/opening/status`]: 'interrupted' } : {}),
    });
    if (interrupted) counts.interrupted++; else counts.raced++;
    return;
  }
  const seeds = {};
  for (const s of stories) if (!cur?.stories?.[s.slug]) seeds[s.slug] = seedRecord(s, now);
  const { excluded: _x, ...rest } = cur || {};
  const claimed = await swap(env, token, budget, path, etag, {
    ...rest,
    opening: { status: 'sending', at: now, by, stories: stories.length, sent: false },
    stories: { ...(cur?.stories || {}), ...seeds },
  });
  if (!claimed) { counts.raced++; return; }
  await gap();
  const r = await sendMail(env, budget, composeWriterMail(env.FROM_EMAIL, address, PROOF_MAIL_COPY.opening(stories)));
  const o = outcome(r, now);
  await note(env, token, budget, PROOF_MAIL_ROOT, {
    [`queue/${uid}`]: null,
    [`writers/${uid}/opening/status`]: o.sent ? 'sent' : 'failed',
    [`writers/${uid}/opening/sent`]: o.sent,
    ...(o.sent ? { [`writers/${uid}/opening/sentAt`]: now, [`writers/${uid}/opening/emailId`]: o.emailId } : { [`writers/${uid}/opening/why`]: o.why }),
  });
  if (r.sent) counts.opening++; else counts.failed++;
}

/** One story email (scheduled, changed or 48-hour). 4 subrequests. */
async function sendStory(env, token, budget, { uid, s }, address, now, counts, gap) {
  const path = `${writerPath(uid)}/stories/${s.slug}`;
  const { value, etag } = await readTagged(env, token, budget, path);
  const due = dueFor(value, s, now);                              // decided again on the fresh record
  if (!due) return;
  if (!(await swap(env, token, budget, path, etag, due.next))) { counts.raced++; return; }
  const words = due.kind === 'changed' ? PROOF_MAIL_COPY.changed(s, due.prevMs) : PROOF_MAIL_COPY[due.kind](s);
  await gap();
  const r = await sendMail(env, budget, composeWriterMail(env.FROM_EMAIL, address, words));
  const o = outcome(r, now);
  const seq = logKey(due.next.seq);
  await note(env, token, budget, path, due.kind === 'reminder'
    ? { remindSent: o.sent, [`log/${seq}/sent`]: o.sent, ...(o.why ? { [`log/${seq}/why`]: o.why } : {}) }
    : { ...o, [`log/${seq}/sent`]: o.sent, ...(o.why ? { [`log/${seq}/why`]: o.why } : {}) });
  if (r.sent) counts[due.kind]++; else counts.failed++;
}

// ── THE SAMPLES (ruling 292) ─────────────────────────────────────────────────────────────
/** Every email, filled with invented stories, to ONE address: the signed-in founder's own. 5 subrequests. */
export async function sendSamples(env, budget, { to, now, pause = 600 }) {
  let sent = 0, failed = 0;
  for (const [i, m] of sampleMails(now).entries()) {
    if (i && pause) await wait(pause);
    const r = await sendMail(env, budget, composeWriterMail(env.FROM_EMAIL, to, m, { sample: true }));
    if (r.sent) sent++; else failed++;
  }
  return { sent, failed };
}
