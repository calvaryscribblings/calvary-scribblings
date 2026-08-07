'use client';
// MEMBERSHIP — the live half. One subscription, one timer, and no gates.
//
// ── WHY THIS IS NOT PART OF AuthContext ──────────────────────────────────────────────────
//
// AuthContext has 25 consumers and 12 of them are admin pages, which have no interest in
// tiers and would begin re-rendering every time a membership record changed. That alone is a
// reason to keep them apart, but it is not the load-bearing one.
//
// The load-bearing one is that AuthContext's isDeleted probe is a 3-SECOND RACE against a
// promise that can hang forever, and `loading` gates the whole site behind it — /my-library
// most sharply, where both the signed-out gate and the signed-in body sit behind `!loading`,
// so the offline shelf would never paint. That timeout was bought at a cost and it is tuned
// to exactly one read. Adding a second read to that provider means either widening the same
// bound to cover both — coupling the shelf's ability to paint to a membership lookup nobody
// is waiting for — or growing a second loading flag inside a provider whose whole discipline
// is that there is one. Neither is worth it to save a file.
//
// So: a separate provider, mounted INSIDE AuthProvider because it needs the uid, and holding
// its own loading state that nothing structural is gated on.
//
// ── ONE onValue DELIVERS BOTH HALVES ─────────────────────────────────────────────────────
//
// memberships/{uid} carries a MIRRORED `tier` alongside the `pass` (see buildDetail in
// functions/api/membership/_membership.js — the mirror exists so the billing record can be
// read on its own for support). So entitlement resolves from ONE subscription:
//
//     effectiveTier(detail.tier, detail, Date.now())
//
// The node is owner-readable (`auth.uid == $uid`), so no admin credential is involved and a
// reader can only ever subscribe to their own.
//
// THE SCALAR AT users/{uid}/membership IS NOT READ HERE, and that is deliberate rather than an
// oversight. It remains THE CONTRACT — the Story Island app reads it with strict equality and
// this repo must never write an object there — but as a source for THIS provider it would be a
// second subscription to a second node delivering a value the first one already mirrors, with
// a window in which the two disagree. The detail record is written in the same atomic
// multi-path update as the scalar, so the mirror cannot lag it.
//
// ── EXPIRY IS A NON-EVENT, WHICH IS WHY THERE IS A TIMER ─────────────────────────────────
//
// NOTHING WRITES WHEN A PASS LAPSES. There is no expiry webhook, no scheduled job, no
// tombstone — the pass simply stops being true, because a membership that decays on a timer
// cannot be stored as a fact (app/lib/membership.js says why at length). onValue therefore
// never fires at the moment of expiry: the data has not changed, only the clock has.
//
// A screen held open across that moment would keep rendering the entitlement the reader had
// when it mounted. Someone who buys a day pass at 23:00, leaves the tab open and comes back
// the following night would still be shown Gold. The timer below closes exactly that: it
// fires once, AT expiresAt, and forces a recompute. Nothing is written and nothing is fetched
// — the same detail record simply resolves to a different tier because `now` has moved.
//
// `expiresAt` IS EPOCH MILLISECONDS, A NUMBER. Comparing it against Date.now() is the whole
// contract; an ISO string would compare as a string and never expire, which is the trap this
// codebase has hit before and the reason activePass() rejects a non-numeric expiry outright.
//
// setTimeout is clamped to a 32-bit delay (~24.9 days), so a longer horizon is re-armed in
// chunks rather than firing immediately — a week pass is well inside it, but a stacked one
// need not be, and a silently-overflowed timer is worse than none.
//
// ── NO GATES HERE ────────────────────────────────────────────────────────────────────────
//
// This provider REPORTS entitlement. It does not enforce it: no cap lookup, no shelf slot
// arithmetic, no paywalling. capFor(kind, tier) is Round 7 and the ruling it must honour is
// already written above CAPS in app/lib/shelf.js. Keeping the reporting round free of gates
// means Round 7 changes what the caps ARE without touching how the tier is learned.

// THE PURE HALF LIVES IN ./membership.js, not here. This file contains JSX, so bare Node
// cannot parse it and `node --test` cannot import a single symbol from it — which would make
// the timer arithmetic, the signed-out shape and the subscribed path untestable if they were
// declared here. They are imported and re-exported instead, so consumers may take them from
// either place and there is only ever one definition.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import {
  describeMembership, effectiveTier, activePass,
  MEMBERSHIP_DETAIL_PATH, SIGNED_OUT, MAX_TIMEOUT_MS, timerSliceFor,
} from './membership';

const MembershipContext = createContext(null);

export const DETAIL_PATH = MEMBERSHIP_DETAIL_PATH;
export { SIGNED_OUT, MAX_TIMEOUT_MS, timerSliceFor };

export function MembershipProvider({ children }) {
  const { user } = useAuth();
  const uid = user?.uid || null;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(!!uid);
  // Bumped by the expiry timer to force a recompute. It is not the clock itself — reading
  // Date.now() at render time is what makes the value correct; this only causes that read to
  // happen again at the moment it starts to matter.
  const [tick, setTick] = useState(0);

  // ── the subscription ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) { setDetail(null); setLoading(false); return; }
    setLoading(true);
    const node = ref(db, DETAIL_PATH(uid));
    const unsubscribe = onValue(
      node,
      (snap) => { setDetail(snap.exists() ? snap.val() : null); setLoading(false); },
      (err) => {
        // A reader with no membership record is the COMMON case, not an error — but a rules
        // rejection or a dropped socket arrives here too. Either way the honest answer is
        // 'free' rather than a stuck spinner, which is what the shelf learned the hard way.
        console.warn('[membership] subscription failed:', err?.message || err);
        setDetail(null);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [uid]);

  // ── the expiry timer ───────────────────────────────────────────────────────
  // Armed only when a pass is live and in the future. Re-armed on every change to the pass,
  // and cleared when there is none — a reader with no pass carries no timer at all.
  useEffect(() => {
    const pass = activePass(detail, Date.now());
    if (!pass) return undefined;

    let timer;
    const arm = () => {
      const { delay, final } = timerSliceFor(pass.expiresAt, Date.now());
      if (final && delay === 0) { setTick((t) => t + 1); return; }
      timer = setTimeout(final ? () => setTick((t) => t + 1) : arm, delay);
    };
    arm();
    return () => clearTimeout(timer);
    // `tick` is a dependency so that a re-arm after a long-horizon slice re-enters this
    // effect rather than relying on a closure over a stale pass.
  }, [detail, tick]);

  const value = useMemo(() => {
    if (!uid) return SIGNED_OUT;
    // Date.now() is read HERE, at render, so the value is correct for this paint. The timer
    // above only decides WHEN this runs again.
    const now = Date.now();
    return {
      ...describeMembership(detail?.tier, detail, now),
      loading,
      signedIn: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, detail, loading, tick]);

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}

/**
 * The whole membership picture for a surface, recomputed when it changes and when it lapses.
 *
 *   { tier, subscriptionTier, pass, source, status, founding, currentPeriodEnd,
 *     loading, signedIn }
 *
 * `tier` is what the reader is entitled to RIGHT NOW — subscription or live pass, whichever is
 * better. `subscriptionTier` is what they are entitled to WITHOUT the pass, and `source` says
 * which of the two is doing the work ('subscription' | 'pass' | 'none') so copy can be honest:
 * "your Gold membership" and "your day pass" are not the same sentence, and a Platinum member
 * holding a Gold pass is a Platinum member.
 *
 * Returns the signed-out shape when called outside the provider rather than null, so a
 * component rendered in isolation — a test, a Storybook-style page, an admin route that never
 * mounts it — degrades to 'free' instead of throwing on a property read.
 */
export function useMembership() {
  return useContext(MembershipContext) || SIGNED_OUT;
}

/** Just the tier, for the many surfaces that want nothing else. */
export function useTier() {
  return useMembership().tier;
}

export { effectiveTier, describeMembership };
