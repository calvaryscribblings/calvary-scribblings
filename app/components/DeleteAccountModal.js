'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  signOut, reauthenticateWithCredential, reauthenticateWithPopup,
  EmailAuthProvider, GoogleAuthProvider, OAuthProvider,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useMembership } from '../lib/MembershipContext';
import {
  COPY, conditionalLines, hasPaidMembership, runDeleteFlow, callDeleteEndpoint,
} from '../lib/accountDeletion';

// Delete account — IMMEDIATE and PERMANENT (Ikenna's ruling, 23 Sep 2026).
//
//   1. the reader types their own @username (case-insensitive) to enable the button
//   2. POST /api/account/delete with their ID token — the server deletes everything, Auth last
//   3. if the server answers requires_recent_login, the modal asks them to sign in again
//      (password, Google or Apple, whichever the account uses) and calls ONCE more
//   4. only on success: sign out, then /account/deleted
//
// Any failure is shown in the modal and the reader stays signed in: a failed deletion never
// looks like success. The copy and the flow live in app/lib/accountDeletion.js.
//
// `username` and `email` come from the parent. If username is missing (some legacy accounts
// have no @handle), the email local-part is the confirmation instead.
export default function DeleteAccountModal({ open, onClose, uid, username, email, isAuthor = false }) {
  const router = useRouter();
  const membership = useMembership();
  const [typed, setTyped] = useState('');
  const [stage, setStage] = useState('confirm'); // confirm | working | reauth
  const [errMsg, setErrMsg] = useState('');
  const [password, setPassword] = useState('');
  const [reauthBusy, setReauthBusy] = useState(false);
  const inputRef = useRef(null);
  const reauthRef = useRef(null); // { resolve, reject } while the flow waits on the reader

  useEffect(() => {
    if (open) {
      setTyped(''); setErrMsg(''); setStage('confirm'); setPassword(''); setReauthBusy(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) return null;

  const fallbackHandle = (email || '').split('@')[0] || '';
  const expected = (username || fallbackHandle || '').toLowerCase();
  const placeholder = username || fallbackHandle || 'username';
  const matched = expected.length > 0 && typed.trim().toLowerCase() === expected;
  const notes = conditionalLines({ hasPaidMembership: hasPaidMembership(membership), isAuthor: isAuthor === true });
  const providers = (auth.currentUser?.providerData || []).map((p) => p.providerId);
  const usesPassword = providers.includes('password');
  const busy = stage === 'working' || reauthBusy;

  const confirmDelete = async () => {
    if (!matched || busy || !uid) return;
    setErrMsg('');
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
    setReauthBusy(false);
    if (result.ok) {
      router.push('/account/deleted');
      return;
    }
    setErrMsg(result.message);
    setStage('confirm');
  };

  // The reader signs in again. A wrong password stays on this step so they can retry it; only
  // Cancel gives up — and giving up deletes nothing, because the server refused before acting.
  const reauth = async (how) => {
    if (reauthBusy || !reauthRef.current) return;
    setReauthBusy(true);
    setErrMsg('');
    try {
      const user = auth.currentUser;
      if (how === 'password') {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      } else {
        await reauthenticateWithPopup(user, how === 'apple' ? new OAuthProvider('apple.com') : new GoogleAuthProvider());
      }
      setStage('working');
      reauthRef.current.resolve();
    } catch {
      setErrMsg(COPY.reauthFailed);
      setReauthBusy(false);
    }
  };

  const cancel = () => {
    if (stage === 'working' || reauthBusy) return;
    if (reauthRef.current) { reauthRef.current.reject(new Error('cancelled')); return; }
    onClose();
  };

  return (
    <div
      className="dam-backdrop"
      onClick={e => { if (e.target === e.currentTarget) cancel(); }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,400&family=Inter:wght@300;400;500;600&display=swap');

        .dam-backdrop {
          position: fixed; inset: 0; z-index: 1100;
          background: rgba(0,0,0,0.84);
          display: flex; align-items: flex-end; justify-content: center;
          padding: 0;
        }
        @media (min-width: 600px) {
          .dam-backdrop { align-items: center; padding: 1rem; }
        }

        .dam-modal {
          background: #111;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px 20px 0 0;
          width: 100%; max-width: 480px;
          padding: 1.9rem 1.6rem 1.9rem;
          font-family: Cormorant Garamond, Georgia, serif;
        }
        @media (min-width: 600px) { .dam-modal { border-radius: 18px; } }

        .dam-title {
          font-family: Cormorant Garamond, Georgia, serif;
          font-size: 1.5rem; color: #f5f0e8;
          margin: 0 0 0.85rem;
          line-height: 1.15;
        }
        .dam-body {
          font-size: 0.86rem;
          color: rgba(232,224,212,0.72);
          line-height: 1.62;
          margin-bottom: 1.15rem;
        }
        .dam-body strong { color: #f5f0e8; font-weight: 500; }
        .dam-body em { color: rgba(167,139,250,0.85); font-style: normal; }

        .dam-list {
          margin: 0.6rem 0 0.95rem;
          padding-left: 1rem;
          font-size: 0.78rem;
          color: rgba(232,224,212,0.62);
          line-height: 1.7;
        }
        .dam-list li { margin-bottom: 0.15rem; }


        .dam-label {
          font-size: 0.62rem;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 0.42rem;
        }

        .dam-input {
          width: 100%;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 0.78rem 0.92rem;
          font-size: 0.92rem;
          color: #f5f0e8;
          font-family: Cormorant Garamond, Georgia, serif;
          letter-spacing: 0.01em;
          margin-bottom: 0.55rem;
          outline: none;
          transition: border-color 0.18s, background 0.18s;
        }
        .dam-input::placeholder { color: rgba(255,255,255,0.22); }
        .dam-input:focus {
          border-color: rgba(167,139,250,0.45);
          background: rgba(255,255,255,0.05);
        }
        .dam-input.matched { border-color: rgba(180,86,80,0.55); }

        .dam-err {
          font-size: 0.72rem;
          color: #f0a59a;
          margin: 0.4rem 0 0.8rem;
          line-height: 1.5;
        }

        .dam-actions {
          display: flex; gap: 0.55rem;
          margin-top: 0.95rem;
        }
        .dam-cancel, .dam-delete {
          flex: 1;
          font-family: Cormorant Garamond, Georgia, serif;
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 0.84rem;
          border-radius: 9px;
          cursor: pointer;
          transition: all 0.18s;
        }
        .dam-cancel {
          background: none;
          border: 1px solid rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.45);
        }
        .dam-cancel:hover { color: rgba(255,255,255,0.78); border-color: rgba(255,255,255,0.22); }
        .dam-cancel:disabled { opacity: 0.4; cursor: not-allowed; }

        .dam-delete {
          background: none;
          border: 1px solid rgba(180,86,80,0.5);
          color: #d68d85;
        }
        .dam-delete:hover:not(:disabled) {
          background: rgba(180,86,80,0.12);
          border-color: rgba(180,86,80,0.78);
          color: #f0a59a;
        }
        .dam-delete:disabled { opacity: 0.32; cursor: not-allowed; }

        .dam-signoff {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-style: italic;
          font-weight: 400;
          font-size: 0.94rem;
          color: rgba(232,224,212,0.45);
          text-align: center;
          margin-top: 1.3rem;
        }

        .dam-note {
          font-size: 0.82rem;
          font-weight: 500;
          color: rgba(232,224,212,0.78);
          background: rgba(180,86,80,0.06);
          border: 1px solid rgba(180,86,80,0.2);
          border-radius: 8px;
          padding: 0.65rem 0.78rem;
          margin-bottom: 0.7rem;
          line-height: 1.55;
        }
        .dam-google {
          width: 100%;
          background: none;
          border: 1px solid rgba(255,255,255,0.16);
          color: #f5f0e8;
          border-radius: 9px;
          padding: 0.8rem;
          font-family: Cormorant Garamond, Georgia, serif;
          font-size: 0.92rem;
          cursor: pointer;
          margin-bottom: 0.55rem;
        }
        .dam-google:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
      <div className="dam-modal" role="dialog" aria-modal="true" aria-label={COPY.title}>
        {stage === 'reauth' ? (
          <>
            <h2 className="dam-title">{COPY.reauthTitle}</h2>
            <div className="dam-body">{COPY.reauthBody}</div>
            {usesPassword && (
              <>
                <input
                  type="password"
                  className="dam-input"
                  placeholder={COPY.reauthPassword}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && password) reauth('password'); }}
                  disabled={reauthBusy}
                  autoFocus
                />
              </>
            )}
            {!usesPassword && providers.includes('google.com') && (
              <button className="dam-google" onClick={() => reauth('google')} disabled={reauthBusy}>{COPY.reauthGoogleButton}</button>
            )}
            {!usesPassword && providers.includes('apple.com') && (
              <button className="dam-google" onClick={() => reauth('apple')} disabled={reauthBusy}>{COPY.reauthAppleButton}</button>
            )}
            {errMsg && <div className="dam-err" role="alert">{errMsg}</div>}
            <div className="dam-actions">
              <button className="dam-cancel" onClick={cancel} disabled={reauthBusy}>{COPY.cancel}</button>
              {usesPassword && (
                <button className="dam-delete" onClick={() => reauth('password')} disabled={!password || reauthBusy}>
                  {reauthBusy ? COPY.working : COPY.reauthPasswordButton}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 className="dam-title">{COPY.title}</h2>
            <div className="dam-body">{COPY.intro}</div>
            <div className="dam-label">{COPY.goesLabel}</div>
            <ul className="dam-list">
              {COPY.goes.map(line => <li key={line}>{line}</li>)}
            </ul>
            {notes.map(line => <div key={line} className="dam-note" data-note>{line}</div>)}
            <div className="dam-label">{COPY.confirmLabel}</div>
            <input
              ref={inputRef}
              type="text"
              className={`dam-input ${matched ? 'matched' : ''}`}
              placeholder={placeholder}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              disabled={busy}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {errMsg && <div className="dam-err" role="alert">{errMsg}</div>}
            <div className="dam-actions">
              <button className="dam-cancel" onClick={cancel} disabled={busy}>{COPY.cancel}</button>
              <button className="dam-delete" onClick={confirmDelete} disabled={!matched || busy}>
                {stage === 'working' ? COPY.working : COPY.confirm}
              </button>
            </div>
          </>
        )}
        <div className="dam-signoff">{COPY.signoff}</div>
      </div>
    </div>
  );
}
