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

// ── THE SHELF LINE STAYS COMPUTED ────────────────────────────────────────────────────────
//
// Generated from capFor() so the marketing figure and the enforced save limit cannot drift —
// the one place on this site where a number in prose and a number in a guard could disagree,
// they are the same call.
//
// The copy deck (audit/membership-copy-deck.md §3) gives the wording as a TEMPLATE, not a
// literal, and says so explicitly: "That guarantee is worth more than the wording." So the
// deck's phrasing is reproduced here around capFor(), never pasted as a string.
//
// WHY THE NUMBER IS SPELLED. The deck writes 'Two stories' and 'Twenty stories', which is
// house style — British English prose spells small numbers. capFor() returns 2 and 20, so
// this maps them. The map covers every value a cap plausibly takes and falls back to digits
// for anything else, because a cap of 25 must render as "25 stories saved for offline
// reading" — slightly off-style but TRUE — rather than throw or print "undefined stories".
// Style degrades; the guarantee does not.
const NUMBER_WORDS = {
  1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 12: 'Twelve', 15: 'Fifteen', 20: 'Twenty', 25: 'Twenty-five',
  30: 'Thirty', 50: 'Fifty', 100: 'A hundred',
};

function shelfLine(tier) {
  const cap = capFor('story', tier);
  if (isUnlimitedCap(cap)) return 'As many stories saved as your device will hold';
  const n = NUMBER_WORDS[cap] || String(cap);
  return `${n} ${cap === 1 ? 'story' : 'stories'} saved for offline reading`;
}

// Where the computed shelf line sits in each list. A sentinel rather than a splice at render
// time, so the arrays below read in the deck's order and a reader can check them against §3
// line by line without holding an insertion index in their head.
const SHELF = Symbol('shelf line');

// ── THE DATED CLAUSE ─────────────────────────────────────────────────────────────────────
//
// A quiet italic clause on the same line as the bullet — never a badge, never "coming soon",
// never a separate roadmap block. Deck §3: "'from October' reads as confidence; 'COMING SOON'
// reads as a placeholder, and a placeholder on a pricing page reads as a page that is not
// finished."
//
// Four perks carry one, and each is a commitment a paying member can hold us to. They are
// enumerated in deck §9 with what each one actually needs built. If a date is going to slip,
// the page is edited BEFORE 30 September — not after.
const When = ({ children }) => <em className="mb-when">{children}</em>;

// The three card lists, in the deck's order (§3). Strings are literal deck copy; the SHELF
// sentinel is replaced with shelfLine(tier) at render.
const PERKS = {
  free: [
    'Every new story, free for seven days',
    'The five newest stories, always free',
    'All poetry, always',
    'Every quiz on every free story',
    'The Square, and every competition in it',
    SHELF,
  ],
  gold: [
    'More than a hundred and sixty stories, all of them, all the way back',
    SHELF,
    <>Island Games in full, <When>from November</When></>,
    <>A Gold mark on your profile, <When>from October</When></>,
  ],
  platinum: [
    SHELF,
    <>The <em>Calvary Scribblings Series</em>, <When>from October</When></>,
    <>A Platinum mark on your profile, <When>from October</When></>,
    <>First word on what we publish next, <When>from November</When></>,
  ],
};

// The one-line promise at the top of each card, under the price (§3).
const CARD_LINE = {
  free: 'Read the island as it is published.',
  gold: 'The archive opens.',
  platinum: 'Nothing held back.',
};

// Italic, above the list. Replaces 'Everything in Free' / 'Everything in Gold', which stated a
// containment relationship as a bullet and made the first item of every paid card an
// administrative note rather than a thing you get.
const BRIDGE = {
  gold: 'Everything on the free island, and —',
  platinum: 'Everything in Gold, and —',
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
        .mb-subhead { max-width: 620px; margin: 0 auto 14px; text-align: center; font-size: clamp(17px, 3.2vw, 21px); line-height: 1.3; color: #e2c876; font-style: italic; }
        .mb-lede { max-width: 620px; margin: 0 auto; text-align: center; font-size: 15.5px; line-height: 1.62; color: #ded5c6; }

        /* WHAT STAYS FREE — the argument, before any price. Deliberately not a card: a border
           would make it look like one more thing being sold. It is the page talking. */
        .mb-free { max-width: 640px; margin: 34px auto 0; text-align: center; }
        .mb-free-h { font-family: ${LABEL}; font-size: 10px; letter-spacing: .26em; color: #c9a84c; margin: 0 0 4px; font-weight: 400; text-transform: uppercase; }
        .mb-free-body { display: flex; flex-direction: column; gap: 9px; margin: 16px 0 0; }
        .mb-free-body p { margin: 0; font-size: 15px; line-height: 1.6; color: #ded5c6; }
        .mb-free-close { margin: 18px 0 0; font-size: 14.5px; line-height: 1.6; color: #e2c876; font-style: italic; }

        /* THE FOUNDING PROMISE. A sentence, not a badge — it is the strongest thing we can say
           before 30 September and it should read as a plain commitment. */
        /* Both boxes now sit low on the page rather than under the hero, and both lost their
           headings — so the padding carries the whole shape and the top margin is a section
           gap rather than a hero gap. */
        .mb-founding { max-width: 640px; margin: 18px auto 0; padding: 16px 18px; border: 1px solid rgba(201,168,76,.34); border-radius: 12px; background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10)); text-align: center; }
        .mb-founding-p { font-size: 15px; line-height: 1.6; color: #ece3d4; margin: 0; }

        .mb-notice { max-width: 640px; margin: 46px auto 0; padding: 16px 18px; border: 1px solid rgba(201,168,76,.3); border-radius: 12px; background: rgba(201,168,76,.06); text-align: center; }
        .mb-notice-p { font-size: 14.5px; line-height: 1.6; color: #e4dbcc; margin: 0; }

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
        /* The one-line promise under each price. */
        .mb-cardline { margin: 12px 0 0; font-size: 15px; line-height: 1.45; color: #f0e7d8; }
        /* The bridge into each paid card's list. Italic and dimmer than a perk because it is a
           hinge between two lists, not a thing you get.
           ⚠ THIS BLOCK IS A TEMPLATE LITERAL AND SHIPS VERBATIM — CSS comments here reach the
           browser and land in out/membership.html. Do not quote retired copy in them: an
           earlier version of this comment named the two strings this bridge replaced, and they
           duly turned up in a grep of the built output that was meant to prove them gone. */
        .mb-bridge { margin: 14px 0 -4px; font-size: 14px; line-height: 1.5; color: #b9ad99; font-style: italic; }
        /* The dated clause. Quiet — same size as the perk, italic, dimmer. It must read as a
           month attached to a promise, never as a badge stuck on a feature. */
        .mb-when { font-style: italic; color: #b0a48f; }
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
        /* Used by the passes heading (a div) and by the two new section headings (h2), so it
           resets the heading defaults rather than assuming a div. */
        .mb-sec-h { font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .26em; color: #c9a84c; text-align: center; margin: 0; font-weight: 400; text-transform: uppercase; }
        .mb-sec-p { max-width: 600px; margin: 10px auto 0; text-align: center; font-size: 14.5px; line-height: 1.6; color: #d8cfc0; }
        .mb-sec-close { max-width: 600px; margin: 16px auto 0; text-align: center; font-size: 14px; line-height: 1.6; color: #b9ad99; font-style: italic; }

        /* WHAT YOU KEEP. The last line is set larger and in gold: it is the sentence the
           section exists to deliver, and the paragraph above it is the setup. */
        .mb-keep { margin-top: 46px; text-align: center; }
        .mb-keep-line { max-width: 600px; margin: 14px auto 0; font-size: 16.5px; line-height: 1.5; color: #f0dda0; }

        /* SHORT ANSWERS. A definition list, because that is what it is. */
        .mb-qa { margin-top: 46px; }
        .mb-qa-list { max-width: 640px; margin: 18px auto 0; }
        .mb-qa-list dt { font-size: 15.5px; line-height: 1.45; color: #f0e7d8; margin: 0 0 6px; }
        .mb-qa-list dd { margin: 0 0 20px; font-size: 14.5px; line-height: 1.62; color: #cabfae; }
        .mb-qa-list dd:last-child { margin-bottom: 0; }
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
        <h1 className="mb-h1">Every story is free the week it is published.</h1>
        <p className="mb-subhead">Membership opens everything before that.</p>
        <p className="mb-lede">
          The island publishes new stories several times a week, and those stories are free to
          everyone — no account, no card, no membership. After seven days they join the archive,
          where more than a hundred and sixty stories are waiting. That is what a membership
          opens.
        </p>

        {/* ── WHAT STAYS FREE ─────────────────────────────────────────────────────────────
            BEFORE ANY PRICE, and that placement is the whole point rather than a layout
            preference. This section is the page's argument: a reader has to believe the week
            is genuinely free before a number further down means anything. A pricing page that
            leads with the price is asking to be trusted before it has said anything true.

            Every line here is a policy this codebase actually enforces, and each one is
            checkable: seven days is FREE_WINDOW_DAYS, the five newest is RECENT_FLOOR_COUNT,
            poetry is exempt in grantFor(), the Square carries no tier gate, and the quiz
            endpoints take no tier and no window at all. Nothing in this block is aspirational. */}
        <section className="mb-free" aria-labelledby="mb-free-h">
          <h2 className="mb-free-h" id="mb-free-h">What stays free</h2>
          <div className="mb-free-body">
            <p>Seven days from publication, every story is free to read, in full, to anyone who finds it.</p>
            <p>The five most recent stories are always free, however quiet a week has been.</p>
            <p>All poetry is free. Always, and to everyone.</p>
            <p>The Square is free — every conversation and every competition in it.</p>
            <p>Every quiz on every free story is free to take.</p>
          </div>
          <p className="mb-free-close">None of that is a trial, and none of it expires.</p>
        </section>

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
            <p className="mb-cardline">{CARD_LINE.free}</p>
            <ul className="mb-perks">
              {PERKS.free.map((p, i) => (
                <Perk key={`free-${i}`}>{p === SHELF ? shelfLine('free') : p}</Perk>
              ))}
            </ul>
            {/* NO CTA, deliberately. 'You already have this.' is cut — it reads as
                condescension to the reader on the tier most readers will stay on. The card
                simply ends, and the grid's `align-items: stretch` keeps the three tops level
                without a filler element. Never a disabled button here. */}
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
                <p className="mb-cardline">{CARD_LINE[t]}</p>
                <p className="mb-bridge">{BRIDGE[t]}</p>
                <ul className="mb-perks">
                  {PERKS[t].map((p, i) => (
                    <Perk key={`${t}-${i}`}>{p === SHELF ? shelfLine(t) : p}</Perk>
                  ))}
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
            {/* The heading is no longer a negative. 'NOT READY TO SUBSCRIBE?' framed the pass
                as a failure to commit; a pass is a product, and a good one for the reader who
                wants the archive for one journey. */}
            <div className="mb-sec-h">A pass, if a subscription is not what you want</div>
            <p className="mb-sec-p">
              Some readers want the archive for an afternoon, or for one long journey with no
              signal at the end of it. A pass opens the Gold shelf for a day — or, in naira,
              for a week — once. There is nothing to cancel and nothing to remember.
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
            <p className="mb-sec-close">A pass is a one-off. It ends on its own.</p>
          </div>
        )}

        {/* ── WHAT YOU KEEP ───────────────────────────────────────────────────────────────
            The confiscation ruling, stated to the customer. It costs nothing to promise
            because it is already exactly how the code behaves — see the ruling above CAPS in
            app/lib/shelf.js, which refuses to write an eviction sweep and explains why: the
            shelf is on the reader's hardware, in their IndexedDB, and culling it for a debt
            already settled would be reaching into a device to take back what someone chose
            to keep.

            It sits AFTER the passes block on purpose. A pass is the product where the
            question actually occurs to a reader — they are buying a thing that expires — so
            the answer belongs where the doubt is, not in a policy page nobody opens. */}
        <section className="mb-keep" aria-labelledby="mb-keep-h">
          <h2 className="mb-sec-h" id="mb-keep-h">What you keep</h2>
          <p className="mb-sec-p">
            Anything you have saved is yours. If a pass runs out, or a membership ends, or you
            simply stop — the stories already on your device stay there, and stay readable.
          </p>
          <p className="mb-keep-line">We do not take saved stories back.</p>
        </section>

        {/* ── PRE-LAUNCH, THEN FOUNDING ───────────────────────────────────────────────────
            Both boxes lose their headings. 'NOT YET ON SALE' and 'FOUNDING MEMBERS' were a
            negative and a label, and the first sentence of each box already does the work
            the heading was doing badly.

            Position follows the deck, which is ordered ("Every string on the page, in
            order") and puts these after What you keep rather than under the hero where they
            used to sit. Nothing is hidden by the move: with MEMBERSHIPS_ON_SALE false, every
            card's CTA slot already carries the launch notice, so a reader meets the date at
            the same moment they meet the first price. */}
        {!MEMBERSHIPS_ON_SALE && (
          <div className="mb-notice" role="status">
            <p className="mb-notice-p">
              {LAUNCH_NOTICE} Everything on this page is the real price — nothing here changes
              on the day. We wanted you to be able to read it first.
            </p>
          </div>
        )}

        {/* THE FOUNDING PROMISE. Engineered rather than aspirational: founding Prices exist
            for BOTH tiers and the Stripe portal is pinned to that generation, so an upgrade
            lands on a founding price too. That is why the second clause can be said at all —
            see the founding-lock note in prices.js. */}
        <div className="mb-founding">
          <p className="mb-founding-p">
            Join before we open and your price never goes up — not at renewal, and not if you
            move to a higher tier later. You keep the founding rate for as long as you stay a
            member.
          </p>
        </div>

        {/* ── SHORT ANSWERS ───────────────────────────────────────────────────────────────
            THREE pairs, not four. The fourth question the deck drafts — "Does this change
            what writers are paid?" — is held back deliberately: its answer has not been
            written, and shipping a placeholder answer to that particular question would be
            worse than not asking it. The question returns when the line does. */}
        <section className="mb-qa" aria-labelledby="mb-qa-h">
          <h2 className="mb-sec-h" id="mb-qa-h">Short answers</h2>
          <dl className="mb-qa-list">
            <dt>Can I cancel?</dt>
            <dd>
              Any time, and you keep everything until the period you have paid for runs out.
              Card memberships cancel from your settings. Naira memberships, for now, cancel by
              email — we are building the self-service version.
            </dd>
            <dt>What happens to the archive if I stop?</dt>
            <dd>
              New stories stay free to you, as they are to everyone. The archive closes.
              Anything you had saved stays saved.
            </dd>
            <dt>Why is poetry free?</dt>
            <dd>
              Poetry is always free on the island. It is short, it is meant to be come across
              rather than sought out, and putting it behind anything felt wrong.
            </dd>
          </dl>
        </section>

        {error && <div className="mb-err" role="alert">{error}</div>}

        <div className="mb-foot">
          {/* The closing promise, and it carries NO NUMBER on purpose. An earlier draft read
              "Three new stories a week" — measured over the eight weeks to 8 Aug 2026 the
              island published 6 to 13 a week, so the number was wrong by about 3×, and a
              number beside "that does not change" is a commitment that breaks the first quiet
              month. "Every week" is true at ten and still true at four. */}
          New stories every week, free to everyone. That does not change.
          {known && source !== 'none' && <> You can manage your membership in <a href="/settings">settings</a>.</>}
        </div>
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
