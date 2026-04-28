'use client';

import { useState, useEffect, useRef } from 'react';
import { scoreHardball, scoreEssay, determineTier } from '../lib/quizScoring';
import { checkAndAwardBadges } from '../lib/badgeEngine';
import QuizGuidelinesModal from './QuizGuidelinesModal';
import QuizHardball from './QuizHardball';
import QuizMain from './QuizMain';
import QuizResultAnimation from './QuizResultAnimation';

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
async function getDB() {
  const { getDatabase } = await import('firebase/database');
  return getDatabase(await getApp());
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function slugToTitle(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatCount(n) {
  return n.toLocaleString('en-GB');
}

const TIER_CONFIG = {
  platinum: { label: 'Platinum', color: '#c8daea', bg: 'rgba(200,218,234,0.1)', border: 'rgba(200,218,234,0.3)' },
  gold:     { label: 'Gold',     color: '#c9a44c', bg: 'rgba(201,164,76,0.1)',  border: 'rgba(201,164,76,0.3)' },
  silver:   { label: 'Silver',   color: '#c0c0c8', bg: 'rgba(192,192,200,0.1)', border: 'rgba(192,192,200,0.3)' },
  bronze:   { label: 'Bronze',   color: '#c97c2f', bg: 'rgba(201,124,47,0.1)',  border: 'rgba(201,124,47,0.3)' },
};

// ── Post-submission review ────────────────────────────────────────────────────

function QuizReview({ submission, quizData }) {
  if (!submission || !quizData) return null;

  if (submission.hardballPassed === false) {
    const { hardball } = quizData;
    if (!hardball) return null;
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 2rem 3rem' }}>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem' }}>
          <div style={{
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontSize: '1.05rem',
            color: 'rgba(240,234,216,0.35)',
            marginBottom: '1.25rem',
            letterSpacing: '0.01em',
          }}>
            What the story was looking for
          </div>
          <p style={{
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontSize: '0.95rem',
            fontStyle: 'italic',
            color: 'rgba(240,234,216,0.5)',
            lineHeight: 1.7,
            margin: '0 0 1rem',
          }}>
            {hardball.question}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {(hardball.keywords || []).map((kw, i) => (
              <span key={i} style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.7rem',
                color: '#9b6dff',
                border: '1px solid rgba(107,47,173,0.3)',
                borderRadius: 20,
                padding: '0.2em 0.75em',
              }}>
                {kw}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (submission.hardballPassed !== true || !submission.mcqAnswers) return null;

  const { mcqs = [], essays = [] } = quizData;
  const rawAnswers = submission.mcqAnswers;
  const wrongMCQs = mcqs.reduce((acc, q, i) => {
    const chosen = Array.isArray(rawAnswers) ? rawAnswers[i] : rawAnswers[String(i)];
    if (chosen !== q.correctAnswer) {
      acc.push({
        question: q.question,
        userAnswer: (q.options || [])[chosen] ?? '—',
        correctAnswer: (q.options || [])[q.correctAnswer] ?? '—',
      });
    }
    return acc;
  }, []);

  if (wrongMCQs.length === 0 && essays.length === 0) return null;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 2rem 3rem' }}>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem' }}>
        {wrongMCQs.length > 0 && (
          <>
            <div style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1.05rem',
              color: 'rgba(240,234,216,0.35)',
              marginBottom: '1.5rem',
              letterSpacing: '0.01em',
            }}>
              Where you slipped
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: essays.length > 0 ? '1.75rem' : 0 }}>
              {wrongMCQs.map((item, i) => (
                <div key={i}>
                  <p style={{
                    fontFamily: 'Cormorant Garamond, Georgia, serif',
                    fontSize: '0.95rem',
                    fontStyle: 'italic',
                    color: 'rgba(240,234,216,0.55)',
                    lineHeight: 1.65,
                    margin: '0 0 0.5rem',
                  }}>
                    {item.question}
                  </p>
                  <div style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '0.68rem',
                    color: 'rgba(240,234,216,0.28)',
                    lineHeight: 1.6,
                  }}>
                    You answered:{' '}
                    <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.9rem' }}>
                      {item.userAnswer}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '0.68rem',
                    color: 'rgba(155,109,255,0.65)',
                    lineHeight: 1.6,
                    marginTop: '0.2rem',
                  }}>
                    The story said:{' '}
                    <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.9rem', color: '#9b6dff' }}>
                      {item.correctAnswer}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {essays.length > 0 && (
          <p style={{
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontSize: '0.88rem',
            fontStyle: 'italic',
            color: 'rgba(240,234,216,0.28)',
            margin: 0,
            lineHeight: 1.6,
          }}>
            Your essays will be reviewed by the editors.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Card surface for each quiz state ─────────────────────────────────────────

function SocialProofLine({ text }) {
  if (!text) return null;
  return (
    <p style={{
      fontFamily: 'Inter, sans-serif',
      fontSize: '0.72rem',
      color: 'rgba(255,255,255,0.3)',
      margin: '0 0 1.25rem',
      lineHeight: 1.5,
    }}>
      {text}
    </p>
  );
}

function CardSurface({ quizState, submission, onSignIn, onBeginQuiz, socialProof }) {
  const headerLine = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      marginBottom: '0.6rem',
    }}>
      <span style={{ fontSize: '1.1rem' }}>📚</span>
      <span style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: '0.68rem',
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.35)',
      }}>
        Test your reading
      </span>
      <span style={{
        fontFamily: 'Cormorant Garamond, Georgia, serif',
        fontSize: '1.05rem',
        color: '#f5f0e8',
        fontWeight: 400,
      }}>
        Take the Quiz
      </span>
      <span style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: '0.65rem',
        color: '#c9a44c',
        border: '1px solid rgba(201,164,76,0.35)',
        borderRadius: 20,
        padding: '0.15em 0.6em',
        whiteSpace: 'nowrap',
      }}>
        50 Scribbles
      </span>
    </div>
  );

  // State A — not signed in
  if (quizState === 'A') {
    return (
      <div style={{
        border: '1px solid rgba(107,47,173,0.3)',
        borderRadius: 14,
        padding: '1.5rem',
        background: 'rgba(107,47,173,0.06)',
      }}>
        {headerLine}
        <p style={{
          fontFamily: 'Cormorant Garamond, Georgia, serif',
          fontSize: '1rem',
          color: 'rgba(240,234,216,0.55)',
          margin: '0 0 1.25rem',
          lineHeight: 1.65,
        }}>
          Sign in to take the quiz and start earning Scribbles.
        </p>
        <SocialProofLine text={socialProof} />
        <button
          onClick={onSignIn}
          style={{
            background: '#6b2fad',
            border: 'none',
            borderRadius: 8,
            padding: '0.65rem 1.5rem',
            color: '#fff',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#7c3aed'}
          onMouseLeave={e => e.currentTarget.style.background = '#6b2fad'}
        >
          Sign in to take quiz
        </button>
      </div>
    );
  }

  // State B — signed in, hasn't read
  if (quizState === 'B') {
    return (
      <div style={{
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        padding: '1.5rem',
        background: 'rgba(255,255,255,0.02)',
        opacity: 0.6,
      }}>
        {headerLine}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.9rem' }}>🔒</span>
          <p style={{
            fontFamily: 'Cormorant Garamond, Georgia, serif',
            fontSize: '1rem',
            color: 'rgba(240,234,216,0.5)',
            margin: 0,
            lineHeight: 1.65,
          }}>
            Read the story first to unlock the quiz.
          </p>
        </div>
        <SocialProofLine text={socialProof} />
      </div>
    );
  }

  // State C — ready to begin
  if (quizState === 'C') {
    return (
      <div style={{
        border: '1px solid rgba(107,47,173,0.35)',
        borderRadius: 14,
        padding: '1.5rem',
        background: 'rgba(107,47,173,0.07)',
      }}>
        {headerLine}
        <p style={{
          fontFamily: 'Cormorant Garamond, Georgia, serif',
          fontSize: '1rem',
          color: 'rgba(240,234,216,0.65)',
          margin: '0 0 1.25rem',
          lineHeight: 1.65,
        }}>
          10 questions. One attempt. Test your close reading.
        </p>
        <SocialProofLine text={socialProof} />
        <button
          onClick={onBeginQuiz}
          style={{
            background: '#6b2fad',
            border: 'none',
            borderRadius: 8,
            padding: '0.65rem 1.5rem',
            color: '#fff',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#7c3aed'}
          onMouseLeave={e => e.currentTarget.style.background = '#6b2fad'}
        >
          Begin Quiz
        </button>
      </div>
    );
  }

  // State D — already submitted
  if (quizState === 'D' && submission) {
    const tierCfg = submission.tier ? TIER_CONFIG[submission.tier] : null;
    const pct = typeof submission.totalPercent === 'number'
      ? submission.totalPercent.toFixed(1)
      : null;
    const passed = submission.hardballPassed;

    return (
      <div style={{
        border: `1px solid ${tierCfg ? tierCfg.border : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 14,
        padding: '1.5rem',
        background: tierCfg ? tierCfg.bg : 'rgba(255,255,255,0.02)',
      }}>
        {tierCfg ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'Cinzel, Georgia, serif',
                fontSize: '1.1rem',
                color: tierCfg.color,
                letterSpacing: '0.06em',
              }}>
                {tierCfg.label}
              </span>
              <span style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.65rem',
                color: 'rgba(255,255,255,0.25)',
                border: `1px solid ${tierCfg.border}`,
                borderRadius: 20,
                padding: '0.15em 0.65em',
              }}>
                Tier
              </span>
            </div>
            <p style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1rem',
              color: 'rgba(240,234,216,0.75)',
              margin: '0 0 0.4rem',
              lineHeight: 1.55,
            }}>
              {pct !== null && `You scored ${pct}% — `}
              <strong style={{ color: tierCfg.color }}>{tierCfg.label} tier</strong>
              {submission.pointsAwarded > 0 && ` — earned ${submission.pointsAwarded} Scribbles`}
            </p>
          </>
        ) : passed === false ? (
          <>
            <div style={{ marginBottom: '0.6rem' }}>
              <span style={{
                fontFamily: 'Cinzel, Georgia, serif',
                fontSize: '1rem',
                fontWeight: 400,
                letterSpacing: '0.06em',
                color: 'rgba(240,234,216,0.55)',
              }}>
                Quiz Closed
              </span>
            </div>
            <p style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1rem',
              color: 'rgba(240,234,216,0.55)',
              margin: '0 0 0.85rem',
              lineHeight: 1.65,
            }}>
              The close-reading gate at the start of this quiz wasn't quite right — twice. The quiz closes after that, by design.
            </p>
            <p style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1rem',
              color: 'rgba(240,234,216,0.55)',
              margin: '0 0 0.85rem',
              lineHeight: 1.65,
            }}>
              No Scribbles awarded this round, but your read still counts. The Discussion below is open.
            </p>
            <p style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1rem',
              color: 'rgba(240,234,216,0.4)',
              margin: 0,
              lineHeight: 1.65,
            }}>
              Want another shot? Re-read carefully. If you spot something that should have been accepted, message the editors and they can reset it.
            </p>
          </>
        ) : (
          <>
            <p style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1rem',
              color: 'rgba(240,234,216,0.55)',
              margin: '0 0 0.4rem',
              lineHeight: 1.65,
            }}>
              {pct !== null && `You scored ${pct}% — `}
              no tier earned.
            </p>
            <p style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '0.9rem',
              fontStyle: 'italic',
              color: 'rgba(240,234,216,0.35)',
              margin: 0,
              lineHeight: 1.55,
            }}>
              Quizzes have a single attempt. Your reading still earns you the comments below.
            </p>
          </>
        )}
        {submission.submittedAt && (
          <div style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.65rem',
            color: 'rgba(255,255,255,0.2)',
            marginTop: '0.6rem',
          }}>
            Submitted {timeAgo(submission.submittedAt)}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── Badge toast ───────────────────────────────────────────────────────────────

function BadgeToast({ badge, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [badge.id]);
  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
      background: '#111', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 12,
      padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
      zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      animation: 'badge-slide-up 0.3s cubic-bezier(0.34,1.56,0.64,1)', minWidth: 260, maxWidth: 320,
    }}>
      <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{badge.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.58rem', fontFamily: 'Inter, sans-serif', fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '0.2rem' }}>
          🎉 Badge Earned
        </div>
        <div style={{ fontSize: '0.88rem', fontFamily: 'Cochin, Georgia, serif', color: '#f5f0e8' }}>{badge.name}</div>
        <div style={{ fontSize: '0.68rem', fontFamily: 'Inter, sans-serif', color: 'rgba(255,255,255,0.4)', marginTop: '0.15rem' }}>{badge.description}</div>
      </div>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer',
        color: 'rgba(255,255,255,0.3)', fontSize: '1.1rem', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
    </div>
  );
}

// ── Main QuizCard component ───────────────────────────────────────────────────

export default function QuizCard({ slug, user, onSignIn }) {
  const [quizData, setQuizData] = useState(null);
  const [quizLoaded, setQuizLoaded] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [hasRead, setHasRead] = useState(false);
  const [hasReadLoaded, setHasReadLoaded] = useState(false);
  const [submissionLoaded, setSubmissionLoaded] = useState(false);
  const [view, setView] = useState('card'); // 'card'|'guidelines'|'hardball'|'main'|'animation'
  const [animResult, setAnimResult] = useState(null);
  const [attemptCount, setAttemptCount] = useState(null);
  const hardballEvalRef = useRef(null);
  const badgeCheckRef = useRef(null);
  const [pendingResult, setPendingResult] = useState(null);
  const [badgeToastQueue, setBadgeToastQueue] = useState([]);
  const [saveError, setSaveError] = useState(null);

  // Load quiz data once
  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `cms_quizzes/${slug}`));
        if (snap.exists()) {
          const data = snap.val();
          if (data.approvedAt) setQuizData(data);
        }
      } catch (e) {}
      setQuizLoaded(true);
    })();
  }, [slug]);

  // Read attempt count once on mount
  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `cms_stories/${slug}/quizMeta/attemptCount`));
        if (snap.exists()) setAttemptCount(snap.val());
      } catch (e) {
        console.warn('QuizCard: failed to load attempt count', e);
      }
    })();
  }, [slug]);

  // Subscribe to user-specific Firebase paths reactively
  useEffect(() => {
    if (!user) {
      setHasRead(false);
      setSubmission(null);
      setHasReadLoaded(true);
      setSubmissionLoaded(true);
      return;
    }
    setHasReadLoaded(false);
    setSubmissionLoaded(false);
    let unsubRead, unsubSub;
    (async () => {
      try {
        const db = await getDB();
        const { ref, onValue } = await import('firebase/database');
        unsubRead = onValue(ref(db, `users/${user.uid}/readStories/${slug}`), snap => {
          setHasRead(snap.exists());
          setHasReadLoaded(true);
        });
        unsubSub = onValue(ref(db, `quiz_submissions/${user.uid}/${slug}`), snap => {
          setSubmission(snap.exists() ? snap.val() : null);
          setSubmissionLoaded(true);
        });
      } catch (e) {}
    })();
    return () => {
      if (unsubRead) unsubRead();
      if (unsubSub) unsubSub();
    };
  }, [user?.uid, slug]);

  if (!quizLoaded || !quizData) return null;
  if (user && (!hasReadLoaded || !submissionLoaded)) return null;

  // Derive quiz state
  let quizState;
  if (!user) quizState = 'A';
  else if (!hasRead) quizState = 'B';
  else if (!submission) quizState = 'C';
  else quizState = 'D';

  // Evaluator calls
  async function checkHardball(answer, attemptIndex = 0) {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/evaluate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          slug, type: 'hardball',
          hardball: { question: quizData.hardball.question, keywords: quizData.hardball.keywords },
          answer,
          attemptIndex,
        }),
      });
      if (!res.ok) throw new Error(`Evaluator ${res.status}`);
      const data = await res.json();
      if (typeof data.hardball?.passed !== 'boolean') throw new Error('Malformed response.');
      hardballEvalRef.current = {
        evaluator: 'claude-sonnet-4-6', fallback: false, fallbackReason: null,
        hardballReasoning: data.hardball.reasoning, hardballConfidence: data.hardball.confidence,
      };
      return data.hardball.passed;
    } catch (e) {
      console.warn('[QuizCard] Hardball evaluator failed, using keyword fallback:', e.message);
      hardballEvalRef.current = {
        evaluator: 'keyword-fallback', fallback: true, fallbackReason: 'api-error',
        hardballReasoning: null, hardballConfidence: null,
      };
      return scoreHardball(answer, quizData.hardball);
    }
  }

  async function evaluateEssays(essayAnswers) {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/evaluate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ slug, type: 'essays', essays: quizData.essays, answers: essayAnswers }),
      });
      if (!res.ok) throw new Error(`Evaluator ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.essays)) throw new Error('Malformed response.');
      return { essays: data.essays, evaluator: 'claude-sonnet-4-6', fallback: false, fallbackReason: null };
    } catch (e) {
      console.warn('[QuizCard] Essay evaluator failed, using keyword fallback:', e.message);
      const essays = (quizData.essays || []).map((essay, i) => ({
        score: scoreEssay(essayAnswers[i] || '', essay) ? 1 : 0,
        reasoning: null, strengths: null, gaps: null,
      }));
      return { essays, evaluator: 'keyword-fallback', fallback: true, fallbackReason: 'api-error' };
    }
  }

  // Firebase writes
  async function writeHardballFail() {
    const db = await getDB();
    const { ref, update } = await import('firebase/database');
    const now = Date.now();

    const evalMeta = hardballEvalRef.current ?? {
      evaluator: 'keyword-fallback', fallback: true, fallbackReason: 'no-eval',
      hardballReasoning: null, hardballConfidence: null,
    };

    const updates = {
      [`quiz_submissions/${user.uid}/${slug}`]: {
        hardballPassed: false,
        tier: null,
        pointsAwarded: 0,
        evaluator: evalMeta.evaluator,
        fallback: evalMeta.fallback,
        fallbackReason: evalMeta.fallbackReason,
        hardballReasoning: evalMeta.hardballReasoning,
        hardballConfidence: evalMeta.hardballConfidence,
        submittedAt: now,
      },
    };

    await update(ref(db, '/'), updates);

    const idToken = await user.getIdToken();
    fetch('/api/record-attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ slug }),
    }).catch(e => console.warn('[QuizCard] record-attempt failed:', e.message));
  }

  async function writeQuizResult(result) {
    const db = await getDB();
    const { ref, update, push, increment } = await import('firebase/database');
    const now = Date.now();

    const updates = {
      [`quiz_submissions/${user.uid}/${slug}`]: {
        hardballPassed: true,
        mcqAnswers: result.mcqAnswers,
        essayAnswers: result.essayAnswers,
        mcqScore: result.mcqScore,
        essayScore: result.essayScore,
        totalPercent: result.totalPercent,
        tier: result.tier,
        pointsAwarded: result.pointsAwarded,
        evaluator: result.evaluator,
        fallback: result.fallback,
        fallbackReason: result.fallbackReason ?? null,
        essayEvals: result.essayEvals ?? null,
        submittedAt: now,
      },
      [`userStoryTiers/${user.uid}/${slug}`]: {
        tier: result.tier,
        scorePct: result.totalPercent,
        completedAt: now,
      },
    };

    if (result.pointsAwarded > 0) {
      updates[`points/${user.uid}/total`] = increment(result.pointsAwarded);
      const historyKey = push(ref(db, `points/${user.uid}/history`)).key;
      updates[`points/${user.uid}/history/${historyKey}`] = {
        type: 'quiz',
        amount: result.pointsAwarded,
        description: `${slugToTitle(slug)} — ${result.label}`,
        slug,
        createdAt: now,
      };
    }

    await update(ref(db, '/'), updates);

    const idToken = await user.getIdToken();
    fetch('/api/record-attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ slug }),
    }).catch(e => console.warn('[QuizCard] record-attempt failed:', e.message));
  }

  // Flow handlers
  function handleBeginQuiz() { setView('guidelines'); }
  function handleGuidelinesCancel() { setView('card'); }
  function handleGuidelinesBegin() { setView('hardball'); }
  function handleHardballPass() { setView('main'); }

  async function handleHardballFail() {
    try {
      await writeHardballFail();
      setPendingResult(null);
      setView('card');
    } catch (e) {
      console.error('[QuizCard] writeHardballFail failed:', e);
      setSaveError('Saving your result failed. Tap retry to save it before leaving this page — your score isn\'t stored yet.');
      setPendingResult({ type: 'hardball' });
      setView('error');
    }
  }

  async function handleMainSubmit(mcqAnswers, essayAnswers) {
    try {
      setView('scoring');
      const evalResult = await evaluateEssays(essayAnswers);

      const mcqScore = mcqAnswers.filter((a, i) => a === quizData.mcqs[i].correctAnswer).length;
      const safeEssays = Array.isArray(evalResult.essays) ? evalResult.essays : [];
      const essayScore = safeEssays.reduce((s, e) => s + (e.score || 0), 0);
      const total = quizData.mcqs.length + quizData.essays.length;
      const totalPercent = total > 0 ? (mcqScore + essayScore) / total * 100 : 0;
      const tierResult = determineTier(totalPercent);

      const result = {
        ...tierResult,
        mcqScore,
        essayScore,
        totalPercent,
        mcqAnswers,
        essayAnswers,
        evaluator: evalResult.evaluator,
        fallback: evalResult.fallback,
        fallbackReason: evalResult.fallbackReason ?? null,
        essayEvals: evalResult.essays,
      };

      setPendingResult({ type: 'main', result });

      try {
        await writeQuizResult(result);
      } catch (writeErr) {
        console.error('[QuizCard] writeQuizResult failed:', writeErr);
        setSaveError('Saving your result failed. Tap retry to save it before leaving this page — your score isn\'t stored yet.');
        setView('error');
        return;
      }

      setPendingResult(null);
      const dbPromise = getDB();
      badgeCheckRef.current = dbPromise.then(db => checkAndAwardBadges(user.uid, db).catch(() => []));
      setSaveError(null);
      setAnimResult(result);
      setView('animation');
    } catch (e) {
      console.error('[QuizCard] handleMainSubmit failed:', e);
      setSaveError('Something went wrong scoring your quiz. Please try again.');
      setView('error');
    }
  }

  async function handleRetryWrite() {
    if (!pendingResult) return;
    setSaveError(null);
    setView('scoring');
    try {
      if (pendingResult.type === 'main') {
        await writeQuizResult(pendingResult.result);
        const result = pendingResult.result;
        setPendingResult(null);
        const dbPromise = getDB();
        badgeCheckRef.current = dbPromise.then(db => checkAndAwardBadges(user.uid, db).catch(() => []));
        setAnimResult(result);
        setView('animation');
      } else if (pendingResult.type === 'hardball') {
        await writeHardballFail();
        setPendingResult(null);
        setView('card');
      }
    } catch (e) {
      console.error('[QuizCard] Retry write failed:', e);
      setSaveError('Saving your result failed. Tap retry to save it before leaving this page — your score isn\'t stored yet.');
      setView('error');
    }
  }

  async function handleAnimationDone() {
    setAnimResult(null);
    setView('card');
    if (badgeCheckRef.current) {
      const earned = await badgeCheckRef.current;
      badgeCheckRef.current = null;
      if (earned.length) setBadgeToastQueue(earned);
    }
  }

  const socialProof = typeof attemptCount === 'number' && attemptCount >= 5
    ? `${formatCount(attemptCount)} readers have taken this quiz.`
    : null;

  const inProgress = view !== 'card' && view !== 'animation';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@400;500;600&display=swap');
        @keyframes qc-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(107,47,173,0)} 50%{box-shadow:0 0 0 8px rgba(107,47,173,0.2)} }
        @keyframes badge-slide-up { from{opacity:0;transform:translateX(-50%) translateY(1rem)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>

      <div style={{ background: '#0a0a0a' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 2rem', paddingTop: '2rem', paddingBottom: inProgress ? '1rem' : '2rem' }}>
          {inProgress ? (
            <div style={{
              border: '1px solid rgba(107,47,173,0.3)',
              borderRadius: 10,
              padding: '0.85rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              background: 'rgba(107,47,173,0.06)',
            }}>
              <span style={{ fontSize: '0.9rem' }}>📚</span>
              <span style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#9b6dff',
              }}>
                Quiz in progress
              </span>
              <span style={{
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                fontSize: '0.88rem',
                color: 'rgba(240,234,216,0.3)',
                marginLeft: 'auto',
              }}>
                {view === 'hardball' ? 'Comprehension check' : view === 'scoring' ? 'Scoring…' : '10 questions + 2 essays'}
              </span>
            </div>
          ) : (
            <CardSurface
              quizState={quizState}
              submission={submission}
              onSignIn={onSignIn}
              onBeginQuiz={handleBeginQuiz}
              socialProof={socialProof}
            />
          )}
        </div>

        {/* Failed-question review (state D only) */}
        {quizState === 'D' && !inProgress && (
          <QuizReview submission={submission} quizData={quizData} />
        )}

        {/* Guidelines modal (fixed overlay) */}
        {view === 'guidelines' && (
          <QuizGuidelinesModal
            onBegin={handleGuidelinesBegin}
            onCancel={handleGuidelinesCancel}
          />
        )}

        {/* Scoring in progress (evaluator running) */}
        {view === 'scoring' && (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 2rem 3rem', textAlign: 'center' }}>
            <div style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1.1rem',
              color: 'rgba(240,234,216,0.5)',
              fontStyle: 'italic',
            }}>
              Scoring your answers…
            </div>
          </div>
        )}

        {/* Write failure — keep user on page so pendingResult survives */}
        {view === 'error' && (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 2rem 3rem', textAlign: 'center' }}>
            <div style={{
              fontFamily: 'Cormorant Garamond, Georgia, serif',
              fontSize: '1.1rem',
              color: 'rgba(240,234,216,0.65)',
              fontStyle: 'italic',
              marginBottom: '1.5rem',
              lineHeight: 1.65,
            }}>
              {saveError || 'Saving your result failed. Tap retry to save it before leaving this page — your score isn\'t stored yet.'}
            </div>
            <button
              onClick={handleRetryWrite}
              style={{
                background: '#6b2fad',
                border: 'none',
                borderRadius: 8,
                padding: '0.65rem 1.5rem',
                color: '#fff',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.72rem',
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#7c3aed'}
              onMouseLeave={e => e.currentTarget.style.background = '#6b2fad'}
            >
              Retry
            </button>
          </div>
        )}

        {/* Hardball section (inline) */}
        {(view === 'hardball' || view === 'main') && (
          <QuizHardball
            hardball={quizData.hardball}
            onPass={handleHardballPass}
            onFail={handleHardballFail}
            onCheck={checkHardball}
            passed={view === 'main'}
          />
        )}

        {/* MCQ + essay form (inline) */}
        {view === 'main' && (
          <QuizMain
            quizData={quizData}
            onSubmit={handleMainSubmit}
          />
        )}
      </div>

      {/* Result animation (fixed overlay) */}
      {view === 'animation' && animResult && (
        <QuizResultAnimation
          result={animResult}
          onDone={handleAnimationDone}
        />
      )}

      {badgeToastQueue.length > 0 && (
        <BadgeToast badge={badgeToastQueue[0]} onDismiss={() => setBadgeToastQueue(q => q.slice(1))} />
      )}

    </>
  );
}
