'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { ref, update, serverTimestamp } from 'firebase/database';
import { auth, db } from '../lib/firebase';

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Modal that walks the user through the soft-delete confirmation:
// 1) types their own @username (case-insensitive) to enable the action
// 2) writes pendingDeletion + isDeleted to RTDB
// 3) signs them out and pushes /account/deleted
//
// `username` and `email` come from the parent. If username is missing
// (rare but possible — some legacy accounts have no @handle), we fall
// back to requiring the email-local-part as confirmation.
export default function DeleteAccountModal({ open, onClose, uid, username, email }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const inputRef = useRef(null);

  const fallbackHandle = (email || '').split('@')[0] || '';
  const expected = (username || fallbackHandle || '').toLowerCase();
  const placeholder = username || fallbackHandle || 'username';

  useEffect(() => {
    if (open) {
      setTyped('');
      setErrMsg('');
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) return null;

  const matched = expected.length > 0 && typed.trim().toLowerCase() === expected;

  const confirmDelete = async () => {
    if (!matched || submitting || !uid) return;
    setSubmitting(true);
    setErrMsg('');
    try {
      const scheduledFor = Date.now() + GRACE_MS;
      // Single multi-path update so the flag and the schedule land atomically.
      await update(ref(db), {
        [`users/${uid}/isDeleted`]: true,
        [`users/${uid}/pendingDeletion/requestedAt`]: serverTimestamp(),
        [`users/${uid}/pendingDeletion/scheduledFor`]: scheduledFor,
      });
      await signOut(auth);
      router.push(`/account/deleted?on=${scheduledFor}`);
    } catch (e) {
      setErrMsg('Something went wrong. Please try again, or email Ikennaworksfromhome@gmail.com for help.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="dam-backdrop"
      onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}
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
          font-family: Inter, sans-serif;
        }
        @media (min-width: 600px) { .dam-modal { border-radius: 18px; } }

        .dam-title {
          font-family: Cochin, 'Cormorant Garamond', Georgia, serif;
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

        .dam-recover {
          font-size: 0.74rem;
          color: rgba(167,139,250,0.78);
          background: rgba(107,47,173,0.07);
          border: 1px solid rgba(107,47,173,0.18);
          border-radius: 8px;
          padding: 0.65rem 0.78rem;
          margin-bottom: 1.2rem;
          line-height: 1.55;
          font-family: Inter, sans-serif;
        }

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
          font-family: Inter, sans-serif;
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
          font-family: Inter, sans-serif;
          font-size: 0.62rem;
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
          font-family: 'Cormorant Garamond', Cochin, Georgia, serif;
          font-style: italic;
          font-weight: 400;
          font-size: 0.94rem;
          color: rgba(232,224,212,0.45);
          text-align: center;
          margin-top: 1.3rem;
        }
      `}</style>

      <div className="dam-modal" role="dialog" aria-modal="true">
        <h2 className="dam-title">This will delete your account</h2>

        <div className="dam-body">
          We&rsquo;ll <strong>schedule</strong> the deletion for <strong>seven days</strong> from now.
          Your account is locked from sign-in immediately, and your content is hidden from the
          rest of the platform straight away.
        </div>

        <ul className="dam-list">
          <li>your account, profile, and @handle</li>
          <li>any stories you&rsquo;ve published on the CMS</li>
          <li>your Square posts, replies, and quote-posts</li>
          <li>your reactions, comments, and mentions</li>
          <li>your badges, points, streak, and leaderboard position</li>
          <li>your followers and following list</li>
        </ul>

        <div className="dam-recover">
          Changed your mind? Email{' '}
          <strong>Ikennaworksfromhome@gmail.com</strong> within 7 days from the address on the account
          and we&rsquo;ll restore everything.
        </div>

        <div className="dam-label">Type your username to confirm</div>
        <input
          ref={inputRef}
          type="text"
          className={`dam-input ${matched ? 'matched' : ''}`}
          placeholder={placeholder}
          value={typed}
          onChange={e => setTyped(e.target.value)}
          disabled={submitting}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
        />

        {errMsg && <div className="dam-err">{errMsg}</div>}

        <div className="dam-actions">
          <button className="dam-cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="dam-delete"
            onClick={confirmDelete}
            disabled={!matched || submitting}
          >
            {submitting ? 'Deleting…' : 'Delete account'}
          </button>
        </div>

        <div className="dam-signoff">We&rsquo;re sorry to see you go.</div>
      </div>
    </div>
  );
}
