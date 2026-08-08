'use client';
// MEMBERSHIP — the pricing surface, and the page four payment redirects already point at.
//
// ── THIS ROUTE IS A LAUNCH GATE, NOT A NICE-TO-HAVE ──────────────────────────────────────
//
// Before R11.7 it did not exist, and all four checkout endpoints already redirected here:
//
//   checkout.js:158                /membership?join=success
//   paystack-checkout.js:105       /membership?join=success
//   pass-checkout.js:118           /membership?pass=success
//   paystack-pass-checkout.js:108  /membership?pass=success
//
// A reader who paid landed on a 404. Nothing could go on sale until this shipped, which is why
// it is a build round of its own rather than the tail end of the caps round.
//
// ── PLATFORM TERRITORY, GATEWAY GRAMMAR ──────────────────────────────────────────────────
//
// Night canvas, gold and cream, Cinzel labels over Cormorant prose — the same vocabulary as
// /my-library, which is the surface readers arrive here FROM. Not the bookstore's retail
// gold-on-black (this does not sell a book) and not the purple platform chrome of /settings.
//
// ── NOTHING IS PAYWALLED, AND THE COPY HAS TO CARRY THAT ─────────────────────────────────
//
// The tiers are PERK-SHAPED. Every story on this site is free to read on every tier, today and
// at launch, and a membership buys shelf slots and the work continuing — not access. So there
// is no "unlock", no "get access to", no lock iconography anywhere on this page. The one real
// perk that exists today is the offline shelf: Free 2 · Gold 20 · Platinum unlimited.
//
// BOOKS ARE NOT A MEMBERSHIP PERK and must never be written as one. Purchased books stream —
// master EPUBs are stored read:false and access is a 300-second signed URL — so "uncapped
// books" describes the absence of a web book shelf to cap, not a tier benefit. Saying "and all
// your books" here would promise a thing that does not exist.
//
// ── PRICES COME FROM THE TABLE THE RAILS CHARGE FROM ─────────────────────────────────────
//
// app/lib/membershipPrices.js and app/lib/membershipPasses.js, both hand-set, both imported by
// the endpoints that take the money. Nothing on this page computes a price, converts one, or
// derives an annual from a monthly.

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useMembership } from '../lib/MembershipContext';
import { plansAreKnown } from '../lib/membership';
import { useCurrency, CURRENCIES, CURRENCY_LABELS } from '../lib/currency';
import { formatPrice } from '../bookstore/components/fields';
import {
  TIERS, INTERVALS, subscriptionAmount, MEMBERSHIPS_ON_SALE, LAUNCH_NOTICE,
} from '../lib/membershipPrices';
import { passesFor } from '../lib/membershipPasses';
import { capFor, isUnlimitedCap } from '../lib/shelf';
import { startMembershipCheckout, idTokenFor, MembershipCheckoutError } from '../lib/membershipCheckout';
import Link from 'next/link';
import AuthModal from '../components/AuthModal';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

const TIER_NAME = { free: 'Free', gold: 'Gold', platinum: 'Platinum' };

// What each tier actually gives, in plain words. The shelf line is generated from capFor() so
// it cannot drift from the number the save button enforces — the one place a marketing figure
// and a working limit could disagree, they are the same call.
function shelfLine(tier) {
  const cap = capFor('story', tier);
  if (isUnlimitedCap(cap)) return 'Save as many stories as you like for offline reading';
  return `Save ${cap} ${cap === 1 ? 'story' : 'stories'} for offline reading`;
}

const PERKS = {
  free: [
    'Every story on the site, free to read',
    'Quizzes, badges and the leaderboard',
  ],
  gold: [
    'Everything in Free',
    'A Gold mark on your profile',
    'You keep this site independent',
  ],
  platinum: [
    'Everything in Gold',
    'A Platinum mark on your profile',
    'First word on what we publish next',
  ],
};

// ── THE PASS, IN WORDS ───────────────────────────────────────────────────────────────────
// A pass grants the GOLD shelf for a window and then simply stops — nothing is written when it
// lapses and nothing is taken away afterwards. The second half of that sentence is the part
// readers need before they buy, and it is a promise the code keeps (see the ruling above CAPS
// in app/lib/shelf.js): stories saved during a pass are kept when it ends.
const PASS_NAME = { day: 'Day pass', week: 'Week pass' };
const PASS_WINDOW = { day: '24 hours', week: '7 days' };

// ── THE QUERY-STRING STORE ───────────────────────────────────────────────────────────────
// A snapshot must be referentially stable across calls or useSyncExternalStore loops. These
// return a STRING or null, which compares by value, so re-reading is free and safe.
const subscribeToNothing = () => () => {};
const readReturnOnServer = () => null;
function readReturn() {
  const q = new URLSearchParams(window.location.search);
  if (q.get('join') === 'success') return 'join';
  if (q.get('pass') === 'success') return 'pass';
  if (q.get('join') === 'cancelled' || q.get('pass') === 'cancelled') return 'cancelled';
  return null;
}

function Perk({ children }) {
  return (
    <li className="mb-perk">
      <span className="mb-perk-m" aria-hidden="true">✦</span>
      <span>{children}</span>
    </li>
  );
}

export default function MembershipPage() {
  const { user, loading: authLoading } = useAuth();
  const membership = useMembership();
  // `loading` and `signedIn` are read by plansAreKnown() off the whole object, not destructured
  // here — the gate is one call, and pulling its inputs out separately is how a later edit ends
  // up reconstructing the rule by hand.
  const { tier, subscriptionTier, pass, source, founding } = membership;

  const [currency, chooseCurrency] = useCurrency();
  const [interval, setInterval] = useState('monthly');
  const [showAuth, setShowAuth] = useState(false);
  const [busy, setBusy] = useState(null);   // the key of the button that is working
  const [error, setError] = useState('');

  // ── THE RETURN FROM CHECKOUT ───────────────────────────────────────────────────────────
  //
  // 'join' | 'pass' | 'cancelled' | null, read from the query string.
  //
  // useSyncExternalStore rather than an effect, and the reason is the same one app/lib/
  // currency.js gives for using it: this is a value the SERVER cannot know and the client can.
  // The prerender has no URL, so getServerSnapshot answers null and the static HTML contains no
  // banner; the client snapshot takes over immediately after hydration and the banner appears.
  // That handover is documented behaviour rather than a mismatch, which is exactly what an
  // effect-plus-setState would have been fighting.
  //
  // The store never emits — a query string does not change under a page that is not navigating
  // — so `subscribe` returns a no-op unsubscribe and nothing ever re-renders from here.
  //
  // useSearchParams() would have done it too, at the cost of forcing a Suspense boundary onto a
  // page with nothing to suspend on.
  const returned = useSyncExternalStore(subscribeToNothing, readReturn, readReturnOnServer);

  // Has the thing they came back for actually landed? A subscription lifts subscriptionTier; a
  // pass appears as `pass`. Until then the banner says so honestly rather than claiming a
  // membership we cannot yet see.
  const settled = returned === 'join' ? subscriptionTier !== 'free'
    : returned === 'pass' ? !!pass
    : false;

  const passes = useMemo(() => passesFor(currency), [currency]);

  const buy = async (key, args) => {
    setError('');
    if (!user) { setShowAuth(true); return; }
    setBusy(key);
    try {
      const idToken = await idTokenFor(user);
      const url = await startMembershipCheckout({ ...args, currency, idToken });
      // .assign() rather than an href assignment — the same call the bookstore's BuyButton
      // makes for the same hop, and the form the lint rule accepts.
      window.location.assign(url);
    } catch (e) {
      // Every endpoint answers { error, code }; the message is already reader-facing and
      // already honest about which rail failed and why, so it is shown rather than replaced.
      setError(e instanceof MembershipCheckoutError ? e.message : 'Something went wrong. Please try again.');
      setBusy(null);
    }
  };

  // The one rule Round 7 held at three surfaces and this page must hold too. Both halves of it
  // — the loading beat and the signed-out reader — are stated and asserted at plansAreKnown()
  // in app/lib/membership.js; this page holds the rule by CALLING it rather than by restating
  // it, so the beat cannot be re-broken here by an edit that only reads correct.
  //
  // Every current-state marker on this page ("YOUR PLAN", "ACTIVE", the settings link) waits
  // for `known`. Nothing that is merely a price does.
  const known = plansAreKnown(membership, authLoading);

  return (
    <div className="mb-page">
      <style>{`
        .mb-page { min-height: 100vh; background: radial-gradient(130% 60% at 50% -10%, #241347 0%, #0b0716 58%, #080610 100%); background-attachment: fixed; color: #f5f0e8; font-family: ${DISPLAY}; }
        .mb-topbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 18px 12px; }
        @media (min-width: 768px) { .mb-topbar { padding: 16px 40px 12px; } }
        .mb-wordmark { font-family: ${LABEL}; font-size: 11px; letter-spacing: .28em; color: #f5f0e8; text-decoration: none; white-space: nowrap; }
        .mb-back { font-family: ${LABEL}; font-size: 9px; letter-spacing: .2em; color: #e2c876; text-decoration: none; }
        .mb-hairline { height: 1px; background: linear-gradient(90deg, transparent, rgba(201,168,76,.5), transparent); }
        .mb-body { padding: 26px 18px 60px; max-width: 1100px; margin: 0 auto; }
        @media (min-width: 768px) { .mb-body { padding: 34px 40px 72px; } }

        .mb-eyebrow { font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .3em; color: #c9a84c; text-align: center; }
        .mb-rule { width: 60px; height: 1px; background: #c9a84c; opacity: .55; margin: 9px auto 18px; }
        .mb-h1 { font-size: clamp(27px, 6.5vw, 40px); line-height: 1.1; text-align: center; color: #fbf7f0; margin: 0 0 12px; font-weight: 400; }
        .mb-lede { max-width: 620px; margin: 0 auto; text-align: center; font-size: 15.5px; line-height: 1.62; color: #ded5c6; }

        /* THE FOUNDING PROMISE. A sentence, not a badge — it is the strongest thing we can say
           before 30 September and it should read as a plain commitment. */
        .mb-founding { max-width: 640px; margin: 22px auto 0; padding: 15px 18px; border: 1px solid rgba(201,168,76,.34); border-radius: 12px; background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10)); text-align: center; }
        .mb-founding-l { font-family: ${LABEL}; font-size: 8.5px; letter-spacing: .24em; color: #e2c876; }
        .mb-founding-p { font-size: 15px; line-height: 1.6; color: #ece3d4; margin: 8px 0 0; }

        .mb-notice { max-width: 640px; margin: 22px auto 0; padding: 14px 18px; border: 1px solid rgba(201,168,76,.3); border-radius: 12px; background: rgba(201,168,76,.06); text-align: center; }
        .mb-notice-t { font-family: ${LABEL}; font-size: 9px; letter-spacing: .22em; color: #e2c876; }
        .mb-notice-p { font-size: 14.5px; line-height: 1.6; color: #e4dbcc; margin: 7px 0 0; }

        .mb-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: center; margin: 30px 0 8px; }
        .mb-seg { display: inline-flex; border: 1px solid rgba(201,168,76,.32); border-radius: 999px; padding: 3px; gap: 2px; }
        .mb-seg button { font-family: ${LABEL}; font-size: 9px; letter-spacing: .16em; padding: 8px 14px; border-radius: 999px; border: none; background: transparent; color: #cbbfa8; cursor: pointer; }
        .mb-seg button.is-on { background: rgba(201,168,76,.9); color: #241a06; }
        .mb-seg button:focus-visible { outline: 2px solid #f0dda0; outline-offset: 2px; }
        .mb-annual-note { text-align: center; font-size: 13.5px; color: #d3c9b8; margin: 10px 0 0; font-style: italic; }

        .mb-grid { display: grid; gap: 14px; margin-top: 26px; grid-template-columns: 1fr; }
        @media (min-width: 760px) { .mb-grid { grid-template-columns: repeat(3, 1fr); } }
        .mb-card { display: flex; flex-direction: column; border: 1px solid rgba(245,240,232,.13); border-radius: 14px; padding: 20px 18px 18px; background: linear-gradient(160deg, rgba(245,240,232,.05), rgba(91,43,160,.09)); }
        .mb-card.is-feature { border-color: rgba(201,168,76,.5); }
        .mb-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .mb-card-n { font-family: ${LABEL}; font-size: 11px; letter-spacing: .22em; color: #e2c876; }
        .mb-yours { font-family: ${LABEL}; font-size: 8px; letter-spacing: .16em; color: #241a06; background: #c9a84c; border-radius: 999px; padding: 3px 8px; white-space: nowrap; }
        .mb-price { font-size: 33px; line-height: 1.1; color: #fbf7f0; margin: 14px 0 2px; }
        .mb-per { font-size: 13.5px; color: #cfc4b1; }
        .mb-perks { list-style: none; padding: 0; margin: 16px 0 18px; display: flex; flex-direction: column; gap: 9px; }
        .mb-perk { display: flex; gap: 9px; font-size: 14.5px; line-height: 1.5; color: #e0d7c8; }
        .mb-perk-m { color: #c9a84c; font-size: 10px; line-height: 1.9; flex-shrink: 0; }
        .mb-cta { margin-top: auto; }
        .mb-btn { width: 100%; font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .18em; padding: 13px; border-radius: 10px; border: 1px solid #c9a84c; background: #c9a84c; color: #241a06; cursor: pointer; }
        .mb-btn:hover:not(:disabled) { background: #d8b962; }
        .mb-btn.is-ghost { background: transparent; color: #f0dda0; }
        .mb-btn.is-ghost:hover:not(:disabled) { background: rgba(201,168,76,.12); }
        .mb-btn:disabled { opacity: .5; cursor: default; }
        .mb-btn:focus-visible { outline: 2px solid #f0dda0; outline-offset: 2px; }
        .mb-flat { font-size: 13px; color: #cfc4b1; text-align: center; padding: 13px 0 0; }

        .mb-sec { margin-top: 46px; }
        .mb-sec-h { font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .26em; color: #c9a84c; text-align: center; }
        .mb-sec-p { max-width: 600px; margin: 10px auto 0; text-align: center; font-size: 14.5px; line-height: 1.6; color: #d8cfc0; }
        /* One pass or two, depending on currency. A single day-pass card stretched across the
           full 720px read as a banner rather than a card, so the width follows the count. */
        .mb-passes { display: grid; gap: 14px; margin: 20px auto 0; grid-template-columns: 1fr; max-width: 360px; }
        .mb-passes.is-two { max-width: 720px; }
        @media (min-width: 620px) { .mb-passes.is-two { grid-template-columns: repeat(2, 1fr); } }

        .mb-banner { max-width: 640px; margin: 0 auto 24px; padding: 16px 18px; border-radius: 12px; border: 1px solid rgba(201,168,76,.4); background: rgba(201,168,76,.08); }
        .mb-banner.is-done { border-color: rgba(126,196,146,.45); background: rgba(126,196,146,.09); }
        .mb-banner-t { font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .2em; color: #e2c876; }
        .mb-banner.is-done .mb-banner-t { color: #9fd9b0; }
        .mb-banner-p { font-size: 14.5px; line-height: 1.6; color: #e6ddce; margin: 8px 0 0; }

        .mb-err { max-width: 640px; margin: 18px auto 0; text-align: center; font-size: 14px; color: #f3b0a2; }
        .mb-foot { margin-top: 44px; text-align: center; font-size: 13.5px; line-height: 1.65; color: #cabfae; }
        .mb-foot a { color: #f0dda0; }
      `}</style>

      <div className="mb-topbar">
        <Link className="mb-wordmark" href="/">CALVARY SCRIBBLINGS</Link>
        <a className="mb-back" href="/my-library">MY LIBRARY →</a>
      </div>
      <div className="mb-hairline" />

      <div className="mb-body">
        {/* ── THE RETURN BANNER ───────────────────────────────────────────────────────────
            Idempotent on refresh and harmless when visited directly, because it never claims
            a payment happened — it says what will appear IF one did, and then reports what
            actually landed. A reader who types the URL sees a sentence that is true for them
            too, and it resolves the moment the provider answers. */}
        {returned === 'join' && (
          <div className={`mb-banner${settled ? ' is-done' : ''}`} role="status">
            <div className="mb-banner-t">{settled ? 'YOU’RE IN' : 'SETTING UP YOUR MEMBERSHIP'}</div>
            <p className="mb-banner-p">
              {settled
                ? `Your ${TIER_NAME[subscriptionTier]} membership is active${founding ? ', and you joined at the founding price — it stays yours' : ''}. Thank you for keeping this place going.`
                : 'If your payment went through, your membership will appear here in a moment — this page updates on its own, so there is nothing to refresh.'}
            </p>
          </div>
        )}
        {returned === 'pass' && (
          <div className={`mb-banner${settled ? ' is-done' : ''}`} role="status">
            <div className="mb-banner-t">{settled ? 'YOUR PASS IS LIVE' : 'SETTING UP YOUR PASS'}</div>
            <p className="mb-banner-p">
              {settled
                ? `Your pass is active until ${new Date(pass.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. Anything you save while it lasts stays on your shelf afterwards.`
                : 'If your payment went through, your pass will appear here in a moment — this page updates on its own, so there is nothing to refresh.'}
            </p>
          </div>
        )}
        {returned === 'cancelled' && (
          <div className="mb-banner" role="status">
            <div className="mb-banner-t">NOTHING WAS CHARGED</div>
            <p className="mb-banner-p">You closed the checkout before it finished. Nothing has been taken and you can pick up again whenever you like.</p>
          </div>
        )}

        <div className="mb-eyebrow">MEMBERSHIP</div>
        <div className="mb-rule" />
        <h1 className="mb-h1">Every story here is free. Membership keeps it that way.</h1>
        <p className="mb-lede">
          Nothing on this site is behind a paywall, and nothing is going behind one. A membership
          is not a key — it is a way of backing the work, and it comes with a bigger offline
          shelf so you can carry more of it with you.
        </p>

        {/* ── THE FOUNDING PROMISE ─────────────────────────────────────────────────────────
            Stated once, plainly, as a sentence. It is engineered rather than aspirational:
            founding Prices exist for BOTH tiers and the Stripe portal is pinned to that
            generation, so an upgrade lands on a founding price too. That is why the second
            clause can be said at all — see the founding-lock note in prices.js. */}
        <div className="mb-founding">
          <div className="mb-founding-l">FOUNDING MEMBERS</div>
          <p className="mb-founding-p">
            Join before we open and your price never goes up — not at renewal, and not if you
            move to a higher tier later. You keep the founding rate for as long as you stay a
            member.
          </p>
        </div>

        {!MEMBERSHIPS_ON_SALE && (
          <div className="mb-notice" role="status">
            <div className="mb-notice-t">NOT YET ON SALE</div>
            <p className="mb-notice-p">
              {LAUNCH_NOTICE} Everything below is the real price — nothing here changes on the
              day. We wanted you to be able to read it first.
            </p>
          </div>
        )}

        {/* Currency: the SHARED selector. A reader who is ₦ in the shop is ₦ here, and there is
            no second control — choosing here changes the shop too, which is the point. */}
        <div className="mb-controls">
          <div className="mb-seg" role="group" aria-label="Currency">
            {CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                className={c === currency ? 'is-on' : ''}
                aria-pressed={c === currency}
                onClick={() => chooseCurrency(c)}
              >{CURRENCY_LABELS[c]}</button>
            ))}
          </div>
          <div className="mb-seg" role="group" aria-label="Billing period">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                className={iv === interval ? 'is-on' : ''}
                aria-pressed={iv === interval}
                onClick={() => setInterval(iv)}
              >{iv === 'monthly' ? 'MONTHLY' : 'YEARLY'}</button>
            ))}
          </div>
        </div>
        {interval === 'annual' && (
          <p className="mb-annual-note">A year for the price of ten months.</p>
        )}

        <div className="mb-grid">
          {/* FREE IS A REAL ROW, not an absence. It is what most readers will stay on, and a
              pricing page that lists it as a gap reads as a page that resents it. */}
          <div className="mb-card">
            <div className="mb-card-top">
              <div className="mb-card-n">FREE</div>
              {known && tier === 'free' && <span className="mb-yours">YOUR PLAN</span>}
            </div>
            {/* "Free", NOT formatPrice(currency, 0).
                Two reasons, and the second is the one that made this a bug rather than a
                preference. A zero is not a price — every other card on this page answers "what
                does it cost", and the Free card's honest answer is a word, not an amount. And
                in naira formatPrice returned "₦0", which in Cormorant Garamond reads as the
                word "No" — the ₦ sits as a struck N and the 0 as an o. The single card most
                readers will stay on was headed with a refusal.
                It is a literal in every currency because the free tier does not HAVE a price in
                any of them, so there is nothing here for the currency selector to change. */}
            <div className="mb-price">Free</div>
            <div className="mb-per">Always. No card, no trial.</div>
            <ul className="mb-perks">
              <Perk>{shelfLine('free')}</Perk>
              {PERKS.free.map((p) => <Perk key={p}>{p}</Perk>)}
            </ul>
            <div className="mb-cta">
              <div className="mb-flat">You already have this.</div>
            </div>
          </div>

          {TIERS.map((t) => {
            const amount = subscriptionAmount(t, interval, currency);
            const isYours = known && subscriptionTier === t;
            const key = `sub:${t}:${interval}`;
            return (
              <div key={t} className={`mb-card${t === 'gold' ? ' is-feature' : ''}`}>
                <div className="mb-card-top">
                  <div className="mb-card-n">{TIER_NAME[t].toUpperCase()}</div>
                  {isYours && <span className="mb-yours">YOUR PLAN</span>}
                </div>
                <div className="mb-price">{formatPrice(currency, amount)}</div>
                <div className="mb-per">{interval === 'monthly' ? 'a month' : 'a year'}</div>
                <ul className="mb-perks">
                  <Perk>{shelfLine(t)}</Perk>
                  {PERKS[t].map((p) => <Perk key={p}>{p}</Perk>)}
                </ul>
                <div className="mb-cta">
                  {!MEMBERSHIPS_ON_SALE ? (
                    <div className="mb-flat">{LAUNCH_NOTICE}</div>
                  ) : isYours ? (
                    <a className="mb-btn is-ghost" href="/settings" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>MANAGE</a>
                  ) : (
                    <button
                      type="button"
                      className={`mb-btn${t === 'platinum' ? ' is-ghost' : ''}`}
                      disabled={busy !== null}
                      onClick={() => buy(key, { product: 'subscription', tier: t, interval })}
                    >
                      {busy === key ? 'OPENING…' : `CHOOSE ${TIER_NAME[t].toUpperCase()}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── PASSES ──────────────────────────────────────────────────────────────────────
            passesFor(currency) IS the week-pass rule. The week pass appears only in naira
            because ₦500 is the only price it has — there is no currency check here and no
            country check anywhere. Add a GBP week price to AMOUNTS one day and this section
            starts offering it with no change to this file. */}
        {passes.length > 0 && (
          <div className="mb-sec">
            <div className="mb-sec-h">NOT READY TO SUBSCRIBE?</div>
            <p className="mb-sec-p">
              A pass gives you the Gold shelf for a short window, once, with nothing to cancel.
              Anything you save while it is live stays on your shelf after it ends — we do not
              take saved stories back.
            </p>
            <div className={`mb-passes${passes.length > 1 ? ' is-two' : ''}`}>
              {passes.map((p) => {
                const key = `pass:${p.kind}`;
                return (
                  <div key={p.kind} className="mb-card">
                    <div className="mb-card-top">
                      <div className="mb-card-n">{PASS_NAME[p.kind].toUpperCase()}</div>
                      {known && pass && pass.kind === p.kind && <span className="mb-yours">ACTIVE</span>}
                    </div>
                    <div className="mb-price">{formatPrice(p.currency, p.amount)}</div>
                    <div className="mb-per">{PASS_WINDOW[p.kind]} of Gold, once</div>
                    <ul className="mb-perks">
                      <Perk>{shelfLine('gold')}</Perk>
                      <Perk>What you save is yours to keep afterwards</Perk>
                    </ul>
                    <div className="mb-cta">
                      {!MEMBERSHIPS_ON_SALE ? (
                        <div className="mb-flat">{LAUNCH_NOTICE}</div>
                      ) : (
                        <button
                          type="button"
                          className="mb-btn is-ghost"
                          disabled={busy !== null}
                          onClick={() => buy(key, { product: 'pass', kind: p.kind })}
                        >
                          {busy === key ? 'OPENING…' : `BUY THE ${PASS_NAME[p.kind].toUpperCase()}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && <div className="mb-err" role="alert">{error}</div>}

        <div className="mb-foot">
          {/* Said once more at the bottom, because it is the thing most likely to be misread
              about a page with prices on it. */}
          Stories stay free for everyone, members or not.
          {known && source !== 'none' && <> You can manage your membership in <a href="/settings">settings</a>.</>}
        </div>
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
