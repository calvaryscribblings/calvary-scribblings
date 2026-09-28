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

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import { startMembershipCheckout, idTokenFor, MembershipCheckoutError, checkReturnStatus } from '../lib/membershipCheckout';
import { returnBanner, RETURN_DEADLINE_MS, HELP_EMAIL } from '../lib/membershipReturn';
import AuthModal from '../components/AuthModal';
import Navbar from '../components/Navbar';
import TabBar from '../components/TabBar';
import { CURRENCY_SELECTOR_CSS } from '../bookstore/components/CurrencySelector';
import { BUY_CSS, GHOST_CSS } from '../bookstore/components/buyButtonCSS';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

const TIER_NAME = { free: 'Free', gold: 'Gold', platinum: 'Platinum' };

// W27 — NO LINE BEGINS WITH A DASH. Every spaced dash is bound to the word before it with a
// no-break space, so a wrap can only ever fall AFTER the dash. The words do not change; only the
// space before each dash does. tests/membership/page-layout.spec.mjs reads every rendered line.
const nb = (s) => s.replace(/ (—|–)/g, '\u00a0$1');
// …and the day stays with its month: "30 September" never breaks across the narrow action slot.
const NOTICE = LAUNCH_NOTICE.replace(/(\d{1,2}) (?=[A-Z])/g, '$1\u00a0');

// W27 — THE DRAWING'S NUMBERS. Every size on this page is a [desktop, phone] pair from the
// approved drawing: the desktop figure holds at 1000px and wider, the phone figure at 600px and
// narrower, and between the two the value runs in a straight line (a clamp() whose ends are
// exactly the two figures). L(desktop, phone) writes that clamp.
function L(d, p) {
  if (d === p) return `${d}px`;
  const b = (d - p) / 4;                 // vw: (d − p) over the 400px between 600 and 1000
  const a = p - 1.5 * (d - p);           // px: so that 600px lands exactly on p
  const r = (n) => Math.round(n * 1000) / 1000;
  return `clamp(${Math.min(d, p)}px, calc(${r(a)}px + ${r(b)}vw), ${Math.max(d, p)}px)`;
}
const C = (a) => `rgba(240,234,216,${a})`;   // cream
const G = (a) => `rgba(201,164,76,${a})`;    // gold
const GOLD = '#c9a44c';
const HAIR = G(0.14);

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
    'This week’s stories, free to everyone, Monday to Sunday',
    'All poetry, always',
    'Every quiz on every free story',
    'The Square, and every competition in it',
    SHELF,
  ],
  gold: [
    'The whole archive: more than a hundred and sixty stories, all the way back',
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
  gold: 'The archive opens with membership.',
  platinum: 'Nothing held back.',
};

// Italic, above the list. Replaces 'Everything in Free' / 'Everything in Gold', which stated a
// containment relationship as a bullet and made the first item of every paid card an
// administrative note rather than a thing you get.
const BRIDGE = {
  gold: nb('Everything on the free island, and —'),
  platinum: nb('Everything in Gold, and —'),
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
  // W3: back from the Stripe-hosted plan-switch confirm page.
  const sw = q.get('switch');
  if (sw === 'gold' || sw === 'platinum') return `switch:${sw}`;
  return null;
}
// The provider's handle on THIS checkout: Stripe's session id, or Paystack's reference (Paystack
// appends ?reference= to the callback). A string or null, so the snapshot compares by value.
function readReturnRef() {
  const q = new URLSearchParams(window.location.search);
  return q.get('session_id') || q.get('reference') || null;
}

function Perk({ children }) {
  return <li className="mb-perk">{children}</li>;
}

// The ornament. Always aria-hidden, and always its own element, so it never sits inside a text
// node a reader (or a test) reads as part of a sentence.
const Orn = ({ className }) => <span className={className} aria-hidden="true">❦</span>;

export default function MembershipPage() {
  const { user, loading: authLoading } = useAuth();
  const membership = useMembership();
  // `loading` and `signedIn` are read by plansAreKnown() off the whole object, not destructured
  // here — the gate is one call, and pulling its inputs out separately is how a later edit ends
  // up reconstructing the rule by hand.
  const { tier, subscriptionTier, pass, source, rail } = membership;

  const [currency, chooseCurrency] = useCurrency();
  const [interval, setInterval] = useState('monthly');
  const [showAuth, setShowAuth] = useState(false);
  const [busy, setBusy] = useState(null);   // the key of the button that is working
  const [error, setError] = useState('');
  // Which block's button raised the error: the plans frame or the pass rows. The message sits
  // under THAT block, not at the foot of the page.
  const [errorAt, setErrorAt] = useState(null);

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

  const returnRef = useSyncExternalStore(subscribeToNothing, readReturnRef, readReturnOnServer);
  const switchTo = typeof returned === 'string' && returned.startsWith('switch:') ? returned.slice(7) : null;

  // Has the thing they came back for actually landed? A subscription lifts subscriptionTier; a
  // pass appears as `pass` — and for a SECOND pass, only once the pass on record is the one they
  // just bought (MON-19: before W3 it said "live" at once, with the old expiry). A switch has
  // landed when the tier is the one they chose.
  const settled = returned === 'join' ? subscriptionTier !== 'free'
    : returned === 'pass' ? !!pass && (!returnRef || pass.ref === returnRef)
    : switchTo ? subscriptionTier === switchTo
    : false;

  // ── W3 / MON-09: NEVER "SETTING UP…" FOR EVER ─────────────────────────────────────────
  // The provider is asked whether the money moved (/api/membership/return-status), and a clock
  // runs. Inside RETURN_DEADLINE_MS the banner says it is setting up; past it, it says which of
  // two different things is true — the payment went through and we are late (our failure, which
  // the webhook has already reported to Ikenna), or the payment never completed (nothing taken).
  const [provider, setProvider] = useState('unknown');
  const [overdue, setOverdue] = useState(false);
  const waiting = (returned === 'join' || returned === 'pass' || !!switchTo) && !settled;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setTimeout(() => setOverdue(true), RETURN_DEADLINE_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  useEffect(() => {
    if (!waiting || !user || !returnRef) return undefined;
    let stop = false;
    const handle = returnRef.startsWith('cs_') ? { sessionId: returnRef } : { reference: returnRef };
    // Asked at once, then every 10s until the thing lands (the effect is torn down when `waiting`
    // turns false). Each answer arrives in a timer callback, never in the effect body itself.
    let timer = null;
    const tick = async () => {
      const state = await checkReturnStatus(await idTokenFor(user), handle);
      if (stop) return;
      setProvider(state);
      timer = setTimeout(tick, 10000);
    };
    timer = setTimeout(tick, 0);
    return () => { stop = true; clearTimeout(timer); };
  }, [waiting, user, returnRef]);
  const banner = returnBanner({
    returned: switchTo ? 'switch' : returned,
    settled,
    signedIn: !!user,
    authKnown: !authLoading,
    provider,
    overdue,
  });

  const passes = useMemo(() => passesFor(currency), [currency]);

  const buy = async (key, args) => {
    setError('');
    setErrorAt(args.product === 'pass' ? 'passes' : 'plans');
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
  const member = known && subscriptionTier !== 'free';

  // A return banner is the first thing on the page when one shows; the page's top padding
  // gives up 24px to make room for it (the drawing's 148 becomes 124).
  const bannerKind = banner && !settled ? 'status'
    : returned === 'join' && settled ? 'join'
    : switchTo && settled ? 'switch'
    : returned === 'pass' && settled ? 'pass'
    : returned === 'cancelled' ? 'cancelled'
    : null;

  const errLine = (where) => (error && errorAt === where ? <div className="mb-err" role="alert">{error}</div> : null);

  return (
    <div className={`mb-page${bannerKind ? ' has-banner' : ''}`}>
      <style>{`
        ${CURRENCY_SELECTOR_CSS}
        ${BUY_CSS}
        ${GHOST_CSS}
        .mb-page { position: relative; min-height: 100vh; background: #0a0a0a; color: ${C(0.95)}; font-family: ${DISPLAY}; font-variant-numeric: lining-nums; padding: ${L(148, 120)} 0 ${L(128, 48)}; overflow-x: clip; }
        .mb-page.has-banner { padding-top: ${L(124, 120)}; }
        .mb-page::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: ${L(640, 560)}; pointer-events: none; background: radial-gradient(ellipse 60% 44% at 50% 40%, ${G(0.16)} 0%, transparent 66%); }
        .mb-body { position: relative; max-width: 936px; margin: 0 auto; padding: 0 ${L(32, 24)}; }
        .mb-orn { display: inline-block; }

        .mb-eyebrow { font-family: ${LABEL}; font-size: 9.92px; letter-spacing: 3.37px; color: ${GOLD}; text-align: center; }
        .mb-h1 { margin: ${L(32, 24)} auto 0; text-align: center; font-weight: 300; font-size: ${L(60, 34)}; line-height: ${L(64, 38.08)}; letter-spacing: -0.3px; color: ${C(0.95)}; }
        .mb-h1-l { display: block; }
        .mb-subhead { margin: ${L(22, 16)} auto 0; text-align: center; font-style: italic; font-size: ${L(25, 20)}; line-height: ${L(32, 26)}; color: ${GOLD}; }
        .mb-lede { max-width: 600px; margin: ${L(26, 20)} auto 0; text-align: center; font-size: ${L(18, 16.5)}; line-height: ${L(30, 27)}; color: ${C(0.6)}; text-wrap: pretty; }
        .mb-div { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: ${L(48, 40)}; }
        .mb-div i { display: block; width: ${L(64, 56)}; height: 1px; background: ${G(0.3)}; }
        .mb-div .mb-orn { font-size: 13px; line-height: 1; color: ${G(0.6)}; }

        .mb-plate, .mb-sec-h { margin: 0; font-family: ${LABEL}; font-weight: 400; font-size: 9.92px; letter-spacing: 2.98px; color: ${GOLD}; text-align: center; text-transform: uppercase; }
        .mb-free { margin-top: ${L(56, 44)}; text-align: center; }
        .mb-free-body { width: 720px; max-width: 100%; margin: ${L(24, 20)} auto 0; }
        .mb-free-body p { margin: 0; padding: ${L(15, 13)} 0; border-top: 1px solid ${HAIR}; font-size: ${L(18, 16.5)}; line-height: ${L(27, 25)}; color: ${C(0.82)}; text-wrap: pretty; }
        .mb-free-body p:last-child { border-bottom: 1px solid ${HAIR}; }
        .mb-free-close { margin: ${L(22, 18)} 0 0; font-style: italic; font-size: ${L(18, 16.5)}; line-height: ${L(26, 24)}; color: ${G(0.85)}; }

        .mb-controls { margin-top: ${L(72, 56)}; display: flex; align-items: center; justify-content: center; gap: 28px; }
        .mb-controls .cur-line { margin: 0; }
        .mb-crule { width: 1px; height: 14px; background: ${G(0.25)}; flex: none; }
        .mb-annual-note { height: 24px; margin: 12px 0 0; text-align: center; font-style: italic; font-size: ${L(17, 16.5)}; line-height: 24px; color: ${G(0.85)}; }

        .mb-grid { position: relative; margin: ${L(20, 18)} auto 0; max-width: 520px; border: 1px solid ${G(0.18)}; background: radial-gradient(ellipse 50% 40% at 50% 0%, ${G(0.07)}, transparent); }
        .mb-corner { position: absolute; top: ${L(10, 8)}; font-size: 12px; line-height: 1; color: ${G(0.5)}; }
        .mb-corner.is-l { left: ${L(14, 12)}; }
        .mb-corner.is-r { right: ${L(14, 12)}; }
        .mb-card { position: relative; text-align: center; }
        .mb-grid .mb-card { padding: 44px 24px 40px; }
        .mb-grid .mb-card + .mb-card { border-top: 1px solid ${G(0.12)}; }
        .mb-card.is-feature { background: radial-gradient(ellipse 80% 30% at 50% 0%, ${G(0.09)}, transparent); }
        .mb-card-n { font-family: ${LABEL}; font-size: 10.88px; line-height: 14px; letter-spacing: 3.26px; color: ${GOLD}; }
        .mb-price { margin-top: ${L(22, 18)}; font-weight: 300; font-size: ${L(60, 52)}; line-height: ${L(60, 52)}; color: ${C(0.95)}; }
        .mb-price.is-word { font-style: italic; }
        .mb-per { margin-top: ${L(12, 10)}; font-style: italic; font-size: 16px; line-height: 22px; color: ${C(0.5)}; }
        .mb-cardline { margin: ${L(24, 20)} 0 0; font-style: italic; font-size: 19px; line-height: 26px; color: ${GOLD}; }
        .mb-card-rule { width: 36px; height: 1px; background: ${G(0.3)}; margin: ${L(24, 22)} auto; }
        .mb-bridge { margin: 0 0 ${L(14, 12)}; font-style: italic; font-size: 16px; line-height: 22px; color: ${C(0.45)}; }
        .mb-perks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${L(12, 11)}; }
        .mb-perk { font-size: 16.5px; line-height: 23px; color: ${C(0.82)}; text-wrap: balance; }
        .mb-when { font-style: italic; color: ${G(0.7)}; white-space: nowrap; }
        .mb-cta { padding-top: ${L(40, 32)}; }
        .mb-btn { min-width: 240px; width: 100%; }
        .mb-btn:disabled { cursor: progress; opacity: .6; }
        .mb-btn:focus-visible { outline: 1px solid ${GOLD}; outline-offset: 3px; }
        .mb-flat { display: flex; align-items: center; justify-content: center; min-height: 48px; font-style: italic; font-size: 17px; line-height: 24px; color: ${G(0.85)}; text-align: center; }
        .mb-switch-note { width: 244px; max-width: 100%; margin: 14px auto 0; font-style: italic; font-size: 15px; line-height: 22px; color: ${C(0.5)}; }
        .mb-yours { position: absolute; left: 50%; top: -0.5px; transform: translate(-50%, -50%); padding: 0 14px; background: #0a0a0a; font-family: ${LABEL}; font-size: 8.64px; line-height: 1.6; letter-spacing: 2.42px; color: ${GOLD}; white-space: nowrap; }

        .mb-sec { margin-top: ${L(104, 80)}; text-align: center; }
        .mb-pass-h { margin: 0; font-style: italic; font-weight: 400; font-size: ${L(30, 25)}; line-height: ${L(36, 31)}; color: ${C(0.92)}; text-wrap: balance; }
        .mb-sec-p { max-width: 600px; margin: ${L(16, 14)} auto 0; font-size: ${L(18, 16.5)}; line-height: ${L(30, 27)}; color: ${C(0.6)}; text-wrap: pretty; }
        .mb-sec-close { margin: ${L(20, 18)} auto 0; font-style: italic; font-size: 16.5px; line-height: 24px; color: ${C(0.45)}; }
        .mb-passes { width: 760px; max-width: 100%; margin: ${L(34, 28)} auto 0; display: grid; grid-template-columns: 1fr auto; column-gap: 16px; text-align: left; }
        .mb-passes .mb-card { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; padding: 22px 0 24px; border-top: 1px solid ${HAIR}; text-align: left; }
        .mb-passes .mb-card:last-child { border-bottom: 1px solid ${HAIR}; }
        .mb-pass-l { grid-column: 1 / -1; }
        .mb-pass-top { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 16px; }
        .mb-passes .mb-card-n { font-size: 10.24px; letter-spacing: 2.8px; line-height: 22px; }
        .mb-passes .mb-per { margin: 0; }
        .mb-passes .mb-yours { position: static; transform: none; padding: 0; background: none; }
        .mb-passes .mb-perks { margin-top: 12px; gap: 4px; }
        .mb-passes .mb-perk { color: ${C(0.78)}; text-wrap: pretty; }
        .mb-passes .mb-price { grid-column: 1; margin: 18px 0 0; font-size: 34px; line-height: 34px; }
        .mb-pass-act { grid-column: 2; margin-top: 18px; }
        .mb-pass-btn { min-width: 176px; width: 100%; padding: 12px 20px; font-size: 10.24px; letter-spacing: 1.64px; }
        .mb-passes .mb-flat { width: 176px; min-height: 0; font-size: 16.5px; line-height: 23px; }

        .mb-keep { margin-top: ${L(104, 80)}; text-align: center; }
        .mb-keep .mb-sec-p { margin-top: ${L(22, 20)}; }
        .mb-keep-line { margin: ${L(18, 16)} auto 0; font-style: italic; font-size: ${L(27, 23)}; line-height: ${L(34, 30)}; color: ${GOLD}; }

        .mb-notice { position: relative; box-sizing: border-box; width: 640px; max-width: 100%; margin: ${L(88, 64)} auto 0; padding: ${L(34, 28)} ${L(56, 24)} ${L(36, 28)}; border: 1px solid ${G(0.22)}; background: radial-gradient(ellipse 60% 70% at 50% 0%, ${G(0.07)}, transparent); text-align: center; }
        .mb-notice-p { margin: 0; font-size: ${L(18.5, 16.5)}; line-height: ${L(30, 27)}; color: ${C(0.78)}; text-wrap: pretty; }

        .mb-qa { margin-top: ${L(104, 80)}; text-align: center; }
        .mb-qa-list { width: 760px; max-width: 100%; margin: ${L(26, 22)} auto 0; text-align: left; }
        .mb-qa-row { padding: ${L(24, 20)} 0; border-top: 1px solid ${HAIR}; }
        .mb-qa-row:last-child { border-bottom: 1px solid ${HAIR}; }
        .mb-qa-list dt { margin: 0; font-weight: 500; font-size: ${L(19, 18)}; line-height: ${L(27, 25)}; color: ${C(0.92)}; text-wrap: balance; }
        .mb-qa-list dd { margin: 8px 0 0; font-size: ${L(17, 16)}; line-height: ${L(27, 26)}; color: ${C(0.62)}; text-wrap: pretty; }

        .mb-foot { text-align: center; }
        .mb-foot-orn { display: block; margin-top: ${L(96, 72)}; font-size: 14px; line-height: 1; color: ${G(0.55)}; }
        .mb-foot-line { margin: ${L(18, 16)} auto 0; font-style: italic; font-size: ${L(20, 18)}; line-height: ${L(28, 26)}; color: ${C(0.62)}; }
        .mb-foot-line a { color: ${GOLD}; }

        .mb-banner { position: relative; box-sizing: border-box; width: 640px; max-width: 100%; margin: 0 auto ${L(72, 48)}; padding: ${L(28, 24)} ${L(48, 22)} ${L(30, 24)}; border: 1px solid ${G(0.32)}; background: radial-gradient(ellipse 70% 90% at 50% 0%, ${G(0.09)}, transparent); text-align: center; }
        .mb-banner-t { font-family: ${LABEL}; font-size: 9.92px; letter-spacing: 2.98px; color: ${GOLD}; }
        .mb-banner-p { margin: 14px 0 0; font-size: ${L(19, 17)}; line-height: ${L(29, 27)}; color: ${C(0.85)}; text-wrap: pretty; }
        .mb-banner-p a { color: ${GOLD}; }
        .mb-banner.is-bad { border-color: rgba(214,138,110,.45); }
        .mb-banner.is-bad .mb-banner-t { color: rgba(214,138,110,.92); }
        .mb-banner-btn { width: auto; margin-top: 16px; }
        .mb-err { max-width: 640px; margin: 20px auto 0; text-align: center; font-style: italic; font-size: 16.5px; line-height: 24px; color: rgba(214,138,110,.92); }

        @media (min-width: 800px) {
          .mb-passes { grid-template-columns: 1fr auto auto; column-gap: 24px; }
          .mb-pass-l { grid-column: 1; padding-right: 16px; }
          .mb-passes .mb-card { padding: 28px 0; }
          .mb-passes .mb-price { grid-column: 2; margin: 0; font-size: 40px; line-height: 40px; }
          .mb-pass-act { grid-column: 3; margin-top: 0; }
          .mb-pass-btn { min-width: 184px; padding: 12px 22px; }
          .mb-passes .mb-flat { width: 184px; }
          .mb-qa-row { display: grid; grid-template-columns: 250px 1fr; column-gap: 36px; }
          .mb-qa-list dd { margin: 0; }
        }
        @media (min-width: 1000px) {
          .mb-grid { width: 936px; max-width: none; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(9, auto); }
          .mb-grid .mb-card { grid-row: span 9; display: grid; grid-template-rows: subgrid; padding: 56px 28px 48px; }
          .mb-grid .mb-card + .mb-card { border-top: 0; border-left: 1px solid ${G(0.12)}; }
          .mb-grid .mb-card + .mb-card .mb-yours { left: calc(50% - 0.5px); }
          .mb-cardline { white-space: nowrap; }
        }
        @media (max-width: 600px) {
          .mb-page::before { background: radial-gradient(ellipse 84% 40% at 50% 36%, ${G(0.16)} 0%, transparent 66%); }
          .mb-h1 { font-size: min(34px, calc(10.3vw - 5px)); line-height: 1.12; letter-spacing: -0.2px; }
          .mb-controls { flex-direction: column; gap: 14px; }
          .mb-crule { display: none; }
          .mb-grid { max-width: none; }
          .mb-foot-line { max-width: 300px; text-wrap: balance; }
        }
      `}</style>

      <Navbar />

      <div className="mb-body">
        {/* The return banner: idempotent on refresh and harmless when visited directly — it never
            claims a payment happened; it says what will appear if one did, then reports what
            landed. */}
        {bannerKind && (
          <div className={`mb-banner${bannerKind === 'status' && banner.tone === 'bad' ? ' is-bad' : ''}`} role="status">
            <div className="mb-banner-t">
              <Orn className="mb-orn" />{' '}
              {bannerKind === 'status' ? nb(banner.title)
                : bannerKind === 'join' ? 'YOU’RE IN'
                : bannerKind === 'switch' ? 'YOUR PLAN HAS CHANGED'
                : bannerKind === 'pass' ? 'YOUR PASS IS LIVE'
                : 'NOTHING WAS CHARGED'}
              {' '}<Orn className="mb-orn" />
            </div>
            <p className="mb-banner-p">
              {bannerKind === 'status' && <>
                {nb(banner.body)}
                {banner.contact && <> Write to <a href={`mailto:${HELP_EMAIL}`}>{HELP_EMAIL}</a>.</>}
              </>}
              {bannerKind === 'join' && `Your ${TIER_NAME[subscriptionTier]} membership is active. Thank you for keeping this place going.`}
              {bannerKind === 'switch' && `You’ve moved to ${TIER_NAME[subscriptionTier]}. Nothing else about your membership has changed.`}
              {bannerKind === 'pass' && `Your pass is active until ${new Date(pass.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. Anything you save while it lasts stays on your shelf afterwards.`}
              {bannerKind === 'cancelled' && 'You closed the checkout before it finished. Nothing has been taken and you can pick up again whenever you like.'}
            </p>
            {bannerKind === 'status' && banner.signIn && (
              <button type="button" className="bd-cta bd-sample mb-btn mb-banner-btn" onClick={() => setShowAuth(true)}>SIGN IN</button>
            )}
          </div>
        )}

        <div className="mb-eyebrow"><Orn className="mb-orn" />{' MEMBERSHIP '}<Orn className="mb-orn" /></div>
        <h1 className="mb-h1">
          <span className="mb-h1-l">Every story is free</span>{' '}
          <span className="mb-h1-l">the week it is published.</span>
        </h1>
        <p className="mb-subhead">Membership opens everything before that.</p>
        <p className="mb-lede">
          {nb('The island publishes new stories several times a week, and every story published this week is free to everyone — no account, no card, no membership.')}
          {' On Monday the week’s stories join the archive together, where more than a hundred and sixty stories are waiting. That is what a membership opens.'}
        </p>
        <div className="mb-div" aria-hidden="true"><i /><span className="mb-orn">❦</span><i /></div>

        {/* WHAT STAYS FREE — before any price. Every line is a policy the code enforces. */}
        <section className="mb-free" aria-labelledby="mb-free-h">
          <h2 className="mb-free-h mb-plate" id="mb-free-h"><Orn className="mb-orn" />{' What stays free '}<Orn className="mb-orn" /></h2>
          <div className="mb-free-body">
            <p>Every story published this week, Monday to Sunday, is free to read, in full, to anyone who finds it.</p>
            <p>On Monday the week’s stories join the archive together, and a new free week begins.</p>
            <p>All poetry is free. Always, and to everyone.</p>
            <p>{nb('The Square is free — every conversation and every competition in it.')}</p>
            <p>Every quiz on every free story is free to take.</p>
          </div>
          <p className="mb-free-close">None of that is a trial, and none of it expires.</p>
        </section>

        {/* The currency line is the shop's own: choosing here changes the shop too. */}
        <div className="mb-controls">
          <div className="cur-line">
            <span className="cur-eyebrow" aria-hidden="true">Prices in</span>
            <div className="cur-opts" role="group" aria-label="Currency">
              {CURRENCIES.map((c, i) => (
                <span key={c} style={{ display: 'contents' }}>
                  {i > 0 && <span className="cur-sep" aria-hidden="true">·</span>}
                  <button type="button" className="cur-btn" aria-pressed={c === currency} onClick={() => chooseCurrency(c)}>{CURRENCY_LABELS[c]}</button>
                </span>
              ))}
            </div>
          </div>
          <span className="mb-crule" aria-hidden="true" />
          <div className="cur-line">
            <div className="cur-opts" role="group" aria-label="Billing period">
              {INTERVALS.map((iv, i) => (
                <span key={iv} style={{ display: 'contents' }}>
                  {i > 0 && <span className="cur-sep" aria-hidden="true">·</span>}
                  <button type="button" className="cur-btn" aria-pressed={iv === interval} onClick={() => setInterval(iv)}>{iv === 'monthly' ? 'MONTHLY' : 'YEARLY'}</button>
                </span>
              ))}
            </div>
          </div>
        </div>
        {/* Reserved in both states, so switching the period never moves the frame. */}
        <p className="mb-annual-note">{interval === 'annual' ? 'A year for the price of ten months.' : ''}</p>

        <div className="mb-grid">
          <Orn className="mb-corner is-l" />
          <Orn className="mb-corner is-r" />

          {/* FREE IS A REAL COLUMN, not an absence. Nine rows like the others — its bridge,
              action and note rows are empty tracks, never a disabled button. */}
          <div className="mb-card">
            {known && tier === 'free' && <span className="mb-yours">YOUR PLAN</span>}
            <div className="mb-card-n">FREE</div>
            {/* The word, never a zero: formatPrice(ngn, 0) set in Cormorant reads as a word. */}
            <div className="mb-price is-word">Free</div>
            <div className="mb-per">Always. No card, no trial.</div>
            <p className="mb-cardline">{CARD_LINE.free}</p>
            <div className="mb-card-rule" aria-hidden="true" />
            <div />
            <ul className="mb-perks">
              {PERKS.free.map((p, i) => <Perk key={`free-${i}`}>{p === SHELF ? shelfLine('free') : p}</Perk>)}
            </ul>
            <div />
            <div />
          </div>

          {TIERS.map((t) => {
            const amount = subscriptionAmount(t, interval, currency);
            const isYours = known && subscriptionTier === t;
            const key = `sub:${t}:${interval}`;
            const face = t === 'gold' ? 'bd-buy' : 'bd-sample';
            return (
              <div key={t} className={`mb-card${t === 'gold' ? ' is-feature' : ''}`}>
                {isYours && <span className="mb-yours">YOUR PLAN</span>}
                <div className="mb-card-n">{TIER_NAME[t].toUpperCase()}</div>
                <div className="mb-price">{formatPrice(currency, amount)}</div>
                <div className="mb-per">{interval === 'monthly' ? 'a month' : 'a year'}</div>
                <p className="mb-cardline">{CARD_LINE[t]}</p>
                <div className="mb-card-rule" aria-hidden="true" />
                <p className="mb-bridge">{BRIDGE[t]}</p>
                <ul className="mb-perks">
                  {PERKS[t].map((p, i) => <Perk key={`${t}-${i}`}>{p === SHELF ? shelfLine(t) : p}</Perk>)}
                </ul>
                <div className="mb-cta">
                  {!MEMBERSHIPS_ON_SALE ? (
                    <div className="mb-flat">{NOTICE}</div>
                  ) : isYours ? (
                    <a className="bd-cta bd-sample mb-btn" href="/settings">MANAGE</a>
                  ) : (
                    <button
                      type="button"
                      className={`bd-cta ${member ? 'bd-sample' : face} mb-btn`}
                      disabled={busy !== null}
                      onClick={() => buy(key, { product: 'subscription', tier: t, interval })}
                    >
                      {busy === key ? 'OPENING…' : `${member ? 'SWITCH TO' : 'CHOOSE'} ${TIER_NAME[t].toUpperCase()}`}
                    </button>
                  )}
                </div>
                <div>
                  {/* W3 / MON-02: a member SWITCHES — one subscription, never two — and what that
                      costs is said before they press, per rail. */}
                  {MEMBERSHIPS_ON_SALE && member && !isYours && (
                    <p className="mb-switch-note">
                      {rail === 'paystack'
                        ? `Your ${TIER_NAME[subscriptionTier]} plan stops renewing when ${TIER_NAME[t]} starts. Paystack doesn’t carry over the ${TIER_NAME[subscriptionTier]} time you’ve already paid for.`
                        : nb('One membership, switched — you’ll see the price difference before you confirm.')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {errLine('plans')}

        {/* PASSES. passesFor(currency) IS the week-pass rule: the week pass has only a naira
            price, so it appears only in naira. No currency check, no country check. */}
        {passes.length > 0 && (
          <div className="mb-sec">
            <div className="mb-pass-h">A pass, if a subscription is not what you want</div>
            <p className="mb-sec-p">
              {nb('Some readers want the archive for an afternoon, or for one long journey with no signal at the end of it. A pass opens the Gold shelf for a day — or, in naira, for a week — once. There is nothing to cancel and nothing to remember.')}
            </p>
            <div className="mb-passes">
              {passes.map((p) => {
                const key = `pass:${p.kind}`;
                return (
                  <div key={p.kind} className="mb-card">
                    <div className="mb-pass-l">
                      <div className="mb-pass-top">
                        <div className="mb-card-n">{PASS_NAME[p.kind].toUpperCase()}</div>
                        <div className="mb-per">{PASS_WINDOW[p.kind]} of Gold, once</div>
                        {known && pass && pass.kind === p.kind && <span className="mb-yours">ACTIVE</span>}
                      </div>
                      <ul className="mb-perks">
                        <Perk>{shelfLine('gold')}</Perk>
                        <Perk>What you save is yours to keep afterwards</Perk>
                      </ul>
                    </div>
                    <div className="mb-price">{formatPrice(p.currency, p.amount)}</div>
                    <div className="mb-cta mb-pass-act">
                      {!MEMBERSHIPS_ON_SALE ? (
                        <div className="mb-flat">{NOTICE}</div>
                      ) : (
                        <button
                          type="button"
                          className="bd-cta bd-sample mb-btn mb-pass-btn"
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
            {errLine('passes')}
            <p className="mb-sec-close">A pass is a one-off. It ends on its own.</p>
          </div>
        )}

        {/* WHAT YOU KEEP — the confiscation ruling, stated where a reader buying a thing that
            expires meets the question (see the ruling above CAPS in app/lib/shelf.js). */}
        <section className="mb-keep" aria-labelledby="mb-keep-h">
          <h2 className="mb-sec-h" id="mb-keep-h"><Orn className="mb-orn" />{' What you keep '}<Orn className="mb-orn" /></h2>
          <p className="mb-sec-p">
            {nb('Anything you have saved is yours. If a pass runs out, or a membership ends, or you simply stop — the stories already on your device stay there, and stay readable.')}
          </p>
          <p className="mb-keep-line">We do not take saved stories back.</p>
        </section>

        {/* PRE-LAUNCH. Only while memberships are not on sale; every action slot carries the
            date too, so a reader meets it with the first price. */}
        {!MEMBERSHIPS_ON_SALE && (
          <div className="mb-notice" role="status">
            <Orn className="mb-corner is-l" />
            <Orn className="mb-corner is-r" />
            <p className="mb-notice-p">
              {nb(`${LAUNCH_NOTICE} Everything on this page is the real price — nothing here changes on the day. We wanted you to be able to read it first.`)}
            </p>
          </div>
        )}

        {/* SHORT ANSWERS. Three pairs; the fourth question returns when its answer is written. */}
        <section className="mb-qa" aria-labelledby="mb-qa-h">
          <h2 className="mb-sec-h" id="mb-qa-h"><Orn className="mb-orn" />{' Short answers '}<Orn className="mb-orn" /></h2>
          <dl className="mb-qa-list">
            <div className="mb-qa-row">
              <dt>Can I cancel?</dt>
              <dd>
                Any time, and you keep everything until the period you have paid for runs out.
                Card and naira memberships both cancel from your settings; naira members can also
                use the “Manage subscription” link in Paystack’s emails.
              </dd>
            </div>
            <div className="mb-qa-row">
              <dt>What happens to the archive if I stop?</dt>
              <dd>
                New stories stay free to you, as they are to everyone. The archive closes.
                Anything you had saved stays saved.
              </dd>
            </div>
            <div className="mb-qa-row">
              <dt>Why is poetry free?</dt>
              <dd>
                Poetry is always free on the island. It is short, it is better stumbled upon
                than sought out, and putting it behind anything felt wrong.
              </dd>
            </div>
          </dl>
        </section>

        <div className="mb-foot">
          <Orn className="mb-orn mb-foot-orn" />
          {/* No number, on purpose: "every week" is true at ten and still true at four. */}
          <p className="mb-foot-line">
            New stories every week, free to everyone. That does not change.
            {known && source !== 'none' && <> You can manage your membership in <a href="/settings">settings</a>.</>}
          </p>
        </div>
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <TabBar active={null} />
    </div>
  );
}
