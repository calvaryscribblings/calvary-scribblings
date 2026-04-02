'use client';

import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { getDatabase, ref, set } from 'firebase/database';
import { auth } from '../lib/firebase';

export default function AuthModal({ onClose }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'register' | 'forgot' | 'verify'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);

  const clearMessages = () => { setError(''); setSuccess(''); };
  const switchMode = (m) => { setMode(m); clearMessages(); };

  const handleSubmit = async () => {
    clearMessages();
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
        onClose();
      } else if (mode === 'register') {
        if (!name.trim()) { setError('Please enter your name.'); setLoading(false); return; }
        if (password !== confirmPassword) { setError('Passwords do not match.'); setLoading(false); return; }
        if (!dob) { setError('Please enter your date of birth.'); setLoading(false); return; }
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name.trim() });
        // Save date of birth to Firebase
        const { getApp } = await import('firebase/app');
const db = getDatabase(getApp());
await set(ref(db, `users/${cred.user.uid}/dob`), dob);
        // Send email verification
        await sendEmailVerification(cred.user);
        // Send welcome email — non-blocking
        fetch('https://calvary-auth.calvarymediauk.workers.dev/welcome', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_AUTH_SECRET}`,
          },
          body: JSON.stringify({ email, firstName: name.trim().split(' ')[0] }),
        }).catch(() => {});
        // Show verify screen
        switchMode('verify');
      } else if (mode === 'forgot') {
        await sendPasswordResetEmail(auth, email);
        setSuccess('Password reset email sent. Check your inbox.');
      }
    } catch (e) {
      const msgs = {
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/invalid-credential': 'Incorrect email or password.',
      };
      setError(msgs[e.code] || e.message || 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    clearMessages();
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      onClose();
    } catch (e) {
      setError('Google sign-in failed. Please try again.');
    }
  };

  const handleResend = async () => {
    if (resendCooldown) return;
    try {
      const user = auth.currentUser;
      if (user) {
        await sendEmailVerification(user);
        setResendCooldown(true);
        setSuccess('Verification email resent.');
        setTimeout(() => setResendCooldown(false), 30000);
      }
    } catch (e) {
      setError('Could not resend. Please try again shortly.');
    }
  };

  const titles = {
    signin: 'Welcome back.',
    register: 'Join the island.',
    forgot: 'Reset password.',
    verify: 'Check your inbox.',
  };
  const subtitles = {
    signin: 'Sign in to your account',
    register: 'Create your free reader account',
    forgot: "Enter your email and we'll send a reset link",
    verify: `We've sent a verification link to ${email}`,
  };
  const buttonLabels = {
    signin: 'Sign in',
    register: 'Create account',
    forgot: 'Send reset link',
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Inter:wght@300;400;500&display=swap');

        .auth-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.88);
          backdrop-filter: blur(10px);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          animation: am-fade 0.2s ease;
          overflow-y: auto;
        }
        @keyframes am-fade { from { opacity: 0; } to { opacity: 1; } }

        .auth-modal {
          background: #0d0d0d;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 2px;
          width: 100%;
          max-width: 420px;
          position: relative;
          overflow: hidden;
          animation: am-up 0.3s cubic-bezier(0.22,1,0.36,1);
          margin: auto;
        }
        @keyframes am-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .auth-top-bar { height: 3px; background: #6b2fad; }
        .auth-inner { padding: 2.25rem 2.25rem 1.75rem; }

        .auth-close {
          position: absolute;
          top: 1.1rem;
          right: 1.25rem;
          background: none;
          border: none;
          color: rgba(255,255,255,0.2);
          font-size: 1.1rem;
          cursor: pointer;
          line-height: 1;
          font-family: 'Inter', sans-serif;
          font-weight: 300;
          transition: color 0.2s;
          z-index: 1;
        }
        .auth-close:hover { color: rgba(255,255,255,0.6); }

        .auth-eyebrow {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 0.68rem;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.28);
          margin-bottom: 1.5rem;
        }
        .auth-eyebrow span { color: #9b6dff; }

        .auth-title {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 2.2rem;
          font-weight: 300;
          color: #f5f0e8;
          line-height: 1.05;
          margin-bottom: 0.3rem;
          letter-spacing: -0.01em;
        }

        .auth-subtitle {
          font-size: 0.76rem;
          color: rgba(255,255,255,0.28);
          margin-bottom: 1.75rem;
          letter-spacing: 0.02em;
          font-family: 'Inter', sans-serif;
          font-weight: 300;
          line-height: 1.5;
        }

        .auth-error {
          background: rgba(220,38,38,0.08);
          border: 1px solid rgba(220,38,38,0.2);
          border-radius: 1px;
          padding: 0.6rem 0.85rem;
          font-size: 0.78rem;
          color: #fca5a5;
          margin-bottom: 1.1rem;
          font-family: 'Inter', sans-serif;
        }

        .auth-success {
          background: rgba(34,197,94,0.08);
          border: 1px solid rgba(34,197,94,0.2);
          border-radius: 1px;
          padding: 0.6rem 0.85rem;
          font-size: 0.78rem;
          color: #86efac;
          margin-bottom: 1.1rem;
          font-family: 'Inter', sans-serif;
        }

        .auth-google {
          width: 100%;
          background: #fff;
          border: none;
          border-radius: 1px;
          padding: 0.8rem;
          font-size: 0.82rem;
          font-weight: 500;
          color: #1f1f1f;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
          font-family: 'Inter', sans-serif;
          letter-spacing: 0.01em;
          margin-bottom: 1rem;
          transition: opacity 0.2s;
        }
        .auth-google:hover { opacity: 0.92; }

        .auth-or {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }
        .auth-or::before, .auth-or::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.06);
        }
        .auth-or span {
          font-size: 0.62rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.18);
          font-family: 'Inter', sans-serif;
        }

        .auth-field { margin-bottom: 1rem; }

        .auth-row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }

        .auth-label {
          display: block;
          font-size: 0.6rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.32);
          margin-bottom: 0.4rem;
          font-family: 'Inter', sans-serif;
          font-weight: 500;
        }

        .auth-dob-tag {
          font-size: 0.55rem;
          letter-spacing: 0.08em;
          background: rgba(107,47,173,0.15);
          border: 1px solid rgba(107,47,173,0.25);
          color: #9b6dff;
          padding: 0.1rem 0.45rem;
          border-radius: 1px;
          text-transform: uppercase;
          vertical-align: middle;
          margin-left: 0.4rem;
          font-family: 'Inter', sans-serif;
        }

        .auth-input {
          width: 100%;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 1px;
          padding: 0.78rem 0.95rem;
          font-size: 0.92rem;
          color: #e8e0d4;
          font-family: 'Cormorant Garamond', Georgia, serif;
          outline: none;
          transition: border-color 0.2s, background 0.2s;
          box-sizing: border-box;
        }
        .auth-input:focus {
          border-color: rgba(107,47,173,0.55);
          background: rgba(107,47,173,0.04);
        }
        .auth-input::placeholder {
          color: rgba(255,255,255,0.13);
          font-style: italic;
        }
        .auth-input[type="date"] { color-scheme: dark; font-family: 'Inter', sans-serif; font-size: 0.82rem; }

        .auth-hint {
          font-size: 0.62rem;
          color: rgba(255,255,255,0.18);
          margin-top: 0.3rem;
          font-style: italic;
          font-family: 'Inter', sans-serif;
        }

        .auth-forgot {
          text-align: right;
          margin-top: -0.4rem;
          margin-bottom: 0.85rem;
        }
        .auth-forgot button {
          background: none;
          border: none;
          color: rgba(155,109,255,0.5);
          font-size: 0.72rem;
          cursor: pointer;
          padding: 0;
          font-family: 'Inter', sans-serif;
          transition: color 0.2s;
        }
        .auth-forgot button:hover { color: #9b6dff; }

        .auth-btn {
          width: 100%;
          background: #6b2fad;
          border: none;
          border-radius: 1px;
          padding: 0.88rem;
          font-size: 0.68rem;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #fff;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          transition: background 0.2s, transform 0.1s;
        }
        .auth-btn:hover { background: #7c3aed; }
        .auth-btn:active { transform: scale(0.99); }
        .auth-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        .auth-footer {
          padding: 1rem 2.25rem;
          border-top: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.012);
          text-align: center;
        }
        .auth-footer p {
          font-size: 0.74rem;
          color: rgba(255,255,255,0.28);
          margin: 0;
          font-family: 'Inter', sans-serif;
        }
        .auth-footer button {
          background: none;
          border: none;
          color: #9b6dff;
          cursor: pointer;
          font-size: inherit;
          font-family: inherit;
          font-weight: 500;
          padding: 0;
          transition: color 0.2s;
        }
        .auth-footer button:hover { color: #c4b5fd; }

        .auth-verify-icon {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: rgba(107,47,173,0.12);
          border: 1px solid rgba(107,47,173,0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 0 1.5rem;
        }

        .auth-verify-steps {
          margin: 1.5rem 0;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .auth-verify-step {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          font-size: 0.78rem;
          color: rgba(255,255,255,0.45);
          font-family: 'Inter', sans-serif;
          line-height: 1.5;
        }
        .auth-verify-step-num {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: rgba(107,47,173,0.2);
          border: 1px solid rgba(107,47,173,0.3);
          color: #9b6dff;
          font-size: 0.6rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 1px;
          font-family: 'Inter', sans-serif;
        }

        .auth-resend {
          background: none;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 1px;
          width: 100%;
          padding: 0.78rem;
          font-size: 0.68rem;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.4);
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          transition: border-color 0.2s, color 0.2s;
          margin-top: 0.75rem;
        }
        .auth-resend:hover:not(:disabled) { border-color: rgba(107,47,173,0.4); color: #9b6dff; }
        .auth-resend:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>

      <div className="auth-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="auth-modal">
          <div className="auth-top-bar" />
          <button className="auth-close" onClick={onClose}>✕</button>

          <div className="auth-inner">
            <div className="auth-eyebrow">Calvary <span>Scribblings</span></div>

            {mode === 'verify' ? (
              <>
                <div className="auth-verify-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9b6dff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                  </svg>
                </div>
                <h2 className="auth-title">{titles.verify}</h2>
                <p className="auth-subtitle">{subtitles.verify}</p>

                {error && <div className="auth-error">{error}</div>}
                {success && <div className="auth-success">{success}</div>}

                <div className="auth-verify-steps">
                  <div className="auth-verify-step">
                    <div className="auth-verify-step-num">1</div>
                    <span>Open the email from Calvary Scribblings in your inbox</span>
                  </div>
                  <div className="auth-verify-step">
                    <div className="auth-verify-step-num">2</div>
                    <span>Click the verification link inside</span>
                  </div>
                  <div className="auth-verify-step">
                    <div className="auth-verify-step-num">3</div>
                    <span>Come back and sign in to start reading</span>
                  </div>
                </div>

                <button className="auth-btn" onClick={onClose}>Done — I'll verify shortly</button>
                <button className="auth-resend" onClick={handleResend} disabled={resendCooldown}>
                  {resendCooldown ? 'Email sent — check your inbox' : 'Resend verification email'}
                </button>
              </>
            ) : (
              <>
                <h2 className="auth-title">{titles[mode]}</h2>
                <p className="auth-subtitle">{subtitles[mode]}</p>

                {error && <div className="auth-error">{error}</div>}
                {success && <div className="auth-success">{success}</div>}

                {mode !== 'forgot' && (
                  <>
                    <button className="auth-google" onClick={handleGoogle}>
                      <svg width="16" height="16" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                      </svg>
                      Continue with Google
                    </button>
                    <div className="auth-or"><span>or</span></div>
                  </>
                )}

                {mode === 'register' && (
                  <div className="auth-field">
                    <label className="auth-label">Full name</label>
                    <input className="auth-input" type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
                  </div>
                )}

                <div className="auth-field">
                  <label className="auth-label">Email address</label>
                  <input className="auth-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                </div>

                {mode !== 'forgot' && (
                  mode === 'register' ? (
                    <div className="auth-row2">
                      <div className="auth-field">
                        <label className="auth-label">Password</label>
                        <input className="auth-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
                      </div>
                      <div className="auth-field">
                        <label className="auth-label">Confirm password</label>
                        <input className="auth-input" type="password" placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                      </div>
                    </div>
                  ) : (
                    <div className="auth-field">
                      <label className="auth-label">Password</label>
                      <input
                        className="auth-input"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                      />
                    </div>
                  )
                )}

                {mode === 'signin' && (
                  <div className="auth-forgot">
                    <button onClick={() => switchMode('forgot')}>Forgot password?</button>
                  </div>
                )}

                {mode === 'register' && (
                  <div className="auth-field">
                    <label className="auth-label">
                      Date of birth
                      <span className="auth-dob-tag">Age Go</span>
                    </label>
                    <input className="auth-input" type="date" value={dob} onChange={e => setDob(e.target.value)} />
                    <div className="auth-hint">Required to access age-restricted content</div>
                  </div>
                )}

                <button className="auth-btn" onClick={handleSubmit} disabled={loading}>
                  {loading ? 'Please wait...' : buttonLabels[mode]}
                </button>
              </>
            )}
          </div>

          {mode !== 'verify' && (
            <div className="auth-footer">
              <p>
                {mode === 'signin' && <>No account? <button onClick={() => switchMode('register')}>Create one — it's free</button></>}
                {mode === 'register' && <>Already a member? <button onClick={() => switchMode('signin')}>Sign in</button></>}
                {mode === 'forgot' && <>Remember your password? <button onClick={() => switchMode('signin')}>Sign in</button></>}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}