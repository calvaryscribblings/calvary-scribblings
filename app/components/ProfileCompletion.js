'use client';
// THE COMPLETION STEP, mounted once in Providers. The rules of it are app/lib/profileCompletion.js:
// a signed-in reader whose node has no displayName, username or handle chooses a name, a date of
// birth and a handle before anything else; nothing is written until they submit, and then all of
// it is written at once.
//
// It stays out of the pages a reader needs WITHOUT an identity: deleting the account, and reading
// the terms and privacy policy that the age check points at.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/AuthContext';
import { completeProfile, needsCompletion, signupSettled, COMPLETION_COPY, IDENTITY_FIELDS } from '../lib/profileCompletion';
import { AgeRefused, AGE_COPY } from '../lib/age';
import { handleStatusLine, HANDLE_COPY, HandleRefused } from '../lib/handle';
import HandleField, { readHandleOwner, useHandleCheck } from './HandleField';

const EXEMPT = ['/settings', '/delete-account', '/account', '/privacy', '/terms'];

export default function ProfileCompletion() {
  const { user, logout } = useAuth() || {};
  const pathname = usePathname() || '';
  const [needed, setNeeded] = useState(false);
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useHandleCheck(handle, { uid: user?.uid || null, enabled: needed });

  useEffect(() => {
    setNeeded(false);
    if (!user || user.isAnonymous) return;
    let live = true;
    (async () => {
      await signupSettled();
      try {
        const [{ getApp }, { getDatabase, ref, get }] = await Promise.all([import('firebase/app'), import('firebase/database')]);
        const db = getDatabase(getApp());
        // The three leaves, not the node: a profile-less node can hold a reader's whole history.
        const snaps = await Promise.all(IDENTITY_FIELDS.map((k) => get(ref(db, `users/${user.uid}/${k}`))));
        const identity = Object.fromEntries(IDENTITY_FIELDS.map((k, i) => [k, snaps[i].val()]));
        if (live && needsCompletion(identity)) {
          setName(user.displayName || '');
          setNeeded(true);
        }
      } catch {
        // Unreadable right now: say nothing. The step is asked again on the next sign-in.
      }
    })();
    return () => { live = false; };
  }, [user]);

  if (!needed || !user) return null;
  if (EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const submit = async () => {
    setError('');
    setSaving(true);
    try {
      const [{ getApp }, { getDatabase, ref, update }] = await Promise.all([import('firebase/app'), import('firebase/database')]);
      const db = getDatabase(getApp());
      await completeProfile(user, { name, dob, handle }, {
        readHandleOwner,
        writeUpdate: (u) => update(ref(db), u),
        now: () => Date.now(),
      });
      if (!user.displayName) {
        const { updateProfile } = await import('firebase/auth');
        await updateProfile(user, { displayName: name.trim() }).catch(() => {});
      }
      setNeeded(false);
    } catch (err) {
      if (err instanceof AgeRefused) {
        // Under the minimum: nothing is written, and the reader is signed out.
        setError(err.message === AGE_COPY.under ? AGE_COPY.underSignedIn : err.message);
        setSaving(false);
        setTimeout(() => logout?.(), 4000);
        return;
      }
      if (err instanceof HandleRefused) { setCheck(err.check); setError(handleStatusLine(err.check).text); }
      else if (err.handleTaken) { setCheck({ state: 'taken', handle: err.handle }); setError(HANDLE_COPY.raceLost(err.handle)); }
      else setError(err.message === 'Please enter your name.' ? err.message : COMPLETION_COPY.failed);
    }
    setSaving(false);
  };

  return (
    <div className="pc-backdrop" role="dialog" aria-modal="true" aria-labelledby="pc-title">
      <style>{`
        .pc-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.88); backdrop-filter: blur(10px);
          z-index: 2001; display: flex; align-items: center; justify-content: center; padding: 1rem; overflow-y: auto; }
        .pc-modal { background: #0d0d0d; border: 1px solid rgba(255,255,255,0.09); border-radius: 2px;
          width: 100%; max-width: 420px; margin: auto; font-family: 'Cormorant Garamond', Georgia, serif; }
        .pc-bar { height: 3px; background: #6b2fad; }
        .pc-inner { padding: 2.25rem 2.25rem 1.75rem; }
        .pc-title { font-size: 2rem; font-weight: 300; color: #f5f0e8; margin: 0 0 0.4rem; }
        .pc-sub { font-size: 0.9rem; color: rgba(255,255,255,0.5); margin: 0 0 1.5rem; line-height: 1.5; }
        .pc-field { margin-bottom: 1rem; }
        .pc-label { display: block; font-size: 0.68rem; letter-spacing: 0.18em; text-transform: uppercase;
          color: rgba(255,255,255,0.32); margin-bottom: 0.4rem; font-weight: 500; }
        .pc-input { width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 1px; padding: 0.78rem 0.95rem; font-size: 0.92rem; color: #e8e0d4;
          font-family: 'Cormorant Garamond', Georgia, serif; outline: none; box-sizing: border-box; }
        .pc-input:focus { border-color: rgba(107,47,173,0.55); }
        .pc-input[type="date"] { color-scheme: dark; }
        .pc-hint { font-size: 0.72rem; color: rgba(255,255,255,0.42); margin-top: 0.3rem; font-style: italic; }
        .pc-error { background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.2); padding: 0.6rem 0.85rem;
          font-size: 0.82rem; color: #fca5a5; margin-bottom: 1.1rem; }
        .pc-btn { width: 100%; background: #6b2fad; color: #fff; border: none; padding: 0.95rem; font-size: 0.8rem;
          letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; }
        .pc-btn:disabled { opacity: 0.6; cursor: default; }
        .pc-out { display: block; margin: 1rem auto 0; background: none; border: none; color: rgba(255,255,255,0.45);
          font-size: 0.85rem; cursor: pointer; font-family: 'Cormorant Garamond', Georgia, serif; text-decoration: underline; }
      `}</style>
      <div className="pc-modal">
        <div className="pc-bar" />
        <div className="pc-inner">
          <h2 className="pc-title" id="pc-title">{COMPLETION_COPY.title}</h2>
          <p className="pc-sub">{COMPLETION_COPY.subtitle}</p>
          {error && <div className="pc-error" role="alert">{error}</div>}
          <div className="pc-field">
            <label className="pc-label" htmlFor="pc-name">{COMPLETION_COPY.nameLabel}</label>
            <input id="pc-name" className="pc-input" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="pc-field">
            <label className="pc-label" htmlFor="pc-dob">{AGE_COPY.label}</label>
            <input id="pc-dob" className="pc-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            <div className="pc-hint">{AGE_COPY.hint}</div>
          </div>
          <div className="pc-field">
            <HandleField id="pc-handle" value={handle} onChange={setHandle} check={check}
              inputClassName="pc-input" labelClassName="pc-label" hintClassName="pc-hint" />
          </div>
          <button className="pc-btn" onClick={submit} disabled={saving}>{saving ? 'Please wait…' : COMPLETION_COPY.submit}</button>
          <button className="pc-out" onClick={() => logout?.()}>{COMPLETION_COPY.signOut}</button>
        </div>
      </div>
    </div>
  );
}
