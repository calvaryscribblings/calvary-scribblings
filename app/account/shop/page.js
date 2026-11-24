'use client';
// SHOP-B2 — /account/shop: keep a paperback order in the reader's Calvary account.
// The rules are docs/ACCOUNT-CONTRACT.md §6.2 (a); the address, the state and every word on this
// page are app/lib/shopHandoff.js. This file prints no sentence of its own (the wordmark aside).
//
//   · `return` not exactly the one address, or `state` not 1–128 URL-safe characters: BAD_LINK, and
//     nobody is sent anywhere.
//   · Signed out: the question above the site's own sign-in (AuthModal, opened at once). A new account
//     completes its handle and date of birth first (ProfileCompletion is NOT exempt here), and the
//     buttons wait for it.
//   · Signed in: "Keep it" asks /api/account/shop-code for a code and goes to returnHref(code, state);
//     "Not now" goes to declineHref(state). Both addresses are built from the constant, never from
//     the query, and replace this page in history so Back never re-mints.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../lib/AuthContext';
import AuthModal from '../../components/AuthModal';
import { needsCompletion, IDENTITY_FIELDS } from '../../lib/profileCompletion';
import { readHandoffParams, returnHref, declineHref, SHOP_RETURN_URL, SHOP_COPY, SHOP_CODE_ENDPOINT, SHOP_CODE_TIMEOUT_MS } from '../../lib/shopHandoff';

const ERROR_FOR = { 401: 'signedOut', 429: 'limited' };

// The query string, read on the client only (null on the server and in the static export).
const noSubscribe = () => () => {};
const clientSearch = () => window.location.search;
const serverSearch = () => null;

/** The three identity leaves, live: null while unknown, then whether the step is still owed. */
function useIdentityOwed(user) {
  const [owed, setOwed] = useState(null);
  useEffect(() => {
    setOwed(null);
    if (!user) return undefined;
    let offs = [];
    let live = true;
    (async () => {
      try {
        const { db } = await import('../../lib/firebaseCore');
        const { ref, onValue } = await import('firebase/database');
        if (!live) return;
        const identity = {};
        const seen = new Set();
        let unreadable = false;
        const settle = () => { if (seen.size === IDENTITY_FIELDS.length) setOwed(unreadable ? false : needsCompletion(identity)); };
        offs = IDENTITY_FIELDS.map((k) => onValue(ref(db, `users/${user.uid}/${k}`),
          (snap) => { identity[k] = snap.val(); seen.add(k); settle(); },
          // Unreadable: the completion step says nothing either, so neither does this page: the
          // buttons are not held back by a read that failed.
          () => { unreadable = true; seen.add(k); settle(); }));
      } catch {
        if (live) setOwed(false);
      }
    })();
    return () => { live = false; offs.forEach((off) => off()); };
  }, [user]);
  return owed;
}

export default function ShopHandoffPage() {
  const { user, loading } = useAuth() || {};
  const search = useSyncExternalStore(noSubscribe, clientSearch, serverSearch);
  const params = useMemo(() => (search === null ? null : readHandoffParams(search)), [search]);   // null until read on the client
  const [stage, setStage] = useState('ask');   // ask | keeping | leaving
  const [error, setError] = useState('');
  const owed = useIdentityOwed(user);

  // Signed out: the sign-in opens at once, under the question. Once open it stays until it closes
  // itself (a new email account sees its verify-your-email screen first, as everywhere) or the
  // reader closes it; "Sign in or create an account" opens it again.
  const [dismissed, setDismissed] = useState(false);
  const [opened, setOpened] = useState(false);
  const autoOpen = !!params?.ok && !loading && !user && !dismissed;
  if (autoOpen && !opened) setOpened(true);
  const showAuth = !dismissed && (autoOpen || opened);

  const leave = useCallback((href) => {
    setStage('leaving');
    window.location.replace(href);
  }, []);

  const keep = useCallback(async () => {
    if (!user || !params?.ok || stage !== 'ask') return;
    setError('');
    setStage('keeping');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(SHOP_CODE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ return: SHOP_RETURN_URL, state: params.state }),
        cache: 'no-store',
        // A request that never answers is a failure like any other: "Not now" comes back.
        signal: AbortSignal.timeout(SHOP_CODE_TIMEOUT_MS),
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!res.ok || typeof data?.code !== 'string') {
        setError(SHOP_COPY[ERROR_FOR[res.status] || 'failed']);
        setStage('ask');
        return;
      }
      leave(returnHref(data.code, params.state));
    } catch {
      setError(SHOP_COPY.failed);
      setStage('ask');
    }
  }, [user, params, stage, leave]);

  const notNow = useCallback(() => {
    if (params?.ok) leave(declineHref(params.state));
  }, [params, leave]);

  let body = null;
  if (params && !params.ok) {
    body = <p className="sh-bad" role="alert" data-shop-bad>{SHOP_COPY.badLink}</p>;
  } else if (params && !loading) {
    const ready = !!user && owed === false;
    body = (
      <>
        <h1 className="sh-q" data-shop-question>{SHOP_COPY.question}</h1>
        <p className="sh-note" data-shop-note>{SHOP_COPY.note}</p>
        {error && <p className="sh-err" role="alert" data-shop-error>{error}</p>}
        {stage === 'leaving' ? (
          <p className="sh-note" data-shop-leaving>{SHOP_COPY.leaving}</p>
        ) : (
          <div className="sh-actions">
            {user ? (
              ready && (
                <button type="button" className="sh-keep" data-shop-keep onClick={keep} disabled={stage !== 'ask'}>
                  {stage === 'keeping' ? SHOP_COPY.keeping : SHOP_COPY.keep}
                </button>
              )
            ) : (
              <button type="button" className="sh-keep" data-shop-signin onClick={() => setDismissed(false)}>{SHOP_COPY.signIn}</button>
            )}
            <button type="button" className="sh-later" data-shop-not-now onClick={notNow} disabled={stage !== 'ask'}>{SHOP_COPY.notNow}</button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <style>{`
        .sh-wrap { min-height: 100vh; background: #0d0d0d; color: #e8e0d4; display: flex; align-items: center; justify-content: center; padding: 2rem 16px 4rem; font-family: 'Cormorant Garamond', Georgia, serif; }
        .sh-card { width: 100%; max-width: 520px; text-align: center; }
        .sh-mark { font-size: 0.78rem; font-weight: 600; color: rgba(245,240,232,0.7); letter-spacing: 0.04em; margin: 0 0 2.4rem; }
        .sh-mark span { color: #a78bfa; }
        .sh-q { font-weight: 400; font-size: clamp(1.85rem, 5vw, 2.3rem); line-height: 1.12; color: #ffffff; letter-spacing: -0.012em; margin: 0 0 1.05rem; }
        .sh-note { font-family: Inter, system-ui, sans-serif; font-size: 0.94rem; line-height: 1.7; color: rgba(232,224,212,0.66); margin: 0 0 1.6rem; }
        .sh-bad { font-size: clamp(1.4rem, 4.4vw, 1.8rem); line-height: 1.25; color: #ffffff; margin: 0; }
        .sh-err { font-family: Inter, system-ui, sans-serif; font-size: 0.9rem; line-height: 1.6; color: #fca5a5; margin: 0 0 1.2rem; }
        .sh-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
        .sh-keep, .sh-later { font-family: Inter, system-ui, sans-serif; min-height: 44px; padding: 0.78rem 1.4rem; border-radius: 9px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }
        .sh-keep { background: #6b2fad; color: #ffffff; border: 1px solid #6b2fad; }
        .sh-later { background: transparent; color: rgba(167,139,250,0.9); border: 1px solid rgba(167,139,250,0.32); }
        .sh-keep:disabled, .sh-later:disabled { opacity: 0.6; cursor: default; }
      `}</style>
      <main className="sh-wrap" data-shop-handoff>
        <div className="sh-card">
          <div className="sh-mark">Calvary <span>Scribblings</span></div>
          {body}
        </div>
      </main>
      {showAuth && <AuthModal onClose={() => setDismissed(true)} />}
    </>
  );
}
