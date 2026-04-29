'use client';

const TIER_STYLES = {
  bronze:   { background: '#c97c2f', color: '#fff',     border: 'none' },
  silver:   { background: '#c0c0c8', color: '#3a3f4b', border: 'none' },
  gold:     { background: '#c9a44c', color: '#fff',     border: 'none' },
  platinum: { background: '#c8daea', color: '#3a3f4b', border: 'none' },
};

const TIER_LABELS = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
};

export default function QuizPill({ hasQuiz, userTier, scribblesReward, scorePct, locked }) {
  if (!hasQuiz) return null;

  if (locked) {
    return (
      <span
        title="Hardball not passed"
        style={{
          position: 'absolute', top: '0.5rem', right: '0.5rem',
          fontSize: '0.6875rem', fontFamily: 'Inter, sans-serif',
          fontWeight: 600, letterSpacing: '0.04em',
          padding: '0.25rem 0.5rem', borderRadius: 999, lineHeight: 1,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          background: '#9f4747', color: '#fff',
          border: 'none',
        }}
      >
        Locked
      </span>
    );
  }

  const label     = userTier ? TIER_LABELS[userTier] : '✦ Quiz';
  const tooltip   = userTier
    ? `${TIER_LABELS[userTier]} tier · ${scorePct}%`
    : `Earn up to ${scribblesReward} Scribbles`;
  const tierStyle = userTier
    ? TIER_STYLES[userTier]
    : { background: '#6b2fad', color: '#fff', border: 'none' };

  return (
    <span
      title={tooltip}
      style={{
        position: 'absolute',
        top: '0.5rem',
        right: '0.5rem',
        fontSize: '0.6875rem',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '0.25rem 0.5rem',
        borderRadius: 999,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        ...tierStyle,
      }}
    >
      {label}
    </span>
  );
}
