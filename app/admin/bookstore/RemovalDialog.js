'use client';
// ═══════════════════════════════════════════════════════════════════════════════════════════
// TAKING A TITLE OFF THE SHELF — the two dialogs, and the one they replace.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// R21. Before this file, /admin/bookstore could Publish and Unpublish, and that was the whole
// vocabulary: Ikenna could not remove a title at all, and the comment on `deleteTitle` pointed
// at the Firebase console. Two rulings shape what replaced it.
//
//   1. ADMIN HAS COMPLETE CONTROL. Neither dialog has a "this title cannot be removed" branch.
//   2. WE NEVER TAKE BACK BOUGHT TITLES. The delete dialog's FIRST sentence is that the readers
//      who own it keep it — because that is the founder's actual fear at this moment, and a
//      confirm step that leaves it unanswered is a confirm step that gets clicked through.
//
// ── WHY THE DELETE DIALOG COUNTS BEFORE IT OPENS ───────────────────────────────────────────
//
// It does not open on the click. It calls deletionPreview() first, reads the LIVE owner count
// from bookstore_readership, and renders nothing until the number is in hand. A dialog that
// opened immediately and filled the number in afterwards would have a state in which the
// consequence sentence is missing while the Delete button is already there, and that state is
// the whole failure this design is avoiding.
//
// If the count cannot be read, THERE IS NO DIALOG — only the error. The delete path refuses on
// an unknown count anyway (ruling 2, failing closed), so offering the button would be offering
// something that cannot happen.
//
// ── NEVER A BARE 'ARE YOU SURE' ────────────────────────────────────────────────────────────
//
// The sentence comes from confirmConsequence() in app/lib/bookstore/withdrawal.js, not from
// this component. One wording, asserted against the count in
// tests/bookstore/withdrawal.test.mjs, and no second copy here to drift from it.
import { useEffect, useState } from 'react';
import { nameMatches } from '../../lib/bookstore/withdrawal';

const s = {
  scrim: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1200,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
  },
  panel: {
    background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12,
    padding: '1.75rem', maxWidth: 'min(94vw, 34rem)', width: '100%',
    fontFamily: 'Cormorant Garamond, Georgia, serif', color: '#e8e8e8',
    boxShadow: '0 24px 64px rgba(0,0,0,0.7)', maxHeight: '90vh', overflowY: 'auto',
  },
  kicker: { fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#c4b5fd', marginBottom: '0.6rem' },
  kickerDanger: { color: '#f87171' },
  h: { fontSize: '1.2rem', fontWeight: 700, color: '#fff', margin: '0 0 0.9rem' },
  // THE CONSEQUENCE. Set larger and lighter than the furniture round it because it is the only
  // thing in this panel that has to be read rather than scanned.
  consequence: { fontSize: '1rem', lineHeight: 1.65, color: '#e8e8e8', margin: '0 0 1.1rem' },
  note: { fontSize: '0.78rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.5)', margin: '0 0 1.1rem' },
  files: { fontSize: '0.72rem', lineHeight: 1.7, color: 'rgba(255,255,255,0.42)', margin: '0 0 1.2rem', listStyle: 'none', padding: 0 },
  fileKept: { color: '#86efac' },
  label: { display: 'block', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa', marginBottom: '0.45rem' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 74, resize: 'vertical' },
  fg: { marginBottom: '1.1rem' },
  hint: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.55, marginTop: '0.4rem' },
  err: { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 6, padding: '0.75rem 0.9rem', color: '#fca5a5', fontSize: '0.8rem', lineHeight: 1.5, marginBottom: '1rem' },
  actions: { display: 'flex', gap: '0.7rem', justifyContent: 'flex-end', marginTop: '0.4rem' },
  cancel: { background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid #2e2e2e', padding: '0.6rem 1.25rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  go: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.6rem 1.4rem', borderRadius: 6, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  goDanger: { background: 'linear-gradient(135deg, #b91c1c, #dc2626)' },
  goOff: { opacity: 0.4, cursor: 'not-allowed' },
};

/** <input type="date"> speaks local dates; the record speaks epoch ms. One conversion, here. */
function endOfDayMs(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  // THE LICENCE RUNS OUT AT THE END OF THE DAY IT NAMES, not at its first millisecond. A
  // publisher who says "we have it until 31 March" means the 31st is a day the book is on
  // sale. 23:59:59.999 local, which is what the founder typing the date is thinking in.
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function WithdrawDialog({ title, onCancel, onConfirm }) {
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(null);

  // The clock, read ONCE when the dialog opens. A dialog that re-read Date.now() on every
  // keystroke would be re-deciding "is this date in the future" mid-typing, and React's purity
  // rule forbids it for exactly that reason.
  const [openedAt] = useState(() => Date.now());
  const scheduledFor = endOfDayMs(when);
  const dated = !!when && !!scheduledFor;
  const future = dated && scheduledFor > openedAt;

  async function go() {
    setBusy(true);
    setErrors(null);
    const res = await onConfirm({ scheduledFor: dated ? scheduledFor : null, reason: reason.trim() || null });
    setBusy(false);
    if (res && res.ok === false) setErrors(res.errors || ['Withdrawal failed']);
  }

  return (
    <div style={s.scrim} role="dialog" aria-modal="true" aria-label={`Withdraw ${title.title}`}>
      <div style={s.panel}>
        <div style={s.kicker}>Withdraw from the shop</div>
        <h3 style={s.h}>{title.title}</h3>

        {errors && <div style={s.err} data-testid="withdraw-errors">{errors.join(' ')}</div>}

        {/* Ruling 2, said before the act rather than after it. This is the same promise the
            delete dialog opens with, because it is the same promise. */}
        <p style={s.consequence} data-testid="withdraw-consequence">
          {future
            ? 'This book stays on the shelf until the date below, then leaves it. Readers who bought it keep it either way — it stays in their library and they can still read it.'
            : 'This book leaves the shelf: no listing, no page, no sample, and it stops being sellable. Readers who bought it keep it — it stays in their library and they can still read it.'}
        </p>
        <p style={s.note}>
          You can put it back at any time. Nothing about the record, the files or the curated
          sections that claim it is changed.
        </p>

        <div style={s.fg}>
          <label style={s.label} htmlFor="wd-date">Withdrawal date <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'rgba(255,255,255,0.35)' }}>— optional</span></label>
          <input
            id="wd-date"
            style={s.input}
            type="date"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            data-testid="withdraw-date"
          />
          <p style={s.hint}>
            {future
              ? 'Set for a fixed-term licence. The book stays on sale until the end of that day, '
                + 'then a scheduled job takes it off and rebuilds the site — within about an hour '
                + 'of the date passing, not at the stroke of midnight.'
              : 'Leave blank to withdraw now. A date in the future sets a fixed-term licence.'}
          </p>
        </div>

        <div style={s.fg}>
          <label style={s.label} htmlFor="wd-reason">Reason <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'rgba(255,255,255,0.35)' }}>— optional, never shown publicly</span></label>
          <textarea id="wd-reason" style={s.textarea} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Licence expired, publisher request…" />
        </div>

        <div style={s.actions}>
          <button type="button" style={s.cancel} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" style={busy ? { ...s.go, ...s.goOff } : s.go} onClick={go} disabled={busy} data-testid="withdraw-confirm">
            {busy ? 'Withdrawing…' : future ? 'Schedule withdrawal' : 'Withdraw'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * THE DELETE DIALOG. It does not render until `preview` is in hand — see the header.
 *
 * `preview` is deletionPreview()'s result: the live owner count, the consequence sentence built
 * from it, and the two file lists. Nothing here recomputes any of that.
 */
export function DeleteDialog({ title, preview, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(null);
  const armed = nameMatches(typed, title.title);

  // Focus goes to the field the founder has to fill in, not to the button they must not press
  // by accident.
  useEffect(() => {
    const el = document.getElementById('del-name');
    if (el) el.focus();
  }, []);

  async function go() {
    if (!armed) return;
    setBusy(true);
    setErrors(null);
    const res = await onConfirm({ confirmName: typed });
    setBusy(false);
    if (res && res.ok === false) setErrors(res.errors || ['Delete failed']);
  }

  return (
    <div style={s.scrim} role="dialog" aria-modal="true" aria-label={`Delete ${title.title}`}>
      <div style={s.panel}>
        <div style={{ ...s.kicker, ...s.kickerDanger }}>Delete permanently</div>
        <h3 style={s.h}>{title.title}</h3>

        {errors && <div style={s.err} data-testid="delete-errors">{errors.join(' ')}</div>}

        {/* THE COUNT AND THE CONSEQUENCE, FROM LIVE DATA. Built in withdrawal.js so the wording
            and the number cannot be assembled two ways. */}
        <p style={s.consequence} data-testid="delete-consequence">{preview.consequence}</p>

        <ul style={s.files} data-testid="delete-files">
          {preview.filesKept.map((p) => (
            <li key={`k-${p}`} style={s.fileKept}>✓ kept — {p}</li>
          ))}
          {preview.filesRemoved.map((p) => (
            <li key={`d-${p}`}>× removed — {p}</li>
          ))}
        </ul>
        {preview.ownerCount > 0 && (
          <p style={s.note}>
            The book file itself is not deleted, because people are reading it. That is not a
            setting — it is the rule.
          </p>
        )}

        <div style={s.fg}>
          <label style={s.label} htmlFor="del-name">Type the title&rsquo;s name to confirm</label>
          <input
            id="del-name"
            style={s.input}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={title.title}
            autoComplete="off"
            data-testid="delete-name"
          />
          <p style={s.hint}>Deleting removes the record and its curated claims. It cannot be undone.</p>
        </div>

        <div style={s.actions}>
          <button type="button" style={s.cancel} onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            style={armed && !busy ? { ...s.go, ...s.goDanger } : { ...s.go, ...s.goDanger, ...s.goOff }}
            onClick={go}
            disabled={!armed || busy}
            data-testid="delete-confirm"
          >
            {busy ? 'Deleting…' : 'Delete this title'}
          </button>
        </div>
      </div>
    </div>
  );
}
