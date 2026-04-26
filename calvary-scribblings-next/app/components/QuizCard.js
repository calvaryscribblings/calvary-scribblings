'use client';

import { useState, useEffect } from 'react';
import { scoreQuiz } from '../lib/quizScoring';
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
          15 questions. One attempt. Test your close reading.
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

// ── Main QuizCard component ───────────────────────────────────────────────────

export default function QuizCard({ slug, user, onSignIn }) {
  const [quizData, setQuizData] = useState(null);
  const [quizLoaded, setQuizLoaded] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [hasRead, setHasRead] = useState(false);
  const [view, setView] = useState('card'); // 'card'|'guidelines'|'hardball'|'main'|'animation'
  const [animResult, setAnimResult] = useState(null);
  const [attemptCount, setAttemptCount] = useState(null);

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
      return;
    }
    let unsubRead, unsubSub;
    (async () => {
      try {
        const db = await getDB();
        const { ref, onValue } = await import('firebase/database');
        unsubRead = onValue(ref(db, `users/${user.uid}/readStories/${slug}`), snap => {
          setHasRead(snap.exists());
        });
        unsubSub = onValue(ref(db, `quiz_submissions/${user.uid}/${slug}`), snap => {
          setSubmission(snap.exists() ? snap.val() : null);
        });
      } catch (e) {}
    })();
    return () => {
      if (unsubRead) unsubRead();
      if (unsubSub) unsubSub();
    };
  }, [user?.uid, slug]);

  if (!quizLoaded || !quizData) return null;

  // Derive quiz state
  let quizState;
  if (!user) quizState = 'A';
  else if (!hasRead) quizState = 'B';
  else if (!submission) quizState = 'C';
  else quizState = 'D';

  // Firebase writes
  async function writeHardballFail() {
    const db = await getDB();
    const { ref, get, update, increment } = await import('firebase/database');
    const now = Date.now();

    const subSnap = await get(ref(db, `quiz_submissions/${user.uid}/${slug}`));
    const isFirstAttempt = !subSnap.exists();

    const updates = {
      [`quiz_submissions/${user.uid}/${slug}`]: {
        hardballPassed: false,
        tier: null,
        pointsAwarded: 0,
        submittedAt: now,
      },
    };

    if (isFirstAttempt) {
      updates[`cms_stories/${slug}/quizMeta/attemptCount`] = increment(1);
    }

    await update(ref(db, '/'), updates);
  }

  async function writeQuizResult(result) {
    const db = await getDB();
    const { ref, get, update, push, increment } = await import('firebase/database');
    const now = Date.now();

    const subSnap = await get(ref(db, `quiz_submissions/${user.uid}/${slug}`));
    const isFirstAttempt = !subSnap.exists();

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

    if (isFirstAttempt) {
      updates[`cms_stories/${slug}/quizMeta/attemptCount`] = increment(1);
    }

    await update(ref(db, '/'), updates);
  }

  // Flow handlers
  function handleBeginQuiz() { setView('guidelines'); }
  function handleGuidelinesCancel() { setView('card'); }
  function handleGuidelinesBegin() { setView('hardball'); }
  function handleHardballPass() { setView('main'); }

  async function handleHardballFail() {
    await writeHardballFail();
    setView('card');
  }

  function handleMainSubmit(mcqAnswers, essayAnswers) {
    const scoring = scoreQuiz(quizData, mcqAnswers, essayAnswers);
    const result = { ...scoring, mcqAnswers, essayAnswers };
    setAnimResult(result);
    setView('animation');
    setTimeout(() => writeQuizResult(result), 150);
  }

  function handleAnimationDone() {
    setAnimResult(null);
    setView('card');
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
                {view === 'hardball' ? 'Comprehension check' : '15 questions + 3 essays'}
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

        {/* Hardball section (inline) */}
        {(view === 'hardball' || view === 'main') && (
          <QuizHardball
            hardball={quizData.hardball}
            onPass={handleHardballPass}
            onFail={handleHardballFail}
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
    </>
  );
}
