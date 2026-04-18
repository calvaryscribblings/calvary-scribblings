'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

async function getApp() {
  const { initializeApp, getApps } = await import('firebase/app');
  return getApps().length ? getApps()[0] : initializeApp(FB);
}
async function getFirebaseAuth() {
  const { getAuth } = await import('firebase/auth');
  return getAuth(await getApp());
}

export default function SettingsPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetState, setResetState] = useState('idle');
  const [resetMsg, setResetMsg] = useState('');
  const [verifyState, setVerifyState] = useState('idle');
  const [verifyMsg, setVerifyMsg] = useState('');

  useEffect(() => {
    let unsubAuth = null;
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubAuth = onAuthStateChanged(auth, u => {
        if (!u) { router.push('/'); return; }
        setAuthUser(u);
        setLoading(false);
      });
    })();
    return () => { if (unsubAuth) unsubAuth(); };
  }, []);

  const openResetModal = () => {
    setResetState('idle');
    setResetMsg('');
    setShowResetModal(true);
  };

  const closeResetModal = () => {
    if (resetState === 'sending') return;
    setShowResetModal(false);
  };

  const sendResetEmail = async () => {
    if (!authUser?.email) return;
    setResetState('sending');
    setResetMsg('');
    try {
      const auth = await getFirebaseAuth();
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, authUser.email);
      setResetState('sent');
      setResetMsg('Check your inbox for the reset link.');
    } catch (e) {
      setResetState('error');
      setResetMsg('Something went wrong. Please try again.');
    }
  };

  const resendVerification = async () => {
    if (!authUser) return;
    setVerifyState('sending');
    setVerifyMsg('');
    try {
      const { sendEmailVerification } = await import('firebase/auth');
      await sendEmailVerification(authUser);
      setVerifyState('sent');
      setVerifyMsg('Verification email sent. Check your inbox.');
    } catch (e) {
      setVerifyState('error');
      setVerifyMsg('Something went wrong. Please try again.');
    }
  };

  const handleSignOut = async () => {
    const auth = await getFirebaseAuth();
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
    router.push('/');
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#0d0d0d' }} />;
  if (!authUser) return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d0d; color: #e8e0d4; font-family: Inter, sans-serif; min-height: 100vh; }

        .st-nav { position: relative; z-index: 10; display: flex; align-items: center; justify-content: space-between; max-width: 740px; margin: 0 auto; padding: 1.1rem 1.5rem; }
        .st-nav-logo { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1rem; font-weight: 600; color: #f5f0e8; }
        .st-nav-logo span { color: #a78bfa; }
        .st-nav-back { font-size: 0.6rem; color: rgba(255,255,255,0.38); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; font-family: Inter, sans-serif; }
        .st-nav-back:hover { color: rgba(255,255,255,0.72); }

        .st-body { max-width: 740px; margin: 0 auto; padding: 1.5rem 1.5rem 6rem; }

        .st-header { margin-bottom: 2.5rem; }
        .st-kicker { font-size: 0.6rem; color: rgba(155,109,255,0.55); letter-spacing: 0.2em; text-transform: uppercase; font-family: Inter, sans-serif; margin-bottom: 0.55rem; }
        .st-title { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: clamp(1.9rem, 5vw, 2.4rem); font-weight: 400; color: #ffffff; line-height: 1.05; letter-spacing: -0.01em; margin-bottom: 0.4rem; }
        .st-subtitle { font-size: 0.82rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; }

        .st-section { margin-bottom: 2.2rem; }
        .st-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.68rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .st-section-title { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.18rem; color: #f5f0e8; }
        .st-section-meta { font-size: 0.54rem; color: rgba(255,255,255,0.26); letter-spacing: 0.12em; text-transform: uppercase; font-family: Inter, sans-serif; }

        .st-row { display: flex; align-items: center; justify-content: space-between; padding: 0.88rem 1.1rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; margin-bottom: 0.38rem; gap: 1rem; }
        .st-row-main { flex: 1; min-width: 0; }
        .st-row-label { font-size: 0.78rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .st-row-hint { font-size: 0.6rem; color: rgba(255,255,255,0.22); font-family: Inter, sans-serif; margin-top: 0.22rem; letter-spacing: 0.04em; }
        .st-row-action { font-size: 0.57rem; color: #9b6dff; letter-spacing: 0.1em; text-transform: uppercase; font-family: Inter, sans-serif; cursor: pointer; background: none; border: none; transition: color 0.2s; flex-shrink: 0; padding: 0; }
        .st-row-action:hover { color: #c4b5fd; }
        .st-row-action:disabled { opacity: 0.4; cursor: not-allowed; }
        .st-row-status { font-size: 0.57rem; letter-spacing: 0.08em; text-transform: uppercase; font-family: Inter, sans-serif; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; }
        .st-row-status.verified { color: #1d9e75; }
        .st-row-status.unverified { color: rgba(248,113,113,0.6); }

        .st-msg { font-size: 0.66rem; font-family: Inter, sans-serif; margin: 0.2rem 0 0.6rem 0.25rem; }
        .st-msg.success { color: #86efac; }
        .st-msg.error { color: #f87171; }

        .st-signout { width: 100%; margin-top: 0.82rem; background: none; border: 1px solid rgba(220,38,38,0.1); border-radius: 10px; padding: 0.82rem; font-size: 0.57rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(248,113,113,0.26); cursor: pointer; font-family: Inter, sans-serif; transition: color 0.2s, border-color 0.2s; }
        .st-signout:hover { color: #f87171; border-color: rgba(220,38,38,0.3); }

        .st-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.82); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
        @media (min-width: 600px) { .st-modal-backdrop { align-items: center; } }
        .st-modal { background: #111; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px 20px 0 0; width: 100%; max-width: 460px; padding: 2rem 1.5rem 2.2rem; }
        @media (min-width: 600px) { .st-modal { border-radius: 20px; } }
        .st-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.1rem; }
        .st-modal-title { font-family: Cochin, Georgia, serif; font-size: 1.3rem; color: #f5f0e8; }
        .st-modal-close { background: none; border: none; color: rgba(255,255,255,0.32); font-size: 1.4rem; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s; }
        .st-modal-close:hover { color: rgba(255,255,255,0.72); }
        .st-modal-body { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1rem; color: rgba(240,236,230,0.78); line-height: 1.7; margin-bottom: 1.1rem; }
        .st-modal-email { display: inline-block; background: rgba(107,47,173,0.1); border: 1px solid rgba(107,47,173,0.2); border-radius: 7px; padding: 0.45rem 0.78rem; font-family: Inter, sans-serif; font-size: 0.78rem; color: #c4b5fd; margin-top: 0.4rem; word-break: break-all; }
        .st-modal-note { font-size: 0.66rem; color: rgba(255,255,255,0.26); font-family: Inter, sans-serif; line-height: 1.6; margin-bottom: 1.2rem; }
        .st-modal-success { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0.8rem 0 0.4rem; }
        .st-modal-success-icon { width: 48px; height: 48px; border-radius: 50%; background: rgba(29,158,117,0.14); border: 1px solid rgba(29,158,117,0.32); display: flex; align-items: center; justify-content: center; margin-bottom: 0.9rem; }
        .st-modal-success-title { font-family: Cochin, Georgia, serif; font-size: 1.2rem; color: #f5f0e8; margin-bottom: 0.4rem; }
        .st-modal-success-msg { font-size: 0.78rem; color: rgba(255,255,255,0.42); font-family: Inter, sans-serif; line-height: 1.55; }
        .st-modal-actions { display: flex; gap: 0.6rem; margin-top: 1.2rem; }
        .st-modal-send { flex: 1; background: #7c3aed; border: none; border-radius: 9px; padding: 0.78rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: Inter, sans-serif; transition: background 0.2s; }
        .st-modal-send:hover { background: #6d28d9; }
        .st-modal-send:disabled { opacity: 0.4; cursor: not-allowed; }
        .st-modal-cancel { background: none; border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 0.78rem 1.1rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.32); cursor: pointer; font-family: Inter, sans-serif; transition: color 0.2s; }
        .st-modal-cancel:hover { color: rgba(255,255,255,0.6); }
        .st-modal-done { width: 100%; background: none; border: 1px solid rgba(167,139,250,0.3); border-radius: 9px; padding: 0.78rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #a78bfa; cursor: pointer; font-family: Inter, sans-serif; margin-top: 1.2rem; transition: background 0.2s; }
        .st-modal-done:hover { background: rgba(107,47,173,0.1); }
        .st-modal-error { font-size: 0.7rem; color: #f87171; font-family: Inter, sans-serif; margin-top: 0.8rem; }
      `}</style>

      <nav className="st-nav">
        <div className="st-nav-logo">Calvary <span>Scribblings</span></div>
        <a href="/profile" className="st-nav-back">← Back to profile</a>
      </nav>

      <div className="st-body">
        <div className="st-header">
          <div className="st-kicker">Account</div>
          <div className="st-title">Settings</div>
          <div className="st-subtitle">Manage your account details and sign-in preferences.</div>
        </div>

        <div className="st-section">
          <div className="st-section-header">
            <div className="st-section-title">Sign-in</div>
            <div className="st-section-meta">Account details</div>
          </div>

          <div className="st-row">
            <div className="st-row-main">
              <div className="st-row-label">{authUser.email}</div>
              <div className="st-row-hint">Email address</div>
            </div>
            {authUser.emailVerified ? (
              <span className="st-row-status verified">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Verified
              </span>
            ) : (
              <button
                className="st-row-action"
                onClick={resendVerification}
                disabled={verifyState === 'sending' || verifyState === 'sent'}
              >
                {verifyState === 'sending' ? 'Sending…' : verifyState === 'sent' ? 'Sent' : 'Verify email'}
              </button>
            )}
          </div>
          {verifyMsg && (
            <div className={`st-msg ${verifyState === 'sent' ? 'success' : 'error'}`}>{verifyMsg}</div>
          )}

          <div className="st-row">
            <div className="st-row-main">
              <div className="st-row-label">Password</div>
              <div className="st-row-hint">Reset via email link</div>
            </div>
            <button className="st-row-action" onClick={openResetModal}>Reset password</button>
          </div>
        </div>

        <div className="st-section">
          <div className="st-section-header">
            <div className="st-section-title">Session</div>
          </div>
          <button className="st-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      {showResetModal && (
        <div className="st-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) closeResetModal(); }}>
          <div className="st-modal">
            {resetState === 'sent' ? (
              <>
                <div className="st-modal-success">
                  <div className="st-modal-success-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <div className="st-modal-success-title">Email sent</div>
                  <div className="st-modal-success-msg">{resetMsg} Follow the link to set a new password.</div>
                </div>
                <button className="st-modal-done" onClick={closeResetModal}>Done</button>
              </>
            ) : (
              <>
                <div className="st-modal-header">
                  <div className="st-modal-title">Reset password</div>
                  <button className="st-modal-close" onClick={closeResetModal}>×</button>
                </div>
                <div className="st-modal-body">
                  We'll send a secure reset link to your registered email address.
                  <div className="st-modal-email">{authUser.email}</div>
                </div>
                <div className="st-modal-note">
                  The link expires after one hour. If you don't see the email, check your spam folder.
                </div>
                {resetState === 'error' && <div className="st-modal-error">{resetMsg}</div>}
                <div className="st-modal-actions">
                  <button className="st-modal-cancel" onClick={closeResetModal} disabled={resetState === 'sending'}>Cancel</button>
                  <button className="st-modal-send" onClick={sendResetEmail} disabled={resetState === 'sending'}>
                    {resetState === 'sending' ? 'Sending…' : 'Send reset email'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
