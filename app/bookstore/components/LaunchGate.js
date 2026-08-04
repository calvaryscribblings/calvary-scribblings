'use client';
// THE CURTAIN. Rendered by /bookstore and /bookstore/[slug] before either fetches anything.
//
// WHY IT IS A FULL-SCREEN OVERLAY rather than an early return. The mock's success state is the
// gate LIFTING to reveal the store, which means the store has to already be there to be
// revealed. So the passcode check calls onUnlock() the instant the key fits — the storefront
// mounts underneath and starts its catalogue fetch while the reader is still reading 'Welcome
// back.' — and this component stays mounted on top, fixed and opaque, until its own lift
// finishes and it calls onLifted() to be unmounted. The reader sees a curtain go up on a
// stocked shop; they do not see a spinner where the shop should be.
//
// THE REGISTER IS THE STOREFRONT'S OWN, not a new one. Every value here is lifted from
// app/bookstore/page.js: ground #070707, gold #c9a44c and its rgba(201,164,76,·) dims, vellum
// #f0ead8 and rgba(240,234,216,·), Cinzel for display, Cormorant Garamond for body, the lamp
// as a radial of rgba(201,164,76,.16). Nothing is invented — the gate has to read as the same
// shop with the blind down, and a second gold would say otherwise. If the storefront's palette
// moves, this moves with it.
//
// 'DOORS OPEN' over the date reproduces the storefront hero's own two-tone gold: the eyebrow
// sits at a dim of the gold (the .hero-edition treatment, rgba(201,164,76,·)) and the date at
// full #c9a44c, which is what makes the date read as the brighter of the two without a new token.
//
// ERRORS ARE NOT ITALIC. Italic is this house's whisper — the tagline, the shelf cards, the
// colophon — and putting a failure in it makes the page sound coy about the reader's mistake.
// The key error and the address error are both set upright, deliberately. Do not "fix" them
// into italic for consistency with the lines above them; the inconsistency is the point.
import { useState, useRef, useEffect } from 'react';
import { ref, push } from 'firebase/database';
import { db } from '../../lib/firebase';
import { isPasscodeCorrect, grantGatePass, isEmailShaped } from '../../lib/bookstore/gate';

const OPENING_DATE = '30 September 2026';

// R9.2 PL-21 — NO @import HERE, AND NONE MAY COME BACK.
//
// This block used to open with
//   @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond…&family=Cinzel…')
// which was the worst possible place for it. GATE_CSS is injected as <style>{GATE_CSS}</style>
// at the bottom of this file, so the @import was not discovered until the React tree had
// already mounted; an @import inside an injected stylesheet is fetched serially AFTER the sheet
// that contains it, and it blocks the gate's own render while it goes. That is a third-party
// round trip on the first screen a paying customer ever sees.
//
// IT WAS ALSO REDUNDANT. app/layout.js:46-52 already loads both families for the whole app
// from a render-blocking <link>, preceded by the two preconnects — Cinzel 400/500/600/700 and
// Cormorant Garamond 400-700 in both romans and italics. Every face this gate asks for is in
// that set. The one thing the @import added and the shell does not load is weight 300, and
// nothing in this file has ever used it.
//
// app/globals.css:1-3 removed exactly this duplicate for exactly this reason and left the note
// saying so; this is the same fix on the last copy of it.
// tests/bookstore/gate-fonts.test.mjs asserts BOTH halves — that no @import returns, and that
// every family and weight named below is one the shell's link actually loads. Add a
// font-weight:300 rule here and that suite goes red rather than the gate silently rendering in
// a face nobody chose.
const GATE_CSS = `
  /* THE BOTTOM TERM CLEARS THE TAB BAR. /bookstore renders <TabBar /> in every state now,
     including this one, so the curtain's last line would otherwise sit under 64px of opaque bar.
     The 64px stacks ON TOP of the 3rem — the breathing room the composition was drawn with is
     not the bar's clearance and must not be spent as it. safe-area-inset-bottom appears ONCE, on
     this term, and it is the bar that consumes it: .cs-tabbar carries its own
     padding-bottom:env(safe-area-inset-bottom) and .cs-tabbar-spacer reserves 65px + the inset in
     flow (components/TabBar.js). Adding the inset again here would double it on a notched phone.
     Vertical padding only — the 1.5rem side gutter is untouched. */
  .bg-gate{position:fixed;inset:0;z-index:9000;overflow-y:auto;
    background:#070707;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;
    display:flex;
    padding:calc(3rem + env(safe-area-inset-top)) 1.5rem calc(3rem + 64px + env(safe-area-inset-bottom));
    transition:transform .9s cubic-bezier(.7,0,.3,1), opacity .9s cubic-bezier(.7,0,.3,1)}

  /* THE BAR PAINTS ABOVE THE CURTAIN — a scoped lift, live only while this stylesheet is mounted.
     .cs-tabbar ships z-index:900 (components/TabBar.js) and .bg-gate is 9000, so clearing the
     bar's height above would have bought nothing: the curtain's opaque ground painted straight
     over it. The gate keeps 9000 — every other overlay on the site sits below that on purpose
     (Navbar 1000, its drawer 999, its dropdown 2000, QuickLookModal 1200) and lowering the gate
     under the bar would put it under those too.
     So the BAR rises instead, from 900 to 9100, and only here. Two properties make that safe:
       · This rule lives in GATE_CSS, which React unmounts with the gate. The instant the curtain
         lifts, the bar is back to 900 and below QuickLookModal where it belongs. Nothing on any
         other surface ever sees 9100.
       · The selector is nav.cs-tabbar, not .cs-tabbar. Element-plus-class outranks the bare
         class, so this wins regardless of which <style> block the browser met first — the same
         defence, and for the same reason, as the ".cs-dtabs a.cs-dtab" scoping documented in
         components/TabBar.js. Do not weaken it to a lone class to match the rules around it. */
  nav.cs-tabbar{z-index:9100}
  /* The lift. Fade runs ahead of the travel — by the time the panel is halfway up it is
     already mostly gone, which is what stops a 0.9s full-height translate reading as a wipe. */
  .bg-gate.is-lifting{transform:translateY(-100%);opacity:0}

  /* The lamp: the storefront hero's own radial, at the storefront's own strength. */
  .bg-lamp{position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(ellipse 60% 44% at 50% 42%,rgba(201,164,76,.16) 0%,transparent 66%)}

  /* CENTRED BY margin:auto, NOT BY align-items — and that is not a style preference. Measured
     at 375x667 with align-items:center, .bg-inner's top sat at -25px: a flex item taller than
     an overflow:auto container overflows equally in both directions, and the part above the
     scroll origin cannot be scrolled to in any engine. The brand line and the fleuron were
     simply gone on an iPhone SE, unreachably. margin:auto centres identically while leaving
     the overflow reachable, which is the standard fix and the one with no support question
     hanging over it the way the 'safe' alignment keyword still has. Do not put
     align-items:center back.
     (And note: this stylesheet is a template literal. No backticks, no dollar-brace — either
     one closes the string and the build fails with a parse error pointing at the comment.) */
  .bg-inner{position:relative;z-index:2;width:100%;max-width:520px;margin:auto;text-align:center;
    animation:bgRise .9s ease forwards}
  @keyframes bgRise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}

  .bg-brand{font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.34em;text-transform:uppercase;
    color:rgba(240,234,216,.5)}
  .bg-fleuron{color:rgba(201,164,76,.5);font-size:.9rem;margin:1.1rem 0}
  .bg-store{font-family:'Cinzel',serif;font-weight:400;font-size:clamp(1.5rem,6.4vw,2.3rem);
    letter-spacing:.08em;color:#f0ead8;margin:0}
  .bg-whisper{font-size:1.02rem;font-style:italic;color:rgba(240,234,216,.5);line-height:1.7;
    margin:1rem auto 0;max-width:24em}

  .bg-hero{margin:2.8rem 0 0}
  .bg-eyebrow{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.3em;text-transform:uppercase;
    color:rgba(201,164,76,.7);margin-bottom:.9rem}
  .bg-date{font-family:'Cinzel',serif;font-weight:600;font-size:clamp(1.75rem,7.6vw,2.9rem);
    letter-spacing:.02em;line-height:1.1;color:#c9a44c;margin:0}
  /* The thread. A gradient rather than the colophon's flat rule, so it reads as drawn under
     the date rather than as a section break. */
  .bg-thread{width:min(200px,60%);height:1px;margin:1.5rem auto 0;
    background:linear-gradient(90deg,transparent,rgba(201,164,76,.55),transparent)}

  .bg-field{margin:2.8rem 0 0}
  .bg-label{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.24em;text-transform:uppercase;
    color:rgba(240,234,216,.55);margin-bottom:.9rem}
  .bg-row{display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap}
  /* ── R9.0 PL-5 / PL-6: the two measured contrast failures, fixed ──────────────────────
     Both were alpha values, and both are fixed by raising the alpha alone — the hues, the
     hairline weight, the radius, the italic placeholder and the focus treatment are all
     untouched, so the field looks like the same field.

       border      rgba(201,164,76,.25) → .55    1.51:1 → 3.19:1   (needs 3:1, non-text)
       placeholder rgba(240,234,216,.28) → .55   2.15:1 → 5.38:1   (needs 4.5:1, text)

     Measured against the gate's own ground, #070707, which is what R9.0 measured against —
     its published figures reproduce exactly, which is why these ones can be trusted.

     .55 IS NOT A NEW VALUE. It is the alpha .bg-label already uses twelve lines up, so the
     placeholder now sits at exactly the weight of the label above the field, and the palette
     gains nothing to maintain. The minimum passing alphas were .495 and .530; rounding both
     to an existing token beats inventing two new ones for the sake of two hundredths. */
  .bg-input{flex:1 1 200px;min-width:0;max-width:280px;
    font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;color:#f0ead8;
    background:rgba(255,255,255,.02);border:1px solid rgba(201,164,76,.55);border-radius:3px;
    padding:.8rem 1rem;outline:none;transition:border-color .25s,background-color .25s}
  .bg-input::placeholder{color:rgba(240,234,216,.55);font-style:italic}
  .bg-input:focus{border-color:#c9a44c;background:rgba(201,164,76,.05)}
  .bg-input:disabled{opacity:.5}
  .bg-btn{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;
    font-weight:600;padding:.8rem 1.5rem;border:none;border-radius:3px;
    background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;cursor:pointer;
    transition:filter .25s,opacity .25s}
  .bg-btn:hover{filter:brightness(1.08)}
  .bg-btn:disabled{cursor:default;opacity:.55;filter:none}

  /* Upright, not italic — see the note at the head of this file. */
  .bg-error{font-size:.94rem;color:rgba(240,234,216,.62);margin:.9rem 0 0}
  .bg-welcome{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;
    color:#c9a44c;margin:.9rem 0 0}
  .bg-said{font-size:.98rem;font-style:italic;color:rgba(201,164,76,.75);margin:.9rem 0 0}

  .bg-divider{margin:2.8rem 0;color:rgba(201,164,76,.4);font-size:.85rem}
  .bg-invite{font-size:1rem;font-style:italic;color:rgba(240,234,216,.5);margin:0 0 1rem}

  .bg-colophon{margin:3rem 0 0;font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.24em;
    text-transform:uppercase;color:rgba(240,234,216,.3)}

  @media (prefers-reduced-motion:reduce){
    .bg-gate{transition:none}
    .bg-gate.is-lifting{transform:none;opacity:1}
    .bg-inner{animation:none;opacity:1;transform:none}
  }
`;

export default function LaunchGate({ onUnlock, onLifted }) {
  const [code, setCode] = useState('');
  const [keyState, setKeyState] = useState('idle'); // 'idle' | 'wrong' | 'right'
  const [lifting, setLifting] = useState(false);
  const [email, setEmail] = useState('');
  const [mail, setMail] = useState('idle'); // 'idle' | 'invalid' | 'sending' | 'done' | 'error'

  const timers = useRef([]);
  const after = (ms, fn) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const gateRef = useRef(null);
  const codeRef = useRef(null);
  const restoreRef = useRef(null);

  // ── R9.0 PL-5/PL-6 · THE GATE IS A DIALOG ────────────────────────────────────────────
  //
  // It always behaved like one — a full-screen overlay at z-index 9000 with the storefront
  // mounted and unreachable underneath — but it declared none of it, so a screen reader met a
  // page containing a shop and a passcode field with nothing to say the shop was not yet
  // available. Everything below is the standard modal contract, and none of it changes a
  // pixel: no copy, no layout, no lift.
  //
  // FOCUS ON MOUNT goes to the passcode field rather than to the dialog container. The field
  // IS the task; landing on the container would make every keyboard reader tab past the brand
  // line and the date to reach the only thing they can act on.
  //
  // THE STOREFRONT BEHIND IS MADE INERT, not merely aria-hidden. aria-hidden alone hides it
  // from the accessibility tree while leaving every link in it tabbable, which is the worse
  // half of the bug: focus would walk out of the curtain into a shop the reader cannot see.
  // `inert` removes both. aria-hidden is set as well, for the assistive tech that predates it.
  //
  // THE COOKIE BANNER IS DELIBERATELY EXEMPT. Providers renders it as a DOM sibling of this
  // component (<AuthProvider>{children}<CookieBanner /></AuthProvider>) at z-index 9999,
  // ABOVE the gate, precisely so consent stays reachable behind a curtain — the reasoning is
  // in tests/bookstore/gate.spec.mjs. Inerting it would make the one control that must never
  // be trapped behind a modal unreachable. Do not "tidy" this exception away.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    codeRef.current?.focus();

    const gate = gateRef.current;
    const parent = gate?.parentElement;
    const touched = [];
    if (parent) {
      for (const el of Array.from(parent.children)) {
        if (el === gate) continue;
        if (el.classList?.contains('cs-cookie')) continue;   // see above
        touched.push([el, el.inert, el.getAttribute('aria-hidden')]);
        el.inert = true;
        el.setAttribute('aria-hidden', 'true');
      }
    }

    return () => {
      for (const [el, wasInert, wasHidden] of touched) {
        el.inert = wasInert;
        if (wasHidden === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', wasHidden);
      }
      // FOCUS RESTORED ON UNLOCK. The element that had focus when the curtain came down gets
      // it back — unless it has left the document, or it was <body>, which is the ordinary
      // case on a cold load and where "restoring" would mean focusing nothing. Letting the
      // browser reset to the top of the now-visible storefront is the right outcome there.
      const target = restoreRef.current;
      if (target && target !== document.body && document.contains(target) && typeof target.focus === 'function') {
        target.focus();
      }
    };
  }, []);

  // THE TRAP. Tab and Shift+Tab wrap within the curtain, so focus cannot reach the inert shop
  // behind it — belt to inert's braces, and the half that still works if a browser without
  // `inert` support ever renders this.
  //
  // ESCAPE DOES NOTHING, deliberately, and that is not an oversight. A dialog usually closes
  // on Escape; this one has nothing to close to. The shop is not open, there is no prior view
  // to return to, and a curtain that could be dismissed with a keystroke would not be a gate.
  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const gate = gateRef.current;
    if (!gate) return;

    const focusable = Array.from(
      gate.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    if (focusable.length === 0) { e.preventDefault(); return; }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    // Also catches the case where focus has somehow escaped the gate entirely (a disabled
    // field losing it mid-unlock, say): pull it back to the first control rather than letting
    // the next Tab land outside.
    if (!gate.contains(active)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  function submitKey(e) {
    e.preventDefault();
    if (keyState === 'right') return;
    if (!isPasscodeCorrect(code)) { setKeyState('wrong'); return; }

    setKeyState('right');
    grantGatePass();
    // Immediately, not after the lift: the store gets the whole animation to fetch its
    // catalogue, so the curtain comes up on shelves rather than on skeletons.
    onUnlock();

    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* assume motion */ }
    if (reduced) {
      // No lift — but 'Welcome back.' is still the beat that says the key worked, so it gets
      // long enough to be read. A pause is not an animation; the preference is about motion.
      after(700, onLifted);
      return;
    }
    after(620, () => setLifting(true));
  }

  // onTransitionEnd fires once per animated property; keying on transform means the fade
  // finishing first does not unmount the gate while it is still travelling.
  function handleLiftEnd(e) {
    if (e.propertyName === 'transform' && lifting) onLifted();
  }

  async function submitEmail(e) {
    e.preventDefault();
    if (mail === 'sending' || mail === 'done') return;
    if (!isEmailShaped(email)) { setMail('invalid'); return; }
    setMail('sending');
    try {
      await push(ref(db, 'bookstore_waitlist'), { email: email.trim(), addedAt: Date.now() });
      setMail('done');
    } catch {
      setMail('error');
    }
  }

  const mailClosed = mail === 'sending' || mail === 'done';

  return (
    <div
      className={`bg-gate${lifting ? ' is-lifting' : ''}`}
      onTransitionEnd={handleLiftEnd}
      data-testid="bookstore-gate"
      ref={gateRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bg-gate-title"
      onKeyDown={trapFocus}
    >
      <style>{GATE_CSS}</style>
      <div className="bg-lamp" aria-hidden="true" />

      <div className="bg-inner">
        <div className="bg-brand">Calvary Scribblings</div>
        <div className="bg-fleuron" aria-hidden="true">&#10086;</div>
        <h1 className="bg-store" id="bg-gate-title">The Book Store</h1>
        <p className="bg-whisper">The shelves are stocked and the ink is dry.</p>

        <div className="bg-hero">
          <div className="bg-eyebrow">Doors open</div>
          <p className="bg-date">{OPENING_DATE}</p>
          <div className="bg-thread" aria-hidden="true" />
        </div>

        <form className="bg-field" onSubmit={submitKey}>
          <div className="bg-label" id="bg-key-label">Keyholders may enter</div>
          <div className="bg-row">
            <input
              className="bg-input"
              ref={codeRef}
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value); if (keyState === 'wrong') setKeyState('idle'); }}
              placeholder="Passcode"
              aria-labelledby="bg-key-label"
              aria-invalid={keyState === 'wrong'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
              disabled={keyState === 'right'}
              data-testid="gate-passcode"
            />
            <button className="bg-btn" type="submit" disabled={keyState === 'right'} data-testid="gate-enter">
              Enter
            </button>
          </div>
          {keyState === 'wrong' && (
            <p className="bg-error" role="alert" data-testid="gate-error">That key doesn&rsquo;t fit this door.</p>
          )}
          {keyState === 'right' && (
            <p className="bg-welcome" role="status" data-testid="gate-welcome">Welcome back.</p>
          )}
        </form>

        <div className="bg-divider" aria-hidden="true">&#10086;</div>

        {/* noValidate, deliberately. type="email" stays — it is what summons the @ keyboard on a
            phone, which is the whole reason to declare it — but the browser's own constraint
            check must not run: it intercepts submit before onSubmit fires, so isEmailShaped()
            never gets a look and the reader is shown a system-font bubble in the browser's
            locale instead of the line this page was designed with. It is also the wrong check,
            being laxer than ours ('a@b' passes it and would then be refused by the RTDB rule as
            a silent permission-denied). One validator, ours, matching the rule. */}
        <form className="bg-field" style={{ margin: 0 }} onSubmit={submitEmail} noValidate>
          <p className="bg-invite">Or be first through the doors &mdash;</p>
          <div className="bg-row">
            <input
              className="bg-input"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (mail === 'invalid' || mail === 'error') setMail('idle'); }}
              placeholder="your@email.com"
              aria-label="Email address for the waiting list"
              aria-invalid={mail === 'invalid'}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck="false"
              disabled={mailClosed}
              data-testid="waitlist-email"
            />
            <button className="bg-btn" type="submit" disabled={mailClosed} data-testid="waitlist-submit">
              {mail === 'sending' ? 'Sending' : 'Keep me posted'}
            </button>
          </div>
          {mail === 'invalid' && (
            <p className="bg-error" role="alert" data-testid="waitlist-error">
              That address doesn&rsquo;t look quite right.
            </p>
          )}
          {mail === 'error' && (
            <p className="bg-error" role="alert" data-testid="waitlist-error">
              That didn&rsquo;t send. Try again in a moment.
            </p>
          )}
          {mail === 'done' && (
            <p className="bg-said" role="status" data-testid="waitlist-done">
              You&rsquo;re on the list. We&rsquo;ll write when the doors open.
            </p>
          )}
        </form>

        <div className="bg-colophon">&#10086;&nbsp;&nbsp;Human-made, cover to cover</div>
      </div>
    </div>
  );
}
