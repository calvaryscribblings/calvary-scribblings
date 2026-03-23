'use client';

import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function AuthModal({ onClose }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'register' | 'forgot'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

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
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name.trim() });
        onClose();
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
      setError(msgs[e.code] || 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const titles = { signin: 'Welcome back', register: 'Create account', forgot: 'Reset password' };
  const subtitles = {
    signin: 'Sign in to your Calvary Scribblings account',
    register: 'Join the Calvary Scribblings community',
    forgot: 'Enter your email and we\'ll send a reset link',
  };
  const buttonLabels = { signin: 'Sign In', register: 'Create Account', forgot: 'Send Reset Link' };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&display=swap');

        .auth-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(8px);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .auth-modal {
          background: #111;
          border: 1px solid rgba(124,58,237,0.2);
          border-radius: 8px;
          width: 100%;
          max-width: 420px;
          padding: 2.5rem;
          position: relative;
          animation: slideUp 0.3s cubic-bezier(0.22,1,0.36,1);
          box-shadow: 0 0 80px rgba(124,58,237,0.12);
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .auth-close {
          position: absolute;
          top: 1rem;
          right: 1.25rem;
          background: none;
          border: none;
          color: rgba(232,224,212,0.35);
          font-size: 1.4rem;
          cursor: pointer;
          line-height: 1;
          transition: color 0.2s;
        }
        .auth-close:hover { color: #e8e0d4; }

        .auth-logo {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 0.85rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(232,224,212,0.4);
          margin-bottom: 1.75rem;
        }
        .auth-logo span { color: #7c3aed; }

        .auth-title {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 2rem;
          font-weight: 300;
          color: #f0ebe2;
          margin-bottom: 0.4rem;
          line-height: 1.1;
        }

        .auth-subtitle {
          font-size: 0.82rem;
          color: rgba(232,224,212,0.45);
          margin-bottom: 2rem;
          letter-spacing: 0.02em;
        }

        .auth-field {
          margin-bottom: 1rem;
        }

        .auth-label {
          display: block;
          font-size: 0.7rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(232,224,212,0.4);
          margin-bottom: 0.4rem;
        }

        .auth-input {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 4px;
          padding: 0.75rem 1rem;
          font-size: 0.95rem;
          color: #e8e0d4;
          font-family: 'Cormorant Garamond', Georgia, serif;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
        }
        .auth-input:focus {
          border-color: rgba(124,58,237,0.5);
          box-shadow: 0 0 0 3px rgba(124,58,237,0.08);
        }
        .auth-input::placeholder { color: rgba(232,224,212,0.2); }

        .auth-btn {
          width: 100%;
          background: #7c3aed;
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 0.85rem;
          font-size: 0.85rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          margin-top: 0.5rem;
          transition: background 0.2s, transform 0.1s;
          font-family: 'Cormorant Garamond', Georgia, serif;
        }
        .auth-btn:hover { background: #6d28d9; }
        .auth-btn:active { transform: scale(0.98); }
        .auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .auth-error {
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 4px;
          padding: 0.65rem 0.9rem;
          font-size: 0.82rem;
          color: #fca5a5;
          margin-bottom: 1rem;
        }

        .auth-success {
          background: rgba(34,197,94,0.1);
          border: 1px solid rgba(34,197,94,0.25);
          border-radius: 4px;
          padding: 0.65rem 0.9rem;
          font-size: 0.82rem;
          color: #86efac;
          margin-bottom: 1rem;
        }

        .auth-divider {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 1.5rem 0;
        }
        .auth-divider::before, .auth-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.06);
        }
        .auth-divider span {
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(232,224,212,0.25);
        }

        .auth-switch {
          text-align: center;
          font-size: 0.82rem;
          color: rgba(232,224,212,0.4);
          margin-top: 1.25rem;
        }
        .auth-switch button {
          background: none;
          border: none;
          color: #a78bfa;
          cursor: pointer;
          font-size: inherit;
          padding: 0;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .auth-switch button:hover { color: #c4b5fd; }

        .auth-forgot {
          text-align: right;
          margin-top: -0.25rem;
          margin-bottom: 0.75rem;
        }
        .auth-forgot button {
          background: none;
          border: none;
          color: rgba(167,139,250,0.6);
          font-size: 0.75rem;
          cursor: pointer;
          padding: 0;
        }
        .auth-forgot button:hover { color: #a78bfa; }
      `}</style>

      <div className="auth-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="auth-modal">
          <button className="auth-close" onClick={onClose}>x</button>

          <div className="auth-logo">Calvary <span>Scribblings</span></div>

          <h2 className="auth-title">{titles[mode]}</h2>
          <p className="auth-subtitle">{subtitles[mode]}</p>

          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}

          {mode === 'register' && (
            <div className="auth-field">
              <label className="auth-label">Full Name</label>
              <input
                className="auth-input"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          )}

          <div className="auth-field">
            <label className="auth-label">Email Address</label>
            <input
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          {mode !== 'forgot' && (
            <div className="auth-field">
              <label className="auth-label">Password</label>
              <input
                className="auth-input"
                type="password"
                placeholder="â˘â˘â˘â˘â˘â˘â˘â˘"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          )}

          {mode === 'signin' && (
            <div className="auth-forgot">
              <button onClick={() => switchMode('forgot')}>Forgot password?</button>
            </div>
          )}

          {mode !== 'forgot' && (
  <>
    <button
      onClick={async () => {
        try {
          const provider = new GoogleAuthProvider();
          await signInWithPopup(auth, provider);
          onClose();
        } catch (e) {
          setError('Google sign-in failed. Please try again.');
        }
      }}
      style={{
        width: '100%',
        background: '#fff',
        color: '#1f1f1f',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 4,
        padding: '0.85rem',
        fontSize: '0.85rem',
        fontWeight: 600,
        letterSpacing: '0.05em',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.6rem',
        marginTop: '0.5rem',
        fontFamily: "'Cormorant Garamond', Georgia, serif",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Continue with Google
    </button>
    <div className="auth-divider"><span>or</span></div>
  </>
)}<button className="auth-btn" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Please wait...' : buttonLabels[mode]}
          </button>

          <div className="auth-switch">
            {mode === 'signin' && (
              <span>Don't have an account? <button onClick={() => switchMode('register')}>Create one</button></span>
            )}
            {mode === 'register' && (
              <span>Already have an account? <button onClick={() => switchMode('signin')}>Sign in</button></span>
            )}
            {mode === 'forgot' && (
              <span>Remember your password? <button onClick={() => switchMode('signin')}>Sign in</button></span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}