'use client';

import { useEffect, useRef, useState } from 'react';
import { ref, get, update } from 'firebase/database';
import { db } from '../../lib/firebase';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

function normalizeHandle(v) {
  return (v || '').trim().replace(/^@/, '').toLowerCase();
}

// Modal for scaffolding a new author from the admin page. Writes a
// synthetic-UID user record (author_<handle>) with isAuthor + isBylineOnly,
// plus the usernames/{handle} index entry. Skips story_authors/ on purpose
// so the new row shows "Not set up" until an admin fills the bio in.
export default function AddAuthorModal({ open, onClose, onAdded }) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName(''); setHandle(''); setErrMsg(''); setSubmitting(false);
      setTimeout(() => nameRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) return null;

  const trimmedName = name.trim();
  const normalizedHandle = normalizeHandle(handle);
  const handleValid = HANDLE_RE.test(normalizedHandle);
  const canSubmit = trimmedName.length > 0 && handleValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setErrMsg('');
    try {
      const idxSnap = await get(ref(db, `usernames/${normalizedHandle}`));
      if (idxSnap.exists()) {
        setErrMsg(`@${normalizedHandle} is already taken. Try a different handle.`);
        setSubmitting(false);
        return;
      }
      const uid = `author_${normalizedHandle}`;
      await update(ref(db), {
        [`users/${uid}/displayName`]: trimmedName,
        [`users/${uid}/username`]: normalizedHandle,
        [`users/${uid}/isAuthor`]: true,
        [`users/${uid}/isBylineOnly`]: true,
        [`users/${uid}/joinDate`]: Date.now(),
        [`usernames/${normalizedHandle}`]: uid,
      });
      onAdded?.(trimmedName);
      onClose?.();
    } catch (e) {
      setErrMsg('Could not add author. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  const handleHint = handle.length === 0
    ? 'Lowercase letters, numbers, underscores. 3–20 characters.'
    : !handleValid
      ? 'Lowercase letters, numbers, underscores only. 3–20 characters.'
      : `Will be saved as @${normalizedHandle}`;

  return (
    <div
      className="aam-backdrop"
      onClick={e => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <style>{`
        .aam-backdrop {
          position: fixed; inset: 0; z-index: 1100;
          background: rgba(0,0,0,0.84);
          display: flex; align-items: flex-end; justify-content: center;
          padding: 0;
        }
        @media (min-width: 600px) {
          .aam-backdrop { align-items: center; padding: 1rem; }
        }
        .aam-modal {
          background: #111;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px 20px 0 0;
          width: 100%; max-width: 460px;
          padding: 1.9rem 1.6rem;
          font-family: Inter, sans-serif;
        }
        @media (min-width: 600px) { .aam-modal { border-radius: 18px; } }

        .aam-title {
          font-family: Cochin, 'Cormorant Garamond', Georgia, serif;
          font-size: 1.5rem; color: #f5f0e8;
          margin: 0 0 0.4rem;
          line-height: 1.15;
        }
        .aam-subtitle {
          font-size: 0.78rem;
          color: rgba(232,224,212,0.55);
          line-height: 1.55;
          margin-bottom: 1.4rem;
        }
        .aam-label {
          font-size: 0.62rem;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.14em;
          text-transform: uppercase;
          margin-bottom: 0.42rem;
          font-weight: 600;
        }
        .aam-field { margin-bottom: 1.05rem; }
        .aam-input {
          width: 100%;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 0.72rem 0.88rem;
          font-size: 0.92rem;
          color: #f5f0e8;
          font-family: Inter, sans-serif;
          outline: none;
          transition: border-color 0.18s, background 0.18s;
          box-sizing: border-box;
        }
        .aam-input::placeholder { color: rgba(255,255,255,0.22); }
        .aam-input:focus {
          border-color: rgba(167,139,250,0.55);
          background: rgba(255,255,255,0.05);
        }
        .aam-input-row {
          display: flex; align-items: stretch;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          transition: border-color 0.18s, background 0.18s;
        }
        .aam-input-row:focus-within {
          border-color: rgba(167,139,250,0.55);
          background: rgba(255,255,255,0.05);
        }
        .aam-prefix {
          padding: 0.72rem 0.55rem 0.72rem 0.88rem;
          color: rgba(167,139,250,0.7);
          font-size: 0.92rem;
          font-family: Inter, sans-serif;
        }
        .aam-input-row .aam-input {
          background: transparent;
          border: none;
          padding-left: 0;
        }
        .aam-input-row .aam-input:focus { background: transparent; }
        .aam-hint {
          font-size: 0.7rem;
          color: rgba(255,255,255,0.38);
          margin-top: 0.4rem;
          line-height: 1.5;
        }
        .aam-err {
          font-size: 0.74rem;
          color: #f0a59a;
          margin: 0.6rem 0 0.2rem;
          line-height: 1.5;
        }
        .aam-actions {
          display: flex; gap: 0.55rem;
          margin-top: 1.4rem;
        }
        .aam-cancel, .aam-submit {
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
          border: 1px solid transparent;
        }
        .aam-cancel {
          background: none;
          border-color: rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.5);
        }
        .aam-cancel:hover:not(:disabled) {
          color: rgba(255,255,255,0.85);
          border-color: rgba(255,255,255,0.22);
        }
        .aam-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
        .aam-submit {
          background: #6b2fad;
          border-color: #6b2fad;
          color: #fff;
        }
        .aam-submit:hover:not(:disabled) { background: #7d3bc4; border-color: #7d3bc4; }
        .aam-submit:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>

      <div className="aam-modal" role="dialog" aria-modal="true" aria-labelledby="aam-title">
        <h2 id="aam-title" className="aam-title">Add a new author</h2>
        <div className="aam-subtitle">
          Creates a byline-only profile. The author can be edited and given a bio
          afterwards.
        </div>

        <div className="aam-field">
          <div className="aam-label">Name</div>
          <input
            ref={nameRef}
            type="text"
            className="aam-input"
            placeholder="e.g. Maurice Bur"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={submitting}
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>

        <div className="aam-field">
          <div className="aam-label">Handle</div>
          <div className="aam-input-row">
            <span className="aam-prefix">@</span>
            <input
              type="text"
              className="aam-input"
              placeholder="maurice"
              value={handle}
              onChange={e => setHandle(e.target.value.replace(/^@/, ''))}
              disabled={submitting}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </div>
          <div className="aam-hint">{handleHint}</div>
        </div>

        {errMsg && <div className="aam-err">{errMsg}</div>}

        <div className="aam-actions">
          <button className="aam-cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="aam-submit" onClick={submit} disabled={!canSubmit}>
            {submitting ? 'Adding…' : 'Add author'}
          </button>
        </div>
      </div>
    </div>
  );
}
