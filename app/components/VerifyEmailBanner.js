'use client';
// The verification prompt. Shown to a signed-in reader whose email was never verified.
//
// ── WHY THE COPY OWNS THE FAULT ──────────────────────────────────────────────────────────
// These readers did not ignore a verification email. They never got one. AuthModal used to
// call the auth Worker with `Bearer undefined` — NEXT_PUBLIC_AUTH_SECRET is inlined at build
// and was never set — so the Worker answered 401 to every request and the call site did not
// check res.ok. New accounts silently received nothing, for an unknown length of time. The
// full account is in functions/api/auth/send-verification.js, which is the repair.
//
// So the banner does not say "don't forget to verify" or "you still haven't verified". Both
// are false, and both put the failure on the reader. It says we didn't send it. That is what
// happened.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────
// Not a mass send and not a batch job. Nothing here reaches for a list of accounts; the
// banner acts only for the reader looking at it, only when they press the button. The
// dormant accounts are deliberately out of scope.
//
// ── PLACEMENT: TOP, AND UNDER THE NAVBAR WHERE THERE IS ONE ──────────────────────────────
// The bottom of a mobile viewport already has two fixed tenants — TabBar (z 900, or 9100
// over the bookstore curtain) and CookieBanner (z 9999, itself offset 65px + safe-area to
// clear the bar). A first-time signed-in visitor can have BOTH on screen, and a third
// element in that stack would have to encode the heights of the other two. It goes to the
// top instead, where nothing is competing.
//
// The one tenant at the top is Navbar (.cs-nav, fixed, 68px, z 1000). Rather than cover it,
// the banner sits BELOW it when it is present, using the same body:has() test CookieBanner
// already uses to clear the tab bar. z-index 998 keeps the navbar AND its drawer (z 999,
// top 68px) above the banner, so opening the menu covers this rather than fighting it.
// Where :has() is unsupported the rule never matches and the banner sits at top 0 — one
// page's chrome overlapped for one dismissible strip, which is the safe direction.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/AuthContext';
import { useVerificationResend } from '../lib/verifyEmail';
// The reading surfaces this must stay off, and why it is a denylist rather than the
// codebase's usual opt-in-per-page arrangement. Kept in its own module so a plain node test
// can import the predicate without booting React and firebase.
import { isImmersive } from '../lib/immersiveRoutes';

// ── DISMISSAL: ONE FLAG, ONE SESSION ─────────────────────────────────────────────────────
// Deliberately not keyed by route. A reader who dismisses this on the library must not meet
// it again on a story page five seconds later — one sitting, one dismissal.
//
// sessionStorage rather than localStorage: the account genuinely is unverified, so the
// prompt should come back next time they arrive. Dismissing is "not now", not "never".
//
// Held as a tiny external store rather than component state for two reasons. It survives a
// remount (client-side navigation can unmount and remount this without a page load, and a
// re-read of storage would otherwise be the only thing standing between the reader and a
// second banner), and it keeps the storage read out of an effect body — which is a
// synchronous re-render the linter is right to object to, and which useSyncExternalStore
// exists to replace.
const DISMISS_KEY = 'cs_verify_dismissed';

let dismissedCache = null;
const listeners = new Set();

function readDismissed() {
  if (dismissedCache === null) {
    try { dismissedCache = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { dismissedCache = false; }
  }
  return dismissedCache;
}

// Remember for the rest of the session WITHOUT hiding what is currently on screen. Used
// after a successful send: the confirmation should stay up long enough to be read, but the
// banner must not greet them again on the next page.
function persistDismissal() {
  try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode — memory only */ }
  dismissedCache = true;
}

function dismissNow() {
  persistDismissal();
  listeners.forEach((l) => l());
}

function subscribeDismissal(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// During the static export's prerender there is no sessionStorage and no signed-in user, so
// the honest server snapshot is "dismissed" — the banner contributes nothing to the HTML and
// appears on the client once auth and storage have both answered. Returning false here would
// bake a banner into every prerendered page and then hydrate it away.
const dismissedServerSnapshot = () => true;

const ACCENT = '#a78bfa';

const CSS = `
  .cs-verify {
    position: fixed; top: 0; left: 0; right: 0; z-index: 998;
    background: rgba(17,14,24,0.98);
    border-bottom: 1px solid rgba(167,139,250,0.22);
    backdrop-filter: blur(8px);
    padding: 0.7rem 1.1rem;
    font-family: Cormorant Garamond, Georgia, serif;
  }
  body:has(.cs-nav) .cs-verify { top: 68px; }
  .cs-verify-inner {
    max-width: 860px; margin: 0 auto;
    display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  }
  .cs-verify-text { flex: 1; min-width: 200px; }
  .cs-verify-title {
    margin: 0; font-size: 0.9rem; color: #f5f0e8; line-height: 1.3;
  }
  .cs-verify-body {
    margin: 0.15rem 0 0; font-size: 0.82rem; line-height: 1.45;
    color: rgba(232,224,212,0.62);
  }
  .cs-verify-msg { margin: 0.35rem 0 0; font-size: 0.82rem; line-height: 1.5; }
  .cs-verify-msg.ok { color: #7fd6a8; }
  .cs-verify-msg.bad { color: #e79aa4; }
  .cs-verify-msg a { color: ${ACCENT}; text-decoration: underline; }
  .cs-verify-actions { display: flex; gap: 0.6rem; flex-shrink: 0; align-items: center; }
  .cs-verify-send {
    background: #6b2fad; border: none; border-radius: 6px;
    padding: 0.5rem 1.15rem; color: #fff; font-family: inherit;
    font-size: 0.76rem; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; cursor: pointer;
  }
  .cs-verify-send[disabled] { opacity: 0.55; cursor: default; }
  .cs-verify-later {
    background: transparent; border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px; padding: 0.5rem 1rem; color: rgba(232,224,212,0.5);
    font-family: inherit; font-size: 0.76rem; letter-spacing: 0.08em;
    text-transform: uppercase; cursor: pointer;
  }
  /* 320px: the two buttons stop sharing a row with the text rather than squeezing it. */
  @media (max-width: 400px) {
    .cs-verify-actions { width: 100%; }
    .cs-verify-send, .cs-verify-later { flex: 1; text-align: center; }
  }
`;

export default function VerifyEmailBanner() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const dismissed = useSyncExternalStore(subscribeDismissal, readDismissed, dismissedServerSnapshot);
  // The probe is keyed by uid rather than held as a bare boolean, which does two things: it
  // keeps every setState inside a callback (an effect body that sets state synchronously is
  // a re-render the linter is right to object to), and it means a result belonging to a
  // PREVIOUS user can never be read as this one's. Until the probe lands for the current
  // uid, `verified` is null and the banner renders nothing — so a reader who verified in
  // another tab is not nagged for the gap between page load and reload() resolving.
  const [probe, setProbe] = useState({ uid: null, verified: null });
  const verified = user && probe.uid === user.uid ? probe.verified : null;
  const { state, message, send } = useVerificationResend(user);

  // user.emailVerified is read off a cached token and goes stale the moment someone clicks
  // the link in their inbox. reload() asks the account record. If it fails — offline, most
  // likely — fall back to the cached value rather than showing nothing forever.
  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    const settle = () => { if (alive) setProbe({ uid: user.uid, verified: !!user.emailVerified }); };
    user.reload().then(settle, settle);
    return () => { alive = false; };
  }, [user]);

  // A send that worked has said its piece. The confirmation stays on screen for whoever is
  // looking at it, but it should not greet them again on the next page.
  useEffect(() => {
    if (state === 'sent') persistDismissal();
  }, [state]);

  if (loading || !user || dismissed) return null;
  if (verified !== false) return null;
  if (isImmersive(pathname)) return null;

  const sending = state === 'sending';
  const sent = state === 'sent';

  return (
    <>
      <style>{CSS}</style>
      <div className="cs-verify" role="status">
        <div className="cs-verify-inner">
          <div className="cs-verify-text">
            {/* Two lines, and no more. MEASURED at 320×568 on /public-library: the first
                draft ran to four lines of body copy and stood 185px tall, which — stacked
                with the cookie banner a first-time visitor also sees — left about 150px of
                actual page between them. Nothing overlapped; the screen was simply gone.
                Everything the longer version added ("nothing is wrong with your account",
                "send it now and you are done") was either implied by the button or reassurance
                the first sentence already gives. */}
            <p className="cs-verify-title">Your email was never verified.</p>
            <p className="cs-verify-body">
              That one is on us — the email we owed you when you joined never went out.
            </p>
            {message && (
              <p className={`cs-verify-msg ${sent ? 'ok' : 'bad'}`}>
                {message}
                {state === 'error' && (
                  <>
                    {' '}You can also try from{' '}
                    <a href="/settings">Settings</a>.
                  </>
                )}
              </p>
            )}
          </div>
          <div className="cs-verify-actions">
            <button className="cs-verify-send" onClick={send} disabled={sending || sent}>
              {sending ? 'Sending…' : sent ? 'Sent' : 'Send it now'}
            </button>
            <button className="cs-verify-later" onClick={dismissNow}>
              {sent ? 'Close' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
