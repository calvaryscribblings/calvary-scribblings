'use client';

import { useState, useEffect, useRef } from 'react';

const TIER_STYLES = {
  platinum: { color: '#c8daea', glow: 'rgba(200,218,234,0.3)', label: 'Platinum' },
  gold:     { color: '#c9a44c', glow: 'rgba(201,164,76,0.3)',  label: 'Gold' },
  silver:   { color: '#c0c0c8', glow: 'rgba(192,192,200,0.3)', label: 'Silver' },
  bronze:   { color: '#c97c2f', glow: 'rgba(201,124,47,0.3)',  label: 'Bronze' },
};

const RADIUS = 80;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function DialCircle({ percent }) {
  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="dialGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6b2fad" />
          <stop offset="100%" stopColor="#c9a44c" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
      <circle
        cx="100" cy="100" r={RADIUS}
        fill="none"
        stroke="url(#dialGrad)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 100 100)"
        style={{ transition: 'stroke-dashoffset 0.05s linear' }}
      />
      <text x="100" y="94" textAnchor="middle" fill="#f5f0e8"
        fontSize="32" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="300">
        {Math.round(percent)}%
      </text>
      <text x="100" y="116" textAnchor="middle" fill="rgba(240,234,216,0.35)"
        fontSize="11" fontFamily="Inter, sans-serif" letterSpacing="2">
        SCORE
      </text>
    </svg>
  );
}

function Particles({ visible }) {
  if (!visible) return null;
  const particles = Array.from({ length: 10 }, (_, i) => {
    const spread = 140;
    const baseAngle = -75;
    const angle = (baseAngle + (i * spread / 9)) * (Math.PI / 180);
    const dist = 100 + (i % 3) * 40;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const delay = i * 60;
    return { tx, ty, delay, color: i % 2 === 0 ? '#c9a44c' : '#9b6dff', size: i % 3 === 0 ? 7 : 5 };
  });
  return (
    <>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: p.size,
          height: p.size,
          borderRadius: '50%',
          background: p.color,
          top: '50%',
          left: '50%',
          marginTop: -(p.size / 2),
          marginLeft: -(p.size / 2),
          opacity: 0,
          animation: `qra-particle 0.9s ease-out ${p.delay}ms forwards`,
          '--tx': `${p.tx}px`,
          '--ty': `${p.ty}px`,
        }} />
      ))}
    </>
  );
}

export default function QuizResultAnimation({ result, onDone }) {
  const [phase, setPhase] = useState(0);
  const [dialPercent, setDialPercent] = useState(0);
  const doneRef = useRef(false);
  const rafRef = useRef(null);

  const tierStyle = result.tier ? TIER_STYLES[result.tier] : null;

  function finish() {
    if (!doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 2500);
    const t2 = setTimeout(() => setPhase(2), 6500);
    const t3 = setTimeout(() => setPhase(3), 9500);
    const t4 = setTimeout(() => finish(), 11500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  useEffect(() => {
    if (phase !== 1) return;
    const duration = 3200;
    const startTime = Date.now();
    const target = result.totalPercent;

    function tick() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDialPercent(eased * target);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9500,
      background: 'rgba(10,10,10,0.97)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@400;500;600&display=swap');
        @keyframes qra-shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes qra-badge-in {
          from { opacity: 0; transform: translateY(20px) scale(0.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes qra-scribbles-in {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes qra-particle {
          from { opacity: 1; transform: translate(0, 0) scale(1); }
          to { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.2); }
        }
        @keyframes qra-glow-pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
      `}</style>

      {/* Skip */}
      <button
        onClick={finish}
        style={{
          position: 'absolute', top: 24, right: 24,
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,0.2)', fontSize: '0.7rem',
          fontFamily: 'Inter, sans-serif', letterSpacing: '0.12em',
          textTransform: 'uppercase', cursor: 'pointer',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}
      >
        Skip
      </button>

      {/* Phase 0: Marking shimmer */}
      {phase === 0 && (
        <div style={{
          fontFamily: 'Cormorant Garamond, Georgia, serif',
          fontSize: 'clamp(1.3rem, 4vw, 1.8rem)',
          fontStyle: 'italic',
          background: 'linear-gradient(90deg, rgba(240,234,216,0.3) 0%, rgba(240,234,216,0.9) 40%, #c9a44c 50%, rgba(240,234,216,0.9) 60%, rgba(240,234,216,0.3) 100%)',
          backgroundSize: '200% auto',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          animation: 'qra-shimmer 2s linear infinite',
          textAlign: 'center',
        }}>
          Marking your answers…
        </div>
      )}

      {/* Phase 1+: Dial */}
      {phase >= 1 && phase < 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          <DialCircle percent={phase === 1 ? dialPercent : result.totalPercent} />

          {/* Phase 2+: Tier badge */}
          {phase >= 2 && (
            <div style={{ animation: 'qra-badge-in 0.5s ease-out', textAlign: 'center' }}>
              {tierStyle ? (
                <>
                  <div style={{
                    fontFamily: 'Cinzel, Georgia, serif',
                    fontSize: 'clamp(1.6rem, 5vw, 2.4rem)',
                    color: tierStyle.color,
                    letterSpacing: '0.08em',
                    textShadow: `0 0 40px ${tierStyle.glow}`,
                    animation: 'qra-glow-pulse 2s ease-in-out infinite',
                  }}>
                    {tierStyle.label}
                  </div>
                  <div style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '0.72rem',
                    color: 'rgba(255,255,255,0.3)',
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    marginTop: '0.4rem',
                  }}>
                    Tier achieved
                  </div>
                </>
              ) : (
                <div style={{
                  fontFamily: 'Cormorant Garamond, Georgia, serif',
                  fontSize: 'clamp(1.2rem, 3.5vw, 1.6rem)',
                  fontStyle: 'italic',
                  color: 'rgba(240,234,216,0.6)',
                }}>
                  Keep reading. Keep growing.
                </div>
              )}
            </div>
          )}

          {/* Phase 3+: Scribbles burst */}
          {phase >= 3 && result.pointsAwarded > 0 && (
            <div style={{ position: 'relative', animation: 'qra-scribbles-in 0.4s ease-out', textAlign: 'center' }}>
              <div style={{
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                fontSize: 'clamp(1.8rem, 5vw, 2.6rem)',
                fontWeight: 300,
                color: '#c9a44c',
              }}>
                +{result.pointsAwarded} Scribbles
              </div>
              <div style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.65rem',
                color: 'rgba(201,164,76,0.5)',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                marginTop: '0.25rem',
              }}>
                Added to your wallet
              </div>
              <Particles visible={phase === 3} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
