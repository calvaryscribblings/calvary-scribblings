'use client';
// W2 — THE ONE DRAWN STATE FOR A READ THAT FAILED. Never "empty", never "0", never a spinner that
// does not end: a named failure (offline / slow / ours), a line saying what to do, and a Retry
// that shows it is working. Words: app/lib/unavailableCopy.js. Logic: app/lib/useReliable.js.
//
//   <Unavailable kind={failure} onRetry={retry} refreshing={refreshing} subject="your books" />
//
// `tone` is 'ink' (the dark spine, the default) or 'cream' (light grounds). `compact` is the
// in-section form, for one shelf of a page whose other shelves loaded.
import { UNAVAILABLE_COPY, copyFor, leadFor } from '../lib/unavailableCopy';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

const TONES = {
  // Measured on #080610: #c9a84c is 8.80:1, the body at 0.78 alpha is 10.77:1.
  ink: { text: '#f5f0e8', soft: 'rgba(245,240,232,0.78)', gold: '#c9a84c', rule: 'rgba(201,168,76,0.45)', btnBg: 'rgba(245,240,232,0.06)' },
  // Measured on #f5f0e8: #7f6726 (the derived cream gold) is 4.78:1, the body 8.21:1.
  cream: { text: '#1c1428', soft: 'rgba(28,20,40,0.78)', gold: '#7f6726', rule: 'rgba(127,103,38,0.45)', btnBg: 'rgba(28,20,40,0.04)' },
};

export default function Unavailable({ kind = 'ours', onRetry, refreshing = false, subject, note, tone = 'ink', compact = false, style }) {
  const t = TONES[tone] || TONES.ink;
  const copy = copyFor(kind);
  const lead = leadFor(subject);
  return (
    <div role="status" aria-live="polite" data-unavailable={kind}
      style={{ textAlign: 'center', padding: compact ? '24px 16px' : '56px 24px', maxWidth: 420, margin: '0 auto', ...style }}>
      {!compact && (
        <>
          <div style={{ fontFamily: LABEL, fontSize: 10, letterSpacing: '0.3em', color: t.gold }}>{UNAVAILABLE_COPY.eyebrow}</div>
          <div aria-hidden="true" style={{ width: 56, height: 1, background: t.rule, margin: '8px auto 0' }} />
        </>
      )}
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: compact ? 19 : 24, lineHeight: 1.25, color: t.text, margin: compact ? 0 : '20px 0 0', textWrap: 'balance' }}>
        {lead || copy.title}
      </h2>
      <p style={{ fontFamily: DISPLAY, fontSize: compact ? 15 : 16, lineHeight: 1.55, color: t.soft, margin: '8px 0 0', textWrap: 'pretty' }}>
        {lead ? `${copy.title}. ${copy.body}` : copy.body}{note ? ` ${note}` : ''}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={refreshing} aria-busy={refreshing}
          style={{
            marginTop: compact ? 16 : 24, minHeight: 44, minWidth: 132, padding: '0 24px', borderRadius: 999,
            fontFamily: LABEL, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: t.text, background: t.btnBg, border: `1px solid ${t.rule}`,
            cursor: refreshing ? 'progress' : 'pointer', opacity: refreshing ? 0.7 : 1,
          }}>
          {refreshing ? UNAVAILABLE_COPY.retrying : UNAVAILABLE_COPY.retry}
        </button>
      )}
    </div>
  );
}
