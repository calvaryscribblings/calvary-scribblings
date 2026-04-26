'use client';

const TIER_STYLES = {
  bronze:   { background: '#a97142',                                            color: '#fff',     border: 'none' },
  silver:   { background: '#9ca3af',                                            color: '#fff',     border: 'none' },
  gold:     { background: '#d4a437',                                            color: '#fff',     border: 'none' },
  platinum: { background: 'linear-gradient(135deg, #f5f5f5 0%, #e8e6e1 100%)', color: '#3a3f4b', border: '1px solid #3a3f4b' },
};

const TIER_LABELS = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
};

export default function QuizPill({ hasQuiz, userTier, scribblesReward, scorePct }) {
  if (!hasQuiz) return null;

  const label     = userTier ? TIER_LABELS[userTier] : '✦ Quiz';
  const tooltip   = userTier
    ? `${TIER_LABELS[userTier]} tier · ${scorePct}%`
    : `Earn up to ${scribblesReward} Scribbles`;
  const tierStyle = userTier
    ? TIER_STYLES[userTier]
    : { background: 'rgba(255,255,255,0.9)', color: '#6b2fad', border: 'none' };

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
