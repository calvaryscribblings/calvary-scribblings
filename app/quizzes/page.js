'use client';
import { useState, useEffect } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import Navbar from '../components/Navbar';
import AuthModal from '../components/AuthModal';
import QuizPill from '../components/QuizPill';

const CATEGORY_NAMES = {
  flash: 'Flash Fiction', short: 'Short Story', serial: 'Serial',
  poetry: 'Poetry', news: 'News', inspiring: 'Inspiring',
};

const FILTER_LABELS = { all: 'All', unattempted: 'Unattempted', completed: 'Completed' };

export default function QuizzesPage() {
  const { user } = useAuth();
  const [stories, setStories] = useState(null);
  const [userSubs, setUserSubs] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await get(ref(db, 'cms_stories'));
        if (!snap.exists()) { setStories([]); return; }
        const raw = snap.val();
        const list = Object.entries(raw)
          .filter(([, s]) => s.quizMeta?.hasQuiz === true)
          .map(([slug, s]) => ({ slug, ...s }))
          .sort((a, b) => (b.quizMeta?.attemptCount ?? 0) - (a.quizMeta?.attemptCount ?? 0));
        setStories(list);
      } catch (e) {
        console.error('[quizzes] cms_stories load failed:', e);
        setStories([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) { setUserSubs(null); return; }
    (async () => {
      try {
        const snap = await get(ref(db, `quiz_submissions/${user.uid}`));
        setUserSubs(snap.exists() ? snap.val() : {});
      } catch (e) {
        setUserSubs({});
      }
    })();
  }, [user?.uid]);

  const visible = (stories ?? []).filter(s => {
    if (!user || filter === 'all') return true;
    const sub = userSubs?.[s.slug];
    if (filter === 'unattempted') return !sub;
    if (filter === 'completed') return sub?.hardballPassed === true;
    return true;
  });

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#0a0a0a', paddingTop: 68 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '2.5rem 4%' }}>

          <div style={{ marginBottom: '2rem' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', margin: '0 0 0.4rem' }}>Quizzes</h1>
            <p style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.45)', margin: 0 }}>
              Test your comprehension. Earn Scribbles.
            </p>
          </div>

          {user && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
              {['all', 'unattempted', 'completed'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  border: filter === f ? '1px solid rgba(167,139,250,0.6)' : '1px solid rgba(255,255,255,0.1)',
                  background: filter === f ? 'rgba(124,58,237,0.2)' : 'transparent',
                  color: filter === f ? '#c4b5fd' : 'rgba(255,255,255,0.45)',
                  borderRadius: 20, padding: '0.35rem 1rem',
                  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  letterSpacing: '0.04em', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}>
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
          )}

          {stories === null ? (
            <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.88rem', textAlign: 'center', paddingTop: '3rem' }}>
              Loading…
            </div>
          ) : visible.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.88rem', textAlign: 'center', paddingTop: '3rem' }}>
              {filter === 'completed' ? 'No completed quizzes yet.' :
               filter === 'unattempted' ? 'All quizzes attempted.' :
               'No quizzes available.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {visible.map(s => {
                const sub = userSubs?.[s.slug];
                const locked = sub?.hardballPassed === false;
                const completed = sub?.hardballPassed === true;
                const userTier = completed ? (sub?.tier ?? null) : null;
                const scorePct = completed ? (sub?.totalPercent ?? null) : null;
                const reward = s.quizMeta?.scribblesReward ?? 50;
                const attempts = s.quizMeta?.attemptCount ?? 0;
                const catName = s.categoryName ?? CATEGORY_NAMES[s.category] ?? '';

                return (
                  <a key={s.slug} href={`/stories/${s.slug}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '1rem',
                      textDecoration: 'none', padding: '0.75rem',
                      borderRadius: 10, background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      transition: 'background 0.2s, border-color 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.25)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
                  >
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <img src={s.cover} alt={s.title}
                        style={{ width: 56, height: 72, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                      <QuizPill hasQuiz={true} userTier={userTier} scorePct={scorePct}
                        scribblesReward={reward} locked={locked} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        marginBottom: '0.3rem' }}>
                        {s.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' }}>{s.author}</span>
                        {catName && (
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.07em',
                            textTransform: 'uppercase', padding: '0.1rem 0.4rem', borderRadius: 3,
                            background: 'rgba(124,58,237,0.2)', color: '#c4b5fd',
                          }}>
                            {catName}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', marginBottom: '0.25rem' }}>
                        {attempts.toLocaleString()} {attempts === 1 ? 'attempt' : 'attempts'}
                      </div>
                      {!completed && !locked && (
                        <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600 }}>
                          +{reward} Scribbles
                        </div>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          )}

          {!user && stories !== null && stories.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
              <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem', marginBottom: '0.85rem' }}>
                Sign in to track your progress
              </p>
              <button onClick={() => setShowAuth(true)} style={{
                background: '#7c3aed', border: 'none', borderRadius: 6,
                padding: '0.6rem 1.5rem', color: '#fff', fontSize: '0.85rem',
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Sign In
              </button>
            </div>
          )}

        </div>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
