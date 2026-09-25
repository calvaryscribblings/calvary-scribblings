'use client';
// THE UNDER-18 CHECK, mounted once in Providers beside ProfileCompletion. The rules of it are
// app/lib/dobCheck.js: a signed-in reader whose stored date of birth is under 18 or unreadable
// confirms it before anything else. A confirmed adult date is written (one update); a confirmed
// under-18 date deletes the account through POST /api/account/delete — runDeleteFlow, the same
// flow and the same endpoint as the Delete account modal, signing in again if the server asks.
//
// A reader who still needs the completion step is left to it: that step asks for the date of
// birth itself and refuses an under-18 one. And, like it, this stays out of the pages a reader
// needs whatever happens — deleting the account, and the terms and privacy policy.

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  signOut, reauthenticateWithCredential, reauthenticateWithPopup,
  EmailAuthProvider, GoogleAuthProvider, OAuthProvider,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { needsCompletion, signupSettled, IDENTITY_FIELDS } from '../lib/profileCompletion';
import {
  dobStatus, storedDob, mustConfirm, confirmOutcome, confirmedDobUpdate, DOB_STATUS, DOB_COPY,
} from '../lib/dobCheck';
import { runDeleteFlow, callDeleteEndpoint, COPY as DELETE_COPY } from '../lib/accountDeletion';
import { isFounder } from '../lib/founders';

const EXEMPT = ['/settings', '/delete-account', '/account', '/privacy', '/terms'];

const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export default function DobCheck() {
  const { user, logout } = useAuth() || {};
  const pathname = usePathname() || '';
  const router = useRouter();
  const [needed, setNeeded] = useState(false);
  const [stage, setStage] = useState('ask'); // ask | under | working | reauth
  const [dob, setDob] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const reauthRef = useRef(null);

  useEffect(() => {
    setNeeded(false);
    if (!user || user.isAnonymous || isFounder(user.uid)) return;
    let live = true;
    (async () => {
      await signupSettled();
      try {
        const [{ getApp }, { getDatabase, ref, get }] = await Promise.all([import('firebase/app'), import('firebase/database')]);
        const db = getDatabase(getApp());
        const [pub, priv, ...ids] = await Promise.all([
          get(ref(db, `users/${user.uid}/dob`)),
          get(ref(db, `users_private/${user.uid}/dob`)),
          ...IDENTITY_FIELDS.map((k) => get(ref(db, `users/${user.uid}/${k}`))),
        ]);
        const identity = Object.fromEntries(IDENTITY_FIELDS.map((k, i) => [k, ids[i].val()]));
        if (needsCompletion(identity)) return; // the completion step asks, and refuses under 18
        const status = dobStatus({ uid: user.uid, dob: storedDob({ publicDob: pub.val(), privateDob: priv.val() }), now: new Date() });
        if (live && mustConfirm(status)) { setStage('ask'); setNeeded(true); }
      } catch {
        // Unreadable right now: say nothing. It is asked again on the next load.
      }
    })();
    return () => { live = false; };
  }, [user]);

  if (!needed || !user) return null;
  if (EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const confirm = async () => {
    setError('');
    const outcome = confirmOutcome(dob, new Date());
    if (outcome === DOB_STATUS.MISSING) { setError(DOB_COPY.missing); return; }
    if (outcome === DOB_STATUS.UNREADABLE) { setError(DOB_COPY.unreadable); return; }
    if (outcome === DOB_STATUS.UNDER_18) { setStage('under'); return; }
    setSaving(true);
    try {
      const [{ getApp }, { getDatabase, ref, update }] = await Promise.all([import('firebase/app'), import('firebase/database')]);
      await update(ref(getDatabase(getApp())), confirmedDobUpdate(user.uid, dob));
      setNeeded(false);
    } catch {
      setError(DOB_COPY.failed);
    }
    setSaving(false);
  };

  const deleteAccount = async () => {
    setError('');
    setStage('working');
    const result = await runDeleteFlow({
      getIdToken: (force) => auth.currentUser.getIdToken(force),
      call: callDeleteEndpoint,
      reauthenticate: () => new Promise((resolve, reject) => {
        reauthRef.current = { resolve, reject };
        setStage('reauth');
      }),
      signOut: () => signOut(auth),
    });
    reauthRef.current = null;
    if (result.ok) { router.push('/account/deleted'); return; }
    setError(result.message);
    setStage('under');
  };

  const reauth = async (how) => {
    if (!reauthRef.current) return;
    setError('');
    try {
      const u = auth.currentUser;
      if (how === 'password') await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
      else await reauthenticateWithPopup(u, how === 'apple' ? new OAuthProvider('apple.com') : new GoogleAuthProvider());
      setStage('working');
      reauthRef.current.resolve();
    } catch {
      setError(DELETE_COPY.reauthFailed);
    }
  };

  const providers = (auth.currentUser?.providerData || []).map((p) => p.providerId);

  return (
    <div className="dc-backdrop" role="dialog" aria-modal="true" aria-labelledby="dc-title">
      <style>{`
        .dc-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.88); backdrop-filter: blur(10px);
          z-index: 2001; display: flex; align-items: center; justify-content: center; padding: 1rem; overflow-y: auto; }
        .dc-modal { background: #0d0d0d; border: 1px solid rgba(255,255,255,0.09); border-radius: 2px;
          width: 100%; max-width: 420px; margin: auto; font-family: 'Cormorant Garamond', Georgia, serif; }
        .dc-bar { height: 3px; background: #6b2fad; }
        .dc-inner { padding: 2.25rem 2.25rem 1.75rem; }
        .dc-title { font-size: 1.8rem; font-weight: 300; color: #f5f0e8; margin: 0 0 0.6rem; line-height: 1.15; }
        .dc-sub { font-size: 0.92rem; color: rgba(255,255,255,0.6); margin: 0 0 1.4rem; line-height: 1.55; }
        .dc-label { display: block; font-size: 0.68rem; letter-spacing: 0.18em; text-transform: uppercase;
          color: rgba(255,255,255,0.32); margin-bottom: 0.4rem; font-weight: 500; }
        .dc-input { width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 1px; padding: 0.78rem 0.95rem; font-size: 0.92rem; color: #e8e0d4; color-scheme: dark;
          font-family: 'Cormorant Garamond', Georgia, serif; outline: none; box-sizing: border-box; margin-bottom: 1rem; }
        .dc-input:focus { border-color: rgba(107,47,173,0.55); }
        .dc-error { background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.2); padding: 0.6rem 0.85rem;
          font-size: 0.82rem; color: #fca5a5; margin-bottom: 1.1rem; }
        .dc-btn { width: 100%; background: #6b2fad; color: #fff; border: none; padding: 0.95rem; font-size: 0.8rem;
          letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; margin-bottom: 0.6rem; }
        .dc-btn.danger { background: #8f2f2a; }
        .dc-btn:disabled { opacity: 0.6; cursor: default; }
        .dc-out { display: block; margin: 0.6rem auto 0; background: none; border: none; color: rgba(255,255,255,0.5);
          font-size: 0.88rem; cursor: pointer; font-family: 'Cormorant Garamond', Georgia, serif; text-decoration: underline; }
      `}</style>
      <div className="dc-modal">
        <div className="dc-bar" />
        <div className="dc-inner">
          {stage === 'ask' && (
            <>
              <h2 className="dc-title" id="dc-title">{DOB_COPY.title}</h2>
              <p className="dc-sub">{DOB_COPY.body}</p>
              {error && <div className="dc-error" role="alert">{error}</div>}
              <label className="dc-label" htmlFor="dc-dob">{DOB_COPY.label}</label>
              <input id="dc-dob" className="dc-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              <button className="dc-btn" onClick={confirm} disabled={saving}>{saving ? 'Please wait…' : DOB_COPY.confirm}</button>
              <button className="dc-out" onClick={() => logout?.()}>{DOB_COPY.signOut}</button>
            </>
          )}
          {(stage === 'under' || stage === 'working') && (
            <>
              <h2 className="dc-title" id="dc-title">{DOB_COPY.underTitle}</h2>
              <p className="dc-sub">{DOB_COPY.underBody(longDate(dob))}</p>
              {error && <div className="dc-error" role="alert">{error}</div>}
              <button className="dc-btn danger" onClick={deleteAccount} disabled={stage === 'working'}>
                {stage === 'working' ? DOB_COPY.working : DOB_COPY.underDelete}
              </button>
              {stage === 'under' && <button className="dc-out" onClick={() => { setError(''); setStage('ask'); }}>{DOB_COPY.underBack}</button>}
            </>
          )}
          {stage === 'reauth' && (
            <>
              <h2 className="dc-title" id="dc-title">{DOB_COPY.reauthTitle}</h2>
              <p className="dc-sub">{DOB_COPY.reauthBody}</p>
              {error && <div className="dc-error" role="alert">{error}</div>}
              {providers.includes('password') && (
                <>
                  <label className="dc-label" htmlFor="dc-pw">{DELETE_COPY.reauthPassword}</label>
                  <input id="dc-pw" className="dc-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button className="dc-btn danger" onClick={() => reauth('password')}>{DELETE_COPY.reauthPasswordButton}</button>
                </>
              )}
              {providers.includes('google.com') && <button className="dc-btn" onClick={() => reauth('google')}>{DELETE_COPY.reauthGoogleButton}</button>}
              {providers.includes('apple.com') && <button className="dc-btn" onClick={() => reauth('apple')}>{DELETE_COPY.reauthAppleButton}</button>}
              <button className="dc-out" onClick={() => { reauthRef.current?.reject(new Error('cancelled')); }}>{DELETE_COPY.cancel}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
