'use client';
// THE MEMBERSHIP SECTION ON /settings — what you have, and how to stop having it.
//
// A component rather than more JSX in settings/page.js because it owns real behaviour: a
// network call to the portal, three answers from it, and six states that must each be worded
// differently. That page is a static list of rows and should stay readable as one.
//
// ── THE MANAGE PATH IS DECIDED BY THE RAIL, AND THE TWO ARE NOT EQUAL YET ────────────────
//
// Stripe members get the customer portal. Paystack members get an HONEST INTERIM — an email
// address — because Paystack has no portal at all and the self-serve disable path
// (/subscription/disable, which needs the subscription code AND an email_token fetched on
// demand) is boarded as its own round before launch.
//
// What this must NOT do is show a naira member a disabled button, or nothing. A disabled
// button says "this is broken"; silence says "your money is unmanageable". An email address is
// a real route to cancelling, today, by a human. When the disable path lands, THE COPY BELOW
// IS THE ONLY THING THAT CHANGES — the rail branch is already here.
//
// ── DUNNING DOES NOT DOWNGRADE ───────────────────────────────────────────────────────────
//
// `past_due` keeps the tier. That is a deliberate rule in the writer (a failed payment is a
// card problem, not a decision to leave) and the UI must not quietly contradict it by hiding
// the tier or greying the section out. It says the tier IS still theirs and that a payment
// needs attention — two facts, both true, in that order.
//
// ── "CANCELLED" IS NOT A WORD FOR SOMEONE WITH PAID TIME LEFT ────────────────────────────
//
// cancelAtPeriodEnd means they have told Stripe not to renew. They are still a full member
// until the period ends and they are still entitled to everything. Saying "cancelled" would
// read as "it's gone" to someone who paid through next month, so this says when it RUNS UNTIL.

import { useState } from 'react';
import { useMembership } from '../lib/MembershipContext';
import { openMembershipPortal, idTokenFor, MembershipCheckoutError } from '../lib/membershipCheckout';

const TIER_NAME = { free: 'Free', gold: 'Gold', platinum: 'Platinum' };
const INTERVAL_NAME = { monthly: 'Monthly', annual: 'Yearly' };
const CURRENCY_NAME = { gbp: 'GBP', usd: 'USD', ngn: 'NGN' };
const PASS_NAME = { day: 'Day pass', week: 'Week pass' };

// Boarded separately; when the disable path ships this address is replaced by a button and
// nothing else in this file moves.
const CANCEL_EMAIL = 'contact@calvaryscribblings.co.uk';

const longDate = (ms) => new Date(ms).toLocaleDateString(undefined, {
  day: 'numeric', month: 'long', year: 'numeric',
});
const dateTime = (ms) => new Date(ms).toLocaleString(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
});

export default function MembershipSection({ authUser }) {
  const {
    tier, subscriptionTier, pass, source, status, founding,
    currentPeriodEnd, interval, currency, rail, cancelAtPeriodEnd, loading,
  } = useMembership();

  const [portal, setPortal] = useState({ state: 'idle', message: '' });

  const openPortal = async () => {
    setPortal({ state: 'opening', message: '' });
    try {
      const idToken = await idTokenFor(authUser);
      const res = await openMembershipPortal(idToken);
      if (res.url) { window.location.assign(res.url); return; }
      // A 200 with no url. Two different facts wearing the same shape — see the note in
      // openMembershipPortal. Neither is a failure and neither may render as one.
      setPortal({
        state: res.pending ? 'pending' : 'none',
        message: res.error || '',
      });
    } catch (e) {
      setPortal({
        state: 'error',
        message: e instanceof MembershipCheckoutError ? e.message : 'Could not open membership management. Please try again.',
      });
    }
  };

  // THE LOADING BEAT. `tier` is the 'free' default while the record is in flight, so rendering
  // now would tell a Platinum member they are on Free — the same lie the shelf surfaces refuse
  // to tell. A placeholder row holds the space instead.
  if (loading) {
    return (
      <div className="st-section">
        <div className="st-section-header">
          <div className="st-section-title">Membership</div>
          <div className="st-section-meta">Your plan</div>
        </div>
        <div className="st-row">
          <div className="st-row-main">
            <div className="ms-tier" style={{ opacity: .5 }}>—</div>
            <div className="st-row-hint">Loading your membership</div>
          </div>
        </div>
      </div>
    );
  }

  const hasSubscription = subscriptionTier !== 'free';
  const activePass = pass || null;

  return (
    <div className="st-section">
      <style>{`
        /* ── AA, AND WHY THIS DOES NOT REUSE .st-row-label ────────────────────────────────
           The page's own .st-row-label is rgba(255,255,255,0.30), which measures 2.67:1 on the
           row background — below the 4.5:1 AA needs for text this size. That is pre-existing
           and site-wide (it styles the email address and "Password" rows too), so fixing it
           belongs to whoever owns this page's palette, not to this section. What this section
           will NOT do is inherit it for the single most important string in it: the tier a
           reader is paying for. Hence a local class at 16.5:1.
           The one-line fix if anyone wants it: .st-row-label alpha 0.30 → 0.46 clears AA. */
        .ms-tier { font-size: 0.95rem; font-weight: 500; color: #f5f0e8; font-family: 'Cormorant Garamond', Georgia, serif; display: flex; align-items: center; flex-wrap: wrap; gap: 0.2rem; }
        .ms-note { font-size: 0.78rem; font-weight: 500; color: rgba(232,224,212,0.58); font-family: 'Cormorant Garamond', Georgia, serif; line-height: 1.6; margin: 0.5rem 0 0 0.25rem; }
        .ms-note a { color: #c4b5fd; }
        .ms-warn { font-size: 0.78rem; font-weight: 500; color: #f0b7a4; font-family: 'Cormorant Garamond', Georgia, serif; line-height: 1.6; margin: 0.5rem 0 0 0.25rem; }
        .ms-badge { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #241a06; background: #c9a84c; border-radius: 999px; padding: 3px 8px; margin-left: 0.5rem; white-space: nowrap; }
        .ms-join { display: inline-block; margin-top: 0.9rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #a78bfa; text-decoration: none; border: 1px solid rgba(167,139,250,0.32); border-radius: 9px; padding: 0.7rem 1.05rem; font-family: 'Cormorant Garamond', Georgia, serif; }
        .ms-join:hover { background: rgba(107,47,173,0.12); }
      `}</style>

      <div className="st-section-header">
        <div className="st-section-title">Membership</div>
        <div className="st-section-meta">Your plan</div>
      </div>

      {/* ── WHAT THEY HAVE ──────────────────────────────────────────────────────────────── */}
      <div className="st-row">
        <div className="st-row-main">
          <div className="ms-tier">
            {TIER_NAME[tier]}
            {founding && <span className="ms-badge">Founding</span>}
          </div>
          <div className="st-row-hint">
            {hasSubscription
              ? [INTERVAL_NAME[interval] || null, CURRENCY_NAME[currency] || null].filter(Boolean).join(' · ') || 'Subscription'
              : source === 'pass'
                ? 'From your pass'
                : 'Free plan'}
          </div>
        </div>
        {!hasSubscription && !activePass && (
          <a className="st-row-action" href="/membership">See plans</a>
        )}
      </div>

      {/* PAST DUE — the tier stays visible above; this says what needs doing without implying
          anything has been taken away. */}
      {status === 'past_due' && (
        <div className="ms-warn">
          A payment didn’t go through. You still have everything your plan gives you — update
          your card to keep it that way.
        </div>
      )}

      {/* RENEWAL vs RUNS-UNTIL. Same date, opposite meaning, and the wrong one is a small
          betrayal either way. */}
      {hasSubscription && currentPeriodEnd && (
        <div className="ms-note">
          {cancelAtPeriodEnd
            ? `Your membership runs until ${longDate(currentPeriodEnd)}. Nothing more will be charged.`
            : status === 'past_due'
              ? `Your plan is paid up to ${longDate(currentPeriodEnd)}.`
              : `Renews on ${longDate(currentPeriodEnd)}.`}
        </div>
      )}

      {/* ── AN ACTIVE PASS ──────────────────────────────────────────────────────────────── */}
      {activePass && (
        <div className="st-row">
          <div className="st-row-main">
            <div className="ms-tier">{PASS_NAME[activePass.kind] || 'Pass'}</div>
            <div className="st-row-hint">
              Active until {dateTime(activePass.expiresAt)}
            </div>
          </div>
        </div>
      )}
      {activePass && (
        <div className="ms-note">
          When it ends you go back to your usual plan. Anything you saved while it was live
          stays on your shelf — nothing is removed.
        </div>
      )}

      {/* ── MANAGING IT ─────────────────────────────────────────────────────────────────── */}
      {hasSubscription && rail === 'stripe' && (
        <>
          <div className="st-row">
            <div className="st-row-main">
              <div className="ms-tier">Payment and cancellation</div>
              <div className="st-row-hint">Card details, invoices, cancel</div>
            </div>
            <button
              className="st-row-action"
              onClick={openPortal}
              disabled={portal.state === 'opening'}
            >
              {portal.state === 'opening' ? 'Opening…' : 'Manage'}
            </button>
          </div>
          {portal.state === 'pending' && (
            <div className="ms-note">
              {portal.message || 'We’re still setting up your membership. Try again in a moment.'}
            </div>
          )}
          {portal.state === 'none' && (
            <div className="ms-note">
              {portal.message || 'You don’t have a membership to manage yet.'}
            </div>
          )}
          {portal.state === 'error' && <div className="ms-warn">{portal.message}</div>}
        </>
      )}

      {hasSubscription && rail === 'paystack' && (
        <div className="ms-note">
          To change your card or cancel your membership, email{' '}
          <a href={`mailto:${CANCEL_EMAIL}`}>{CANCEL_EMAIL}</a> and we’ll take care of it.
          Self-service for naira memberships is on its way.
        </div>
      )}

      {/* Nothing to manage, and no reason to be coy about it. */}
      {!hasSubscription && (
        <div className="ms-note">
          {activePass
            ? 'A pass is a one-off — there is nothing to cancel and it will not renew.'
            : 'You’re on the free plan. Every story stays free either way.'}
          {!activePass && <><br /><a className="ms-join" href="/membership">See what membership gives</a></>}
        </div>
      )}
    </div>
  );
}
