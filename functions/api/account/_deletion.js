// ACCOUNT DELETION — the one server path, for the web and the app alike.
//
// Underscore-prefixed, so Pages does not route it. The route is ./delete.js; this module holds
// everything that route decides and does, with every outside call handed in, so the harness can
// drive the real sequence against the emulator and stand-ins (tests/account/).
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// TWO HALVES, AND WHY THE SPLIT IS WHERE IT IS
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// THE ENDPOINT (this module) does everything that is KEYED by the reader: their uid-keyed nodes,
// their handle, the mirror halves of their follows, the rows keyed by their email, their Storage
// files, their billing — and the Auth account, LAST. None of it needs a scan, so it fits a Pages
// Function's budget whatever the plan: about thirty subrequests and no large parse.
//
// THE SCRUB (scripts/account/scrub.mjs, on a */15 GitHub Actions cron) does everything that is
// SCATTERED: their comments and replies under every story, their reactions on other people's
// comments and posts (with the counters put back), the notifications they caused in other
// readers' inboxes, their DMs, their Square and Open Pages work. Finding those means reading
// ~2.6 MB across twenty-odd nodes; measured on 23 Sep 2026, a cold JSON.parse of it alone is
// 25 ms, which is over a free-plan Worker's entire CPU allowance before any work is done. The
// scrub needs no credential of the reader's, so it runs AFTER the Auth account is gone, from the
// record, and a failure there is retried on the next tick rather than by the reader.
//
// So "Auth LAST" holds for everything the reader could be asked to retry. The scrub's reach is
// asserted by the emulator test, which runs both halves and then walks every Step 0 location.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE RECORD — deletions/{uid}
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//   { uid, requestedAt, updatedAt, steps: { membership, owned, storage, auth, scrub }, completedAt }
//
// Timestamps and step names, and nothing else — no email, no name, no reason. It is written
// FIRST, before any money moves, because the membership webhooks read it: a cancellation makes
// Stripe send customer.subscription.deleted, and that event must find the record already there
// or it would write users/{uid}/membership and put a stub node back (see _membership.js).
//
// Each step is recorded only after it succeeds, and each is safe to run twice, so a retry starts
// again from the first step not yet recorded. A failure answers 500 with the step's name; it
// never answers success.

import { STRIPE_VERSION } from '../_stripe.js';
import { json, dbBase, lookupUser, mintAccessToken, PROVIDER_TIMEOUT_MS, FIREBASE_TIMEOUT_MS, STORAGE_BUCKET } from '../bookstore/_lib.js';

export const DELETION_PATH = (uid) => `deletions/${uid}`;

export const FOUNDERS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

// ── RECENT LOGIN: 300 seconds ──────────────────────────────────────────────────────────────
// Chosen as Firebase's own threshold: deleting an Auth account from a client refuses with
// auth/requires-recent-login once the sign-in is more than five minutes old. Using the same
// number means a client that already handles that error (both do) handles this one with the
// same code path — reauthenticate, then call again. The clock is the token's auth_time, which
// is when the reader last proved who they are (password, Apple, Google), NOT when the token was
// minted: a silently refreshed token keeps its old auth_time, which is the whole point.
export const RECENT_LOGIN_S = 300;
// Slack for clock skew between Google's token minting and this Worker.
export const CLOCK_SKEW_S = 30;

export const STEPS = ['membership', 'owned', 'storage', 'auth'];

// Every top-level node keyed directly by the reader's uid that the ENDPOINT deletes whole.
// memberships, bookstore_purchases, purchases are KEPT (accounting); rate_limits is keyed by
// window, not uid. Asserted against the rules file by tests/account/plan.test.mjs, so a new
// uid-keyed node cannot be added to the rules without a decision here.
export const OWNED_NODES = [
  'users', 'users_private', 'user_search', 'push_tokens', 'leaderboard', 'blocked_users',
  'readerBookmarks', 'bookmarks', 'userBookmarks', 'userBadges', 'userStreaks', 'userProgress',
  'userStoryTiers', 'points', 'wallet', 'payout_requests', 'quizAttemptCounted', 'quiz_submissions',
  'series_reading_progress', 'bookstore_reading_progress', 'square_presence',
  'open_pages_drafts', 'open_pages_rate', 'notifications', 'library_notifications',
  'dm_conversations', 'followers', 'following', 'user_comments', 'user_square_posts',
  'user_open_pages', 'exercise_submissions',
].filter((v, i, a) => a.indexOf(v) === i);

// Kept on purpose, keyed by the same uid. Listed so the test can prove every uid-keyed node in
// the rules is either deleted or kept by a decision, never by omission.
export const KEPT_NODES = {
  memberships: 'billing record: tier, rail, status, period end, Stripe/Paystack ids — accounting',
  ops: 'ops/money_failures only: a payment that needs a human names the reader, so they can be refunded — accounting',
  bookstore_purchases: 'book purchase records: title, amount, provider refs — accounting; a purchase is permanent',
  purchases: 'legacy single-story purchase records — accounting',
  deletions: 'this record',
};

export const STORAGE_PREFIXES = (uid) => [`avatars/${uid}`, `headers/${uid}`, `open_pages/${uid}/`];

// ─────────────────────────────────────────────────────────────────────────────────────────
// Pure parts
// ─────────────────────────────────────────────────────────────────────────────────────────

/** The payload of a JWT, unverified. Only ever read AFTER accounts:lookup has accepted the token. */
export function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
    return JSON.parse(atob(b64));
  } catch { return null; }
}

/**
 * Who is asking, and have they signed in recently enough to delete.
 * @returns {{ok:true, uid, email} | {ok:false, status, code, error}}
 */
export function judgeIdentity({ user, payload, nowS }) {
  const uid = user?.localId;
  if (!uid || !payload || payload.sub !== uid || payload.user_id !== uid) {
    return { ok: false, status: 401, code: 'signed_out', error: 'Your session has expired. Please sign in again.' };
  }
  if (FOUNDERS.includes(uid)) {
    return { ok: false, status: 403, code: 'house_account', error: 'This account cannot be deleted here.' };
  }
  const authTime = Number(payload.auth_time);
  if (!Number.isFinite(authTime) || nowS - authTime > RECENT_LOGIN_S || authTime - nowS > CLOCK_SKEW_S) {
    return {
      ok: false, status: 401, code: 'requires_recent_login',
      error: 'For your security, please sign in again to delete your account.',
      maxAgeSeconds: RECENT_LOGIN_S,
    };
  }
  return { ok: true, uid, email: typeof user.email === 'string' && user.email ? user.email : null };
}

/** What, if anything, must be cancelled. Day and week passes renew nothing and need nothing. */
export function membershipAction(detail) {
  if (!detail || typeof detail !== 'object') return null;
  if (detail.status !== 'active' && detail.status !== 'past_due') return null;
  if (detail.rail === 'stripe' && typeof detail.stripeSubscriptionId === 'string' && detail.stripeSubscriptionId) {
    return { rail: 'stripe', id: detail.stripeSubscriptionId };
  }
  if (detail.rail === 'paystack' && typeof detail.paystackSubscriptionCode === 'string' && detail.paystackSubscriptionCode) {
    return { rail: 'paystack', code: detail.paystackSubscriptionCode };
  }
  return null;
}

const sameEmail = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The owned half, as ONE root multi-path update of nulls. Pure.
 *
 * @param uid
 * @param reads { user, following, followers, handles: {handle: value}, subscribers, waitlist }
 * @param email the Auth email, or null
 */
export function planOwned(uid, { user, following, followers, handles, subscribers, waitlist }, email) {
  const u = {};
  for (const n of OWNED_NODES) u[`${n}/${uid}`] = null;
  // The other half of every follow: they follow me → following/{them}/{me}; I follow them →
  // followers/{them}/{me}.
  // (A self-follow is already inside the whole-node delete, and naming it twice would be an
  // overlapping path, which RTDB refuses for the entire update.)
  for (const them of Object.keys(following || {})) if (them !== uid) u[`followers/${them}/${uid}`] = null;
  for (const them of Object.keys(followers || {})) if (them !== uid) u[`following/${them}/${uid}`] = null;
  // A handle is released only if it still points at this reader.
  for (const [h, v] of Object.entries(handles || {})) if (v === uid) u[`usernames/${h}`] = null;
  if (email) {
    for (const [k, row] of Object.entries(subscribers || {})) if (sameEmail(row?.email, email)) u[`subscribers/${k}`] = null;
    for (const [k, row] of Object.entries(waitlist || {})) if (sameEmail(row?.email, email)) u[`bookstore_waitlist/${k}`] = null;
  }
  return u;
}

export function handlesOf(user) {
  const hs = new Set();
  for (const k of ['username', 'handle', 'handleLowercased']) {
    const v = user?.[k];
    if (typeof v === 'string' && v && /^[^.$#[\]/]+$/.test(v)) { hs.add(v); hs.add(v.toLowerCase()); }
  }
  return [...hs];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The sequence. `io` is every outside call:
//   io.get(path) → value|null          io.patch(rootUpdate)
//   io.stripeCancel(subId)             io.paystackDisable(code)
//   io.storageList(prefix) → [names]   io.storageDelete(name)
//   io.authDelete(uid)                 io.now() → ms
// ─────────────────────────────────────────────────────────────────────────────────────────

export class StepError extends Error {
  constructor(step, cause) {
    super(`${step}: ${cause?.message || cause}`);
    this.step = step;
    this.cause = cause;
  }
}

export async function runDeletion(uid, email, io, log = console) {
  const now = io.now();
  const path = DELETION_PATH(uid);
  let record;
  try {
    record = await io.get(path);
    if (!record) {
      record = { uid, requestedAt: now, updatedAt: now, steps: {} };
      await io.patch({ [path]: record });
    }
  } catch (e) { throw new StepError('record', e); }
  const done = { ...(record.steps || {}) };

  const mark = async (step) => {
    const t = io.now();
    await io.patch({ [`${path}/steps/${step}`]: t, [`${path}/updatedAt`]: t });
    done[step] = t;
  };

  const steps = {
    // 1. Money first. The record already exists, so the webhook this provokes finds it.
    async membership() {
      // W3 / MON-05. The record is ONE witness, not the only one. A subscription whose webhook
      // failed, or has not landed yet, or ended on `incomplete`, bills a deleted reader monthly
      // and appears nowhere in memberships/. So the providers are asked too, by the uid we put
      // on every subscription (Stripe metadata; Paystack's `ms.<uid>.` reference), and every
      // live one is cancelled. Cancelling is idempotent at both providers.
      const detail = await io.get(`memberships/${uid}`);
      const targets = new Map();
      const action = membershipAction(detail);
      if (action) targets.set(action.rail === 'stripe' ? action.id : action.code, action);
      for (const id of await io.stripeFindSubscriptions(uid)) targets.set(id, { rail: 'stripe', id });
      for (const code of await io.paystackFindSubscriptions(uid, email)) targets.set(code, { rail: 'paystack', code });
      for (const t of targets.values()) {
        if (t.rail === 'stripe') await io.stripeCancel(t.id);
        else await io.paystackDisable(t.code);
        log.log(`[account/delete] cancelled ${t.rail} subscription ${t.id || t.code} for ${uid} — NO refund (ruling, 24 Sep 2026)`);
      }
      // The billing record (KEPT, for accounting) now says what the providers just confirmed,
      // rather than 'active' until their webhooks arrive. The scrub's billing backstop reads
      // this, so it speaks only when a cancellation was genuinely missed. Nothing under users/.
      if (action || targets.size) {
        const at = io.now();
        const u = {
          [`memberships/${uid}/status`]: 'cancelled',
          [`memberships/${uid}/tier`]: 'free',
          [`memberships/${uid}/cancelAtPeriodEnd`]: false,
          [`memberships/${uid}/endedReason`]: 'account_deleted',
          [`memberships/${uid}/updatedAt`]: at,
        };
        for (const ref of targets.keys()) if (/^[A-Za-z0-9_]+$/.test(ref)) u[`memberships/${uid}/ended/${ref}`] = { at, reason: 'account_deleted' };
        await io.patch(u);
      }
    },
    async owned() {
      const user = await io.get(`users/${uid}`);
      const [following, followers, subscribers, waitlist] = await Promise.all([
        io.get(`following/${uid}`), io.get(`followers/${uid}`),
        email ? io.get('subscribers') : null, email ? io.get('bookstore_waitlist') : null,
      ]);
      const handles = {};
      await Promise.all(handlesOf(user).map(async (h) => { handles[h] = await io.get(`usernames/${h}`); }));
      await io.patch(planOwned(uid, { user, following, followers, handles, subscribers, waitlist }, email));
    },
    async storage() {
      for (const prefix of STORAGE_PREFIXES(uid)) {
        const names = await io.storageList(prefix);
        // avatars/{uid} is an exact object name; a prefix list also returns avatars/{uid}xyz
        // for a different uid that happens to extend this one. Keep only exact or folder matches.
        for (const name of names.filter((n) => n === prefix || prefix.endsWith('/') || n.startsWith(`${prefix}/`))) {
          await io.storageDelete(name);
        }
      }
    },
    // 3. LAST: after this the reader cannot authenticate, so nothing after it may need them.
    async auth() { await io.authDelete(uid); },
  };

  for (const step of STEPS) {
    if (done[step]) continue;
    try {
      await steps[step]();
      await mark(step);
    } catch (e) {
      throw new StepError(step, e);
    }
  }
  return { uid, steps: done };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The real io, for the Worker.
// ─────────────────────────────────────────────────────────────────────────────────────────

export const ADMIN_SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/devstorage.read_write',
  'https://www.googleapis.com/auth/identitytoolkit',
].join(' ');

const PROJECT_ID = 'calvary-scribblings';

async function ok(res, what) {
  if (res.ok) return res;
  throw new Error(`${what} → ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
}

export function realIo(env, token) {
  const db = dbBase(env);
  const auth = { Authorization: `Bearer ${token}` };
  const bucket = env.STORAGE_BUCKET || STORAGE_BUCKET;
  return {
    now: () => Date.now(),
    async get(path) {
      const res = await ok(await fetch(`${db}/${path}.json`, { headers: auth, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS) }), `GET ${path}`);
      return res.json();
    },
    async patch(update) {
      await ok(await fetch(`${db}/.json`, {
        method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(update), signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
      }), 'PATCH /');
    },
    async stripeCancel(subId) {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_VERSION },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (res.ok) return;
      const body = await res.json().catch(() => ({}));
      // Already cancelled, or gone: the goal state. Anything else is a failure to retry.
      if (res.status === 404 || body?.error?.code === 'resource_missing') return;
      if (/canceled|cancelled/i.test(body?.error?.message || '')) return;
      throw new Error(`Stripe cancel ${subId} → ${res.status} ${body?.error?.message || ''}`);
    },
    // Every Stripe subscription created for this uid that can still bill. The Search API is
    // eventually consistent (about a minute), which the writer's deleted-account guard covers:
    // a subscription that completes after this ran is cancelled when its webhook lands.
    async stripeFindSubscriptions(forUid) {
      if (!env.STRIPE_SECRET_KEY) return [];
      const q = new URLSearchParams({ query: `metadata['uid']:'${forUid}'`, limit: '100' });
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/search?${q}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_VERSION },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      await ok(res, 'Stripe subscription search');
      const body = await res.json();
      return (body.data || [])
        .filter((s) => !['canceled', 'incomplete_expired'].includes(s.status))
        .map((s) => s.id);
    },
    // Every Paystack subscription that is this reader's AND can still bill. Found through the
    // customer behind their email — and PROVEN theirs by a transaction whose reference is our
    // own `ms.<uid>.` (an email alone is never an identity here: two accounts can share one).
    async paystackFindSubscriptions(forUid, forEmail) {
      if (!env.PAYSTACK_SECRET_KEY || !forEmail) return [];
      const h = { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` };
      const got = await fetch(`https://api.paystack.co/customer/${encodeURIComponent(forEmail)}`, { headers: h, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
      if (got.status === 404) return [];
      const cus = (await got.json().catch(() => ({})))?.data;
      if (!got.ok || !cus) throw new Error(`Paystack customer lookup → ${got.status}`);
      const live = (cus.subscriptions || []).filter((x) => x.status === 'active' || x.status === 'attention');
      if (!live.length) return [];
      const tx = await fetch(`https://api.paystack.co/transaction?customer=${cus.id}&perPage=100`, { headers: h, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
      const refs = ((await tx.json().catch(() => ({})))?.data || []).map((t) => t.reference);
      if (!tx.ok) throw new Error(`Paystack transaction list → ${tx.status}`);
      const mine = refs.some((r) => typeof r === 'string' && r.startsWith(`ms.${forUid}.`));
      return mine ? live.map((x) => x.subscription_code) : [];
    },
    async paystackDisable(code) {
      const h = { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' };
      const got = await fetch(`https://api.paystack.co/subscription/${encodeURIComponent(code)}`, { headers: h, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
      const sub = (await got.json().catch(() => ({})))?.data;
      if (!got.ok || !sub) throw new Error(`Paystack fetch ${code} → ${got.status}`);
      // Only a subscription that will charge again needs disabling. `non-renewing` will not —
      // it is what a reader's own Cancel leaves behind (W3), and Paystack answers a second
      // disable with 404 "already inactive". Found on the live proof, 25 Sep 2026: a naira
      // reader who had cancelled could not delete their account (500 at step 'membership').
      if (sub.status !== 'active' && sub.status !== 'attention') return;
      const res = await fetch('https://api.paystack.co/subscription/disable', {
        method: 'POST', headers: h, body: JSON.stringify({ code, token: sub.email_token }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (res.status === 404) {
        const b = await res.json().catch(() => ({}));
        if (/already inactive|not found/i.test(b?.message || '')) return;
        throw new Error(`Paystack disable ${code} → 404 ${b?.message || ''}`);
      }
      await ok(res, `Paystack disable ${code}`);
    },
    async storageList(prefix) {
      const names = [];
      let pageToken = '';
      do {
        const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const res = await ok(await fetch(url, { headers: auth, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) }), `list ${prefix}`);
        const body = await res.json();
        for (const it of body.items || []) names.push(it.name);
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return names;
    },
    async storageDelete(name) {
      const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`, {
        method: 'DELETE', headers: auth, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (res.ok || res.status === 404) return;
      await ok(res, `delete ${name}`);
    },
    async authDelete(uid) {
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: uid }), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (res.ok) return;
      const text = await res.text().catch(() => '');
      if (/USER_NOT_FOUND/.test(text)) return;
      throw new Error(`Auth delete → ${res.status} ${text.slice(0, 200)}`);
    },
  };
}

export { json, lookupUser, mintAccessToken };
