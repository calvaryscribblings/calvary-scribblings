'use client';

import { useEffect, useState, useRef } from 'react';
import { stories } from '../../lib/stories';
import { use } from 'react';
import { storyContent } from '../../lib/storyContent';
import AuthModal from '../../components/AuthModal';
import TipBox from '../../components/TipBox';


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
async function getDB() { const { getDatabase } = await import('firebase/database'); return getDatabase(await getApp()); }
async function getFirebaseAuth() { const { getAuth } = await import('firebase/auth'); return getAuth(await getApp()); }

const FOUNDER_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

function getBadge(readCount, uid) {
  if (uid === FOUNDER_UID) return { tier: 'founder', label: 'Founder', color: '#c8daea', isFounder: true };
  if (readCount >= 1000) return { tier: 'immortal', label: 'Immortal of the Island', color: '#9b6dff' };
  if (readCount >= 150) return { tier: 'legend', label: 'Legend of the Island', color: '#d4537e' };
  if (readCount >= 90) return { tier: 'islander', label: 'Story Islander', color: '#d4941a' };
  if (readCount >= 60) return { tier: 'island', label: 'Island Reader', color: '#1d9e75' };
  if (readCount >= 25) return { tier: 'reader', label: 'Reader', color: '#b4b2a9' };
  return null;
}

const BADGE_SVG_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";
const HEART_PATH = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

function BadgeIcon({ color, size = 14, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="platGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8"/><stop offset="50%" stopColor="#c8daea"/><stop offset="100%" stopColor="#a8c0d6"/>
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#platGrad)' : color} d={BADGE_SVG_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

function BadgeDisplay({ tier, label, color, size = 13 }) {
  if (!tier) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <BadgeIcon color={color} size={size} isFounder={tier === 'founder'} />
      <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: tier === 'founder' ? '#c8daea' : color, fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>{label}</span>
    </span>
  );
}

function WriterBadge({ size = 13 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path fill="#581c87" d={BADGE_SVG_PATH} />
        <path fill="#e9d5ff" d={CHECK_PATH} />
      </svg>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(212,83,126,0.12)', border: '1px solid rgba(212,83,126,0.35)', borderRadius: 6, padding: '1px 7px 1px 5px' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill="#d4537e" d={HEART_PATH} /></svg>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#d4537e', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>Writer</span>
      </span>
    </span>
  );
}

function CommentBadge({ uid, size = 13 }) {
  const [badge, setBadge] = useState(null);
  const [isAuthor, setIsAuthor] = useState(false);
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}`));
        if (snap.exists()) {
          const data = snap.val();
          setIsAuthor(data.isAuthor || false);
          setBadge(getBadge(data.readCount || 0, uid));
        }
      } catch (e) {}
    })();
  }, [uid]);
  if (isAuthor) return <WriterBadge size={size} />;
  if (!badge) return null;
  return <BadgeDisplay tier={badge.tier} label={badge.label} color={badge.color} size={size} />;
}

function CommentAvatar({ uid, initials, size = 'sm', isOwnComment }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const dim = size === 'xs' ? 26 : size === 'sm' ? 34 : 36;
  const fontSize = size === 'xs' ? 9 : size === 'sm' ? 11 : 12;
  const href = isOwnComment ? '/profile' : `/user?id=${uid}`;

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}/avatarUrl`));
        if (snap.exists()) setPhotoUrl(snap.val());
      } catch (e) {}
    })();
  }, [uid]);

  return (
    <a href={href} style={{
      width: dim, height: dim, borderRadius: '50%',
      background: 'rgba(107,47,173,0.25)', border: '1px solid rgba(107,47,173,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize, fontWeight: 500, color: '#9b6dff', flexShrink: 0,
      fontFamily: 'Inter, sans-serif', overflow: 'hidden', textDecoration: 'none',
    }}>
      {photoUrl ? <img src={photoUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </a>
  );
}

function CommentUsername({ uid }) {
  const [username, setUsername] = useState(null);
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}/username`));
        if (snap.exists()) setUsername(snap.val());
      } catch (e) {}
    })();
  }, [uid]);
  if (!username) return null;
  return <span style={{ fontSize: '0.62rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>@{username}</span>;
}

function AuthorHandleLink({ handle, style }) {
  const [uid, setUid] = useState(null);
  useEffect(() => {
    if (!handle) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `usernames/${handle}`));
        if (snap.exists()) setUid(snap.val());
      } catch (e) {}
    })();
  }, [handle]);
  if (!handle) return null;
  return (
    <a href={uid ? `/user?id=${uid}` : `/search?q=${handle}`} style={style}
      onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
      onMouseLeave={e => e.currentTarget.style.color = style.color}>
      @{handle}
    </a>
  );
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Exercise Section ──────────────────────────────────────────────────────────
function ExerciseSection({ slug }) {
  const [user, setUser] = useState(null);
  const [exercise, setExercise] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      onAuthStateChanged(auth, u => setUser(u));
    })();
  }, []);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, `story_exercises/${slug}`));
      if (snap.exists() && snap.val().questions) {
        const qs = snap.val().questions;
        setExercise(qs);
        setAnswers(qs.map(q => q.type === 'mcq' ? null : ''));
      }
    })();
  }, [slug]);

  useEffect(() => {
    if (!slug || !user) return;
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, `exercise_submissions/${user.uid}/${slug}`));
      if (snap.exists()) {
        setSubmission(snap.val());
        setSubmitted(true);
      }
    })();
  }, [slug, user]);

  const submit = async () => {
    if (!user || !exercise) return;
    const allAnswered = answers.every((a, i) => exercise[i].type === 'essay' ? a.trim().length > 0 : a !== null);
    if (!allAnswered) { setMsg('Please answer all questions before submitting.'); return; }
    setSubmitting(true);

    const db = await getDB();
    const { ref, set, push, update, get } = await import('firebase/database');
    const now = Date.now();

    let autoPoints = 0;
    let hasEssay = false;
    const processedAnswers = exercise.map((q, i) => {
      if (q.type === 'mcq') {
        const correct = answers[i] === q.correctAnswer;
        if (correct) autoPoints += q.points;
        return { type: 'mcq', questionIndex: i, question: q.question, selected: answers[i], correct, awardedPoints: correct ? q.points : 0, maxPoints: q.points, marked: true };
      } else {
        hasEssay = true;
        return { type: 'essay', questionIndex: i, question: q.question, response: answers[i], maxPoints: q.points, marked: false, awardedPoints: 0 };
      }
    });

    const status = hasEssay ? 'pending_review' : 'auto_marked';
    await set(ref(db, `exercise_submissions/${user.uid}/${slug}`), {
      answers: processedAnswers, status, submittedAt: now, totalScore: autoPoints,
    });

    if (autoPoints > 0) {
      await push(ref(db, `points/${user.uid}/history`), {
        type: 'exercise', amount: autoPoints,
        description: `Exercise completed — ${slug.replace(/-/g, ' ')}`,
        createdAt: now,
      });
      const pointsSnap = await get(ref(db, `points/${user.uid}/total`));
      const current = pointsSnap.exists() ? pointsSnap.val() : 0;
      await update(ref(db, `points/${user.uid}`), { total: current + autoPoints });
    }

    setSubmission({ answers: processedAnswers, status, totalScore: autoPoints });
    setSubmitted(true);
    setSubmitting(false);
  };

  if (!exercise || exercise.length === 0) return null;

  return (
    <div style={{ background: '#f0ead8', maxWidth: 680, margin: '0 auto', padding: '0 2rem 3rem' }}>
      <div style={{ borderTop: '1px solid #e0dbd2', paddingTop: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>Story Exercise</div>
            <div style={{ fontSize: '0.72rem', color: '#888', fontFamily: 'Inter, sans-serif' }}>{exercise.length} question{exercise.length !== 1 ? 's' : ''} · Up to {exercise.reduce((s, q) => s + q.points, 0)} pts</div>
          </div>
          {submitted && (
            <div style={{ background: 'rgba(107,47,173,0.1)', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 8, padding: '0.4rem 0.9rem', fontSize: '0.72rem', color: '#6b2fad', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>
              {submission.status === 'pending_review' ? '⏳ Essay pending review' : `✓ ${submission.totalScore} pts earned`}
            </div>
          )}
        </div>

        {submitted ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {submission.answers.map((a, i) => (
              <div key={i} style={{ background: '#fff', border: `1px solid ${a.type === 'mcq' ? (a.correct ? 'rgba(29,158,117,0.3)' : 'rgba(220,38,38,0.3)') : 'rgba(107,47,173,0.2)'}`, borderRadius: 10, padding: '1rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#888', fontFamily: 'Inter, sans-serif', marginBottom: '0.4rem' }}>Q{i + 1} · {a.type === 'mcq' ? 'Multiple Choice' : 'Essay'}</div>
                <div style={{ fontSize: '0.92rem', color: '#1a1a1a', fontFamily: 'Cochin, Georgia, serif', marginBottom: '0.5rem' }}>{a.question}</div>
                {a.type === 'mcq' ? (
                  <div style={{ fontSize: '0.82rem', fontFamily: 'Inter, sans-serif', color: a.correct ? '#1d9e75' : '#dc2626', fontWeight: 600 }}>
                    {a.correct ? `✓ Correct — +${a.awardedPoints} pts` : '✗ Incorrect — 0 pts'}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', fontFamily: 'Inter, sans-serif', color: a.marked ? '#1d9e75' : '#d97706' }}>
                    {a.marked ? `✓ Marked — ${a.awardedPoints} pts` : '⏳ Awaiting review'}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : user ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {exercise.map((q, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e0dbd2', borderRadius: 10, padding: '1.25rem' }}>
                <div style={{ fontSize: '0.72rem', color: '#888', fontFamily: 'Inter, sans-serif', marginBottom: '0.4rem' }}>Q{i + 1} · {q.type === 'mcq' ? 'Multiple Choice' : 'Essay'} · {q.points} pts</div>
                <div style={{ fontSize: '1rem', color: '#1a1a1a', fontFamily: 'Cochin, Georgia, serif', marginBottom: '1rem', lineHeight: 1.6 }}>{q.question}</div>
                {q.type === 'mcq' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {q.options.filter(o => o.trim()).map((opt, oi) => (
                      <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', padding: '0.6rem 0.75rem', borderRadius: 8, border: `1px solid ${answers[i] === oi ? 'rgba(107,47,173,0.4)' : '#e0dbd2'}`, background: answers[i] === oi ? 'rgba(107,47,173,0.06)' : 'transparent', transition: 'all 0.15s' }}>
                        <input type="radio" name={`q${i}`} checked={answers[i] === oi} onChange={() => setAnswers(a => a.map((v, idx) => idx === i ? oi : v))} style={{ accentColor: '#6b2fad' }} />
                        <span style={{ fontSize: '0.9rem', color: '#1a1a1a', fontFamily: 'Cochin, Georgia, serif' }}>{opt}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    value={answers[i] || ''}
                    onChange={e => setAnswers(a => a.map((v, idx) => idx === i ? e.target.value : v))}
                    placeholder="Write your response here…"
                    rows={5}
                    style={{ width: '100%', border: '1px solid #e0dbd2', borderRadius: 8, padding: '0.75rem', fontSize: '0.92rem', fontFamily: 'Cochin, Georgia, serif', color: '#1a1a1a', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.7 }}
                  />
                )}
              </div>
            ))}
            {msg && <div style={{ fontSize: '0.82rem', color: '#dc2626', fontFamily: 'Inter, sans-serif' }}>{msg}</div>}
            <button onClick={submit} disabled={submitting}
              style={{ background: '#6b2fad', border: 'none', borderRadius: 8, padding: '0.85rem 2rem', color: '#fff', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Inter, sans-serif', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Submitting…' : 'Submit Exercise'}
            </button>
          </div>
        ) : (
          <div style={{ background: 'rgba(107,47,173,0.06)', border: '1px solid rgba(107,47,173,0.15)', borderRadius: 10, padding: '1.5rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'Cochin, Georgia, serif', color: '#555', marginBottom: '0.5rem' }}>Sign in to attempt this exercise and earn points.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Comments Section ──────────────────────────────────────────────────────────
function CommentsSection({ slug, onSignIn }) {
  const [user, setUser] = useState(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubAuth;
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubAuth = onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (u) {
          try {
            const db = await getDB();
            const { ref, get } = await import('firebase/database');
            const avSnap = await get(ref(db, `users/${u.uid}/avatarUrl`));
            if (avSnap.exists()) setUserAvatarUrl(avSnap.val());
          } catch (e) {}
        }
      });
    })();
    return () => { if (unsubAuth) unsubAuth(); };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let unsubDB;
    (async () => {
      setLoading(true);
      try {
        const db = await getDB();
        const { ref, onValue } = await import('firebase/database');
        unsubDB = onValue(ref(db, `comments/${slug}`), (snap) => {
          if (snap.exists()) {
            const list = Object.entries(snap.val()).map(([id, c]) => ({ id, ...c })).sort((a, b) => b.createdAt - a.createdAt);
            setComments(list);
          } else { setComments([]); }
          setLoading(false);
        });
      } catch (e) { setLoading(false); }
    })();
    return () => { if (unsubDB) unsubDB(); };
  }, [slug]);

  const postComment = async (commentText, parentId = null) => {
    if (!commentText.trim() || !user) return;
    setPosting(true);
    try {
      const db = await getDB();
      const { ref, push, get, update } = await import('firebase/database');
      await push(ref(db, `comments/${slug}`), {
        text: commentText.trim(),
        authorName: user.displayName || 'Reader',
        authorInitials: (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        authorUid: user.uid,
        parentId: parentId || null,
        createdAt: Date.now(),
      });
      if (parentId) { setReplyText(''); setReplyTo(null); } else setText('');

      try {
        const commentsSnap = await get(ref(db, 'comments'));
        let userCommentCount = 0;
        if (commentsSnap.exists()) {
          Object.values(commentsSnap.val()).forEach(slugComments => {
            Object.values(slugComments).forEach(c => { if (c.authorUid === user.uid) userCommentCount++; });
          });
        }
        if (userCommentCount > 0 && userCommentCount % 50 === 0) {
          const pointsSnap = await get(ref(db, `points/${user.uid}/total`));
          const current = pointsSnap.exists() ? pointsSnap.val() : 0;
          await update(ref(db, `points/${user.uid}`), { total: current + 10 });
          await push(ref(db, `points/${user.uid}/history`), {
            type: 'comment', amount: 10,
            description: `${userCommentCount} comments milestone`,
            createdAt: Date.now(),
          });
        }
      } catch (e) {}
    } catch (e) {}
    setPosting(false);
  };

  const userInitials = user ? (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '';
  const topLevel = comments.filter(c => !c.parentId);
  const getReplies = (id) => comments.filter(c => c.parentId === id).sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="cs-section">
      <div className="cs-header">
        <div className="cs-title">Discussion</div>
        {comments.length > 0 && <div className="cs-count">{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</div>}
      </div>
      {user ? (
        <div className="cs-compose">
          <div className="cs-compose-row">
            <a href="/profile" className="cs-avatar-compose">
              {userAvatarUrl ? <img src={userAvatarUrl} alt={userInitials} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : userInitials}
            </a>
            <div className="cs-input-wrap">
              <textarea className="cs-textarea" placeholder="Share your thoughts on this story…" value={text} onChange={e => setText(e.target.value)} rows={3} />
              <button className={`cs-kite-btn${text.trim() ? ' active' : ''}`} onClick={() => postComment(text)} disabled={posting || !text.trim()} title="Post comment">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#9b6dff"/></svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="cs-signin-prompt">
          <p>Sign in to join the discussion</p>
          <button className="cs-signin-btn" onClick={onSignIn}>Sign in to comment</button>
        </div>
      )}
      {loading ? (
        <div className="cs-loading">Loading comments…</div>
      ) : topLevel.length === 0 ? (
        <div className="cs-empty">No comments yet. Be the first to share your thoughts.</div>
      ) : (
        <div className="cs-comments-list">
          {topLevel.map((comment, i) => {
            const replies = getReplies(comment.id);
            const isOwn = user?.uid === comment.authorUid;
            return (
              <div key={comment.id}>
                {i > 0 && <div className="cs-divider" />}
                <div className="cs-comment">
                  <CommentAvatar uid={comment.authorUid} initials={comment.authorInitials} size="sm" isOwnComment={isOwn} />
                  <div className="cs-comment-body">
                    <div className="cs-comment-header">
                      <a href={isOwn ? '/profile' : `/user?id=${comment.authorUid}`} className="cs-name cs-name-link">{comment.authorName}</a>
                      <CommentUsername uid={comment.authorUid} />
                      <CommentBadge uid={comment.authorUid} size={13} />
                      <span className="cs-time">{timeAgo(comment.createdAt)}</span>
                    </div>
                    <div className="cs-comment-text">{comment.text}</div>
                    <div className="cs-comment-footer">
                      {user && <button className="cs-reply-btn" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}>{replyTo === comment.id ? 'Cancel' : 'Reply'}</button>}
                    </div>
                    {replyTo === comment.id && (
                      <div className="cs-reply-compose">
                        <div className="cs-input-wrap">
                          <textarea className="cs-textarea cs-textarea-sm" placeholder={`Reply to ${comment.authorName}…`} value={replyText} onChange={e => setReplyText(e.target.value)} rows={2} autoFocus />
                          <button className={`cs-kite-btn${replyText.trim() ? ' active' : ''}`} onClick={() => postComment(replyText, comment.id)} disabled={posting || !replyText.trim()}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#9b6dff"/></svg>
                          </button>
                        </div>
                      </div>
                    )}
                    {replies.length > 0 && (
                      <div className="cs-replies">
                        {replies.map(reply => {
                          const replyIsOwn = user?.uid === reply.authorUid;
                          return (
                            <div key={reply.id} className="cs-reply">
                              <CommentAvatar uid={reply.authorUid} initials={reply.authorInitials} size="xs" isOwnComment={replyIsOwn} />
                              <div className="cs-comment-body">
                                <div className="cs-comment-header">
                                  <a href={replyIsOwn ? '/profile' : `/user?id=${reply.authorUid}`} className="cs-name cs-name-link">{reply.authorName}</a>
                                  <CommentUsername uid={reply.authorUid} />
                                  <CommentBadge uid={reply.authorUid} size={12} />
                                  <span className="cs-time">{timeAgo(reply.createdAt)}</span>
                                </div>
                                <div className="cs-comment-text cs-comment-text-sm">{reply.text}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function StoryPageClient({ params }) {
  const { slug } = use(params);
  const [story, setStory] = useState(stories.find(s => s.id === slug) || null);
  const [storyReady, setStoryReady] = useState(!!stories.find(s => s.id === slug));
  useEffect(() => { const t = setTimeout(() => setStoryReady(true), 3000); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (story && storyReady) return;
    if (story) {
      setStoryReady(true);
      if (story.category === 'poetry' || story.category === 'novel' || story.readerMode) {
  window.location.replace(`/reader/${slug}`);
  return;
}
    }
    async function fetchFromCMS() {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'cms_stories/' + slug));
        if (snap.exists()) {
          const data = { id: slug, ...snap.val() };
          if (data.category === 'poetry' || data.category === 'novel' || data.readerMode) {
            window.location.replace(`/reader/${slug}`);
            return;
          }
          setStory(data);
          setStoryReady(true);
        }
      } catch (e) { console.error('CMS fetch error:', e); }
    }
    fetchFromCMS();
  }, [slug]);

  const [scrollProgress, setScrollProgress] = useState(0);
  const [readingTime, setReadingTime] = useState(0);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [hitCount, setHitCount] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const articleRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0);
      setIsHeaderVisible(scrollTop < lastScrollY || scrollTop < 100);
      setShowBackToTop(scrollTop > 600);
      setLastScrollY(scrollTop);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    if (articleRef.current && story) {
      setTimeout(() => {
        const text = articleRef.current?.innerText || '';
        setReadingTime(Math.ceil(text.trim().split(/\s+/).length / 220));
      }, 100);
    }
  }, [story]);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/hit?slug=${slug}`, { method: 'POST' })
      .then(r => r.json())
      .then(data => { if (typeof data.count === 'number') setHitCount(data.count); })
      .catch(() => {});

    let unsubRead;
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        unsubRead = onAuthStateChanged(auth, async (user) => {
          if (!user) return;
          unsubRead();
          try {
            const db = await getDB();
            const { ref, get, set, runTransaction, push, update } = await import('firebase/database');
            const readRef = ref(db, `users/${user.uid}/readStories/${slug}`);
            const snap = await get(readRef);
            if (!snap.exists()) {
              await set(readRef, true);
              await runTransaction(ref(db, `users/${user.uid}/readCount`), (c) => (c || 0) + 1);

              try {
                const countSnap = await get(ref(db, `users/${user.uid}/readCount`));
                const newCount = countSnap.exists() ? countSnap.val() : 1;
                if (newCount > 0 && newCount % 10 === 0) {
                  const pointsSnap = await get(ref(db, `points/${user.uid}/total`));
                  const current = pointsSnap.exists() ? pointsSnap.val() : 0;
                  await update(ref(db, `points/${user.uid}`), { total: current + 5 });
                  await push(ref(db, `points/${user.uid}/history`), {
                    type: 'read', amount: 5,
                    description: `${newCount} stories read milestone`,
                    createdAt: Date.now(),
                  });
                }
              } catch (e) {}
            }
          } catch (e) {}
        });
      } catch (e) {}
    })();
    return () => { if (unsubRead) unsubRead(); };
  }, [slug]);
useEffect(() => {
    const images = document.querySelectorAll('.prose img');
    images.forEach(img => {
      img.loading = 'lazy';
      if (img.complete) img.classList.add('loaded');
      else img.addEventListener('load', () => img.classList.add('loaded'));
    });
  }, [storyReady]);
  const categoryColors = { news: '#ef4444', flash: '#6b46c1', short: '#6b46c1', poetry: '#6b46c1', inspiring: '#d97706', serial: '#6b46c1' };
  if (!story) return <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />;
  const accentColor = categoryColors[story.category] || '#6b46c1';

  // ── Derived display values — works for both hardcoded and CMS stories ──
  const displayCategory = story.categoryName || story.category || 'News & Updates';
  const displaySubcategory = story.subcategory || null;

  const isPoetry = story.category === 'poetry';

  return (
    
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500&display=swap');
        @keyframes storyFadeIn { from { opacity: 0; } to { opacity: 1; } }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { background: #0a0a0a; }
        body { background: #0a0a0a; color: #e8e0d4; font-family: Cochin, Georgia, serif; overflow-x: hidden; }
        .story-fade-in { animation: storyFadeIn 0.7s ease forwards; }
        .reading-progress { position: fixed; top: 0; left: 0; height: 3px; background: linear-gradient(90deg, ${accentColor}, #a855f7); z-index: 1000; transition: width 0.1s linear; }
        .story-nav { position: fixed; top: 3px; left: 0; right: 0; z-index: 999; display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; background: rgba(10,10,10,0.88); backdrop-filter: blur(16px); border-bottom: 1px solid rgba(255,255,255,0.06); transition: transform 0.3s ease; }
        .story-nav.hidden { transform: translateY(-100%); }
        .nav-logo { font-family: Cochin, Georgia, serif; font-size: 1.05rem; font-weight: 600; color: #f0ead8; text-decoration: none; letter-spacing: 0.02em; }
        .nav-logo span { color: ${accentColor}; }
        .nav-meta { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(232,224,212,0.45); }
        .story-hero { position: relative; height: 88vh; min-height: 520px; display: flex; align-items: flex-end; overflow: hidden; background: #0a0a0a; }
        .hero-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; animation: heroZoom 12s ease-out forwards; filter: brightness(0.55); }
        @keyframes heroZoom { from { transform: scale(1.06); } to { transform: scale(1.0); } }
        .hero-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0.72) 45%, rgba(10,10,10,0.15) 100%); }
        .hero-cover-panel { display: block; position: absolute; bottom: 0; right: 4%; width: 180px; height: 260px; object-fit: cover; border-radius: 4px 8px 0 0; box-shadow: -8px 0 30px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06); z-index: 3; transform: perspective(600px) rotateY(-4deg); transform-origin: bottom right; }
        .hero-mobile-cover { display: none; position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; }
        .hero-mobile-overlay { display: none; position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0.5) 50%, transparent 100%); }
        .hero-content { position: relative; z-index: 2; padding: 3rem 2rem 3.5rem; max-width: 680px; animation: heroUp 1s cubic-bezier(0.22,1,0.36,1) 0.3s both; }
        @keyframes heroUp { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
        .story-badge-hero { display: inline-block; font-size: 0.64rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.3em 0.9em; border: 1px solid ${accentColor}; color: ${accentColor}; border-radius: 2px; margin-bottom: 1.1rem; font-family: Cochin, Georgia, serif; }
        .story-title { font-size: clamp(2.2rem, 5.5vw, 3.8rem); font-weight: 300; line-height: 1.1; color: #f0ead8; margin-bottom: 1.1rem; font-family: 'Cormorant Garamond', Cochin, Georgia, serif; }
        .story-byline { display: flex; align-items: center; gap: 1.4rem; font-size: 0.82rem; letter-spacing: 0.06em; color: rgba(232,224,212,0.55); flex-wrap: wrap; }
        .byline-dot { width: 3px; height: 3px; border-radius: 50%; background: ${accentColor}; opacity: 0.7; }
        .byline-by { font-style: italic; font-family: 'Cormorant Garamond', Georgia, serif; margin-right: -0.8rem; }
        .story-body-wrap { background: #f0ead8; }
        .story-body { max-width: 680px; margin: 0 auto; padding: 3rem 2rem 5rem; }
        .back-link-row { margin-bottom: 2.2rem; padding-bottom: 1.2rem; border-bottom: 1px solid #e0dbd2; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
        .back-link { display: inline-flex; align-items: center; gap: 0.4em; font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: ${accentColor}; text-decoration: none; font-family: Cochin, Georgia, serif; }
        .back-link:hover { text-decoration: underline; }
        .prose { font-size: 1.15rem; line-height: 1.85; color: #1a1a1a; font-family: Cochin, Georgia, serif; font-weight: 400; }
        .prose p { margin-bottom: 0; } .prose p + p { text-indent: 1.5em; }
        .prose.has-dropcap > p:first-of-type::first-letter { font-size: 4.2em; font-weight: 600; float: left; line-height: 0.78; margin: 0.06em 0.12em 0 0; color: ${accentColor}; font-family: 'Cormorant Garamond', Cochin, Georgia, serif; }
        .prose h2 { font-size: 1.45rem; font-weight: 700; color: #1a1a1a; margin: 2.2em 0 0.7em; font-family: Cochin, Georgia, serif; line-height: 1.3; }
        .prose h3 { font-size: 1.15rem; font-style: italic; color: ${accentColor}; margin: 2em 0 0.5em; font-weight: 400; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose h4 { font-size: 1rem; font-weight: 700; color: #1a1a1a; margin: 1.5em 0 0.4em; font-family: Cochin, Georgia, serif; }
        .prose img { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 4px; margin: 2em 0 0.5em; min-height: 200px; background: #e8e0d4; }
.prose img.loaded { min-height: unset; background: none; }
        .prose .article-image { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 8px; margin: 2em 0 0.5em; }
        .prose figure { margin: 2em 0; }
        .prose figcaption { font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: 0.5em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose img + em { display: block; font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: -1em; margin-bottom: 2em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose .image-caption { display: block; font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: 0.5em; margin-bottom: 2em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose .inline-image-caption { display: block; font-size: 0.82rem; color: #888; font-style: italic; text-align: right; margin-top: 0.4em; margin-bottom: 2em; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose .features-list { background: #e8e0f5; border-left: 4px solid ${accentColor}; border-radius: 0 8px 8px 0; padding: 1.25rem 1.5rem; margin: 1.5em 0 2em; }
        .prose .features-list ul { background: transparent; border: none; padding: 0; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
        .prose .features-list ul li { padding-left: 1.2rem; position: relative; font-size: 1.05rem; line-height: 1.6; color: #1a1a1a; }
        .prose .features-list ul li::before { content: '•'; position: absolute; left: 0; color: ${accentColor}; font-weight: 700; }
        .prose blockquote { margin: 2.2em 0; padding: 1.2em 1.6em; border-left: 4px solid ${accentColor}; background: rgba(107,70,193,0.07); font-size: 1.1rem; font-style: italic; color: ${accentColor}; line-height: 1.7; border-radius: 0 4px 4px 0; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose blockquote p { margin-bottom: 0; color: ${accentColor}; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose ul { margin: 1.8em 0; padding: 1.2em 1.5em 1.2em 2em; background: #ede6f5; border-left: 4px solid ${accentColor}; border-radius: 0 4px 4px 0; list-style: disc; }
        .prose ul li { margin-bottom: 0.55em; color: #1a1a1a; font-size: 1.05rem; line-height: 1.75; }
        .prose ul li::marker { color: ${accentColor}; }
        .prose ol { margin: 1.5em 0; padding-left: 1.8em; }
        .prose ol li { margin-bottom: 0.5em; color: #1a1a1a; }
        .prose hr { border: none; height: 2px; background: linear-gradient(90deg, transparent, ${accentColor}, transparent); width: 100px; margin: 3em auto; display: block; }
        .prose em { font-style: italic; color: inherit; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose i { font-style: italic; color: inherit; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; }
        .prose strong { font-weight: 700; color: #1a1a1a; }
        .prose .poem-collection-intro { font-style: italic; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; color: #555; margin-bottom: 1.5em; display: block; font-size: 1.1rem; }
        .prose .poem-contents { border-left: 4px solid ${accentColor}; padding: 0.8em 1.2em; margin: 1.5em 0; background: #ede6f5; border-radius: 0 4px 4px 0; }
        .prose .poem-contents p { margin-bottom: 0.5em; font-weight: 600; color: #1a1a1a; }
        .prose .poem-contents ol, .prose .poem-contents ul { background: transparent; border: none; padding: 0 0 0 1.2em; margin: 0; }
        .prose .poem-contents li { font-style: italic; color: #444; font-family: 'Cormorant Garamond', 'Times New Roman', Georgia, serif; font-size: 1.1rem; }
        .prose .poem-block { margin-bottom: 3.5em; display: block; }
        .prose .poem-title { font-size: 1.5rem; font-style: normal; color: ${accentColor}; margin-bottom: 1.2em; display: block; font-family: Cochin, Georgia, serif; font-weight: 700; }
        .prose .poem-stanza { font-family: Cochin, Georgia, serif; margin-bottom: 1.8em; display: block; white-space: pre-line; line-height: 1.75; color: #1a1a1a; font-size: 1.15rem; }
        .prose .poem-stanza p { margin-bottom: 0.25em; line-height: 1.75; color: #1a1a1a; white-space: pre-line; }
        .prose .poem-stanza p::first-letter { all: unset; }
        .prose .poem-stanza br { display: block; }
        .hit-counter-row { text-align: center; padding: 1.8rem 2rem 1.5rem; color: #888; font-size: 0.9rem; font-family: Cochin, Georgia, serif; border-top: 1px solid #e0dbd2; max-width: 680px; margin: 0 auto; background: #f0ead8; }
        .story-footer { background: #f0ead8; max-width: 680px; margin: 0 auto; padding: 1rem 2rem 2rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: #888; gap: 1rem; flex-wrap: wrap; font-family: Cochin, Georgia, serif; border-top: 1px solid #e0dbd2; }
        .story-badge-footer { display: inline-block; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; padding: 0.25em 0.8em; border: 1px solid ${accentColor}; color: ${accentColor}; border-radius: 2px; }
        .back-to-top { position: fixed; bottom: 2rem; right: 2rem; width: 44px; height: 44px; border-radius: 50%; background: rgba(124,58,237,0.85); border: 1px solid rgba(168,85,247,0.4); color: #fff; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); transition: opacity 0.3s ease, transform 0.3s ease; z-index: 998; box-shadow: 0 4px 20px rgba(124,58,237,0.4); }
        .back-to-top:hover { background: rgba(124,58,237,1); transform: translateY(-2px); }
        .back-to-top.hidden { opacity: 0; pointer-events: none; transform: translateY(8px); }
        .cs-section { background: #0a0a0a; max-width: 680px; margin: 0 auto; padding: 2.5rem 2rem 6rem; }
        .cs-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .cs-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.3rem; font-weight: 300; color: #f5f0e8; letter-spacing: 0.02em; }
        .cs-count { font-size: 0.68rem; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .cs-compose { margin-bottom: 2rem; }
        .cs-compose-row { display: flex; gap: 12px; align-items: flex-start; }
        .cs-avatar-compose { width: 36px; height: 36px; border-radius: 50%; background: rgba(107,47,173,0.25); border: 1px solid rgba(107,47,173,0.3); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 500; color: #9b6dff; flex-shrink: 0; font-family: 'Inter', sans-serif; overflow: hidden; text-decoration: none; }
        .cs-input-wrap { flex: 1; position: relative; }
        .cs-textarea { width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 0.85rem 3rem 0.85rem 1rem; font-size: 0.9rem; color: #e8e0d4; font-family: 'Cormorant Garamond', Georgia, serif; resize: none; outline: none; box-sizing: border-box; line-height: 1.6; }
        .cs-textarea-sm { min-height: 56px; font-size: 0.85rem; border-radius: 10px; }
        .cs-textarea::placeholder { color: rgba(255,255,255,0.18); font-style: italic; }
        .cs-textarea:focus { border-color: rgba(107,47,173,0.4); }
        .cs-kite-btn { position: absolute; bottom: 8px; right: 8px; background: none; border: none; cursor: pointer; padding: 4px; opacity: 0.2; transition: opacity 0.2s; }
        .cs-kite-btn.active { opacity: 1; }
        .cs-kite-btn:disabled { cursor: not-allowed; }
        .cs-signin-prompt { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 1.5rem; text-align: center; margin-bottom: 2rem; }
        .cs-signin-prompt p { font-size: 0.82rem; color: rgba(255,255,255,0.3); margin-bottom: 0.75rem; font-family: 'Inter', sans-serif; }
        .cs-signin-btn { background: none; border: 1px solid rgba(107,47,173,0.4); border-radius: 8px; padding: 0.55rem 1.4rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #9b6dff; cursor: pointer; font-family: 'Inter', sans-serif; }
        .cs-loading { font-size: 0.8rem; color: rgba(255,255,255,0.2); font-family: 'Inter', sans-serif; padding: 1rem 0; }
        .cs-empty { font-size: 0.88rem; color: rgba(255,255,255,0.2); font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; padding: 1rem 0; }
        .cs-comments-list { display: flex; flex-direction: column; }
        .cs-divider { height: 1px; background: rgba(255,255,255,0.05); margin: 0.25rem 0 1.75rem; }
        .cs-comment { display: flex; gap: 12px; margin-bottom: 0.25rem; }
        .cs-comment-body { flex: 1; min-width: 0; }
        .cs-comment-header { display: flex; align-items: center; gap: 6px; margin-bottom: 0.45rem; flex-wrap: wrap; }
        .cs-name { font-size: 0.8rem; font-weight: 500; color: #e8e0d4; font-family: 'Inter', sans-serif; }
        .cs-name-link { text-decoration: none; transition: color 0.2s; }
        .cs-name-link:hover { color: #a78bfa; }
        .cs-time { font-size: 0.65rem; color: rgba(255,255,255,0.22); font-family: 'Inter', sans-serif; }
        .cs-comment-text { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; color: rgba(232,224,212,0.75); line-height: 1.75; }
        .cs-comment-text-sm { font-size: 0.92rem; }
        .cs-comment-footer { margin-top: 0.5rem; }
        .cs-reply-btn { background: none; border: none; font-size: 0.62rem; color: rgba(255,255,255,0.22); cursor: pointer; padding: 0; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; transition: color 0.2s; }
        .cs-reply-btn:hover { color: #9b6dff; }
        .cs-reply-compose { margin-top: 0.75rem; }
        .cs-replies { margin-top: 1rem; padding-left: 1rem; border-left: 1px solid rgba(107,47,173,0.2); display: flex; flex-direction: column; gap: 1rem; }
        .cs-reply { display: flex; gap: 10px; }
        @media (max-width: 640px) {
          .hero-cover-panel { width: 100px; height: 145px; bottom: 0; right: 4%; z-index: 0; }
          .story-body { padding: 2.5rem 1.2rem 4rem; }
          .hero-content { padding: 2rem 1.2rem 2.5rem 1.2rem; padding-right: 120px; }
          .prose { font-size: 1.05rem; }
          .story-nav { padding: 0.85rem 1.2rem; }
          .hit-counter-row { padding: 1.5rem 1.2rem; }
          .cs-section { padding: 2rem 1.2rem 5rem; }
        }
      .prose figure { margin: 2em 0; }
.prose figure img { margin: 0; }`}</style>

      <div className="reading-progress" style={{ width: `${scrollProgress}%` }} />
      <div className={storyReady ? 'story-fade-in' : ''} style={{ opacity: storyReady ? undefined : 0 }}>
        <nav className={`story-nav${isHeaderVisible ? '' : ' hidden'}`}>
          <a href="/" className="nav-logo">Calvary <span>Scribblings</span></a>
          <span className="nav-meta">{displayCategory}</span>
        </nav>
        <header className="story-hero">
          <img className="hero-bg" src={story.cover} alt="" aria-hidden="true" />
          <div className="hero-overlay" />
          <img className="hero-mobile-cover" src={story.cover} alt={story.title} />
          <div className="hero-mobile-overlay" />
          <img className="hero-cover-panel" src={story.cover} alt={story.title} />
          <div className="hero-content">
            <div className="story-badge-hero">
              {displaySubcategory || displayCategory}
            </div>
            <h1 className="story-title">{story.title}</h1>
            <div className="story-byline">
              <span className="byline-by">by</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{story.author}</span>
                {story.authorHandle && (
                  <AuthorHandleLink handle={story.authorHandle}
                    style={{ fontSize: '0.72rem', color: 'rgba(167,139,250,0.65)', textDecoration: 'none', letterSpacing: '0.04em', fontStyle: 'normal', fontFamily: 'Inter, sans-serif' }} />
                )}
              </span>
              <div className="byline-dot" />
              <span>{story.date}</span>
              {readingTime > 0 && (<><div className="byline-dot" /><span>⏱ {readingTime} MIN. READ</span></>)}
            </div>
          </div>
        </header>
        <div className="story-body-wrap">
          <main>
            <article className="story-body" ref={articleRef}>
              <div className="back-link-row">
  <a href={`/${story.category}`} className="back-link">
    ← {displayCategory}{displaySubcategory ? ` · ${displaySubcategory}` : ''}
  </a>
  {story.readerMode && (
    <a href={`/reader/${slug}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.4em',
      fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase',
      color: '#c9a44c', textDecoration: 'none', fontFamily: 'Cochin, Georgia, serif',
      border: '1px solid rgba(201,164,76,0.4)', padding: '0.3em 0.8em', borderRadius: '2px',
      transition: 'all 0.2s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,164,76,0.08)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      📖 Read in Book Reader
    </a>
  )}
</div>
              <div className={`prose${isPoetry ? '' : ' has-dropcap'}`} id="story-content" dangerouslySetInnerHTML={{ __html: storyContent[slug] || story.content || '<p>Content coming soon.</p>' }} />
            </article>
            <div className="hit-counter-row">{hitCount !== null ? `${hitCount.toLocaleString()} Reads` : '— Reads'}</div>
            <div className="story-footer">
              <span>
                By {story.author}
                {story.authorHandle && (
                  <AuthorHandleLink handle={story.authorHandle}
                    style={{ color: 'rgba(167,139,250,0.55)', textDecoration: 'none', marginLeft: 4, fontSize: '0.72rem', fontFamily: 'Inter, sans-serif' }} />
                )} · {story.date}
              </span>
              <span className="story-badge-footer">
                {displaySubcategory || displayCategory}
              </span>
            </div>
          </main>
        </div>
        <ExerciseSection slug={slug} />
        <div style={{ background: '#f0ead8', padding: '2rem 2rem 3rem', maxWidth: '680px', margin: '0 auto' }}><TipBox variant="story" /></div>
        <CommentsSection slug={slug} onSignIn={() => setShowAuthModal(true)} />
        {showAuthModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={e => { if (e.target === e.currentTarget) setShowAuthModal(false); }}>
            <AuthModal onClose={() => setShowAuthModal(false)} />
          </div>
        )}
      </div>
      <button className={showBackToTop ? 'back-to-top' : 'back-to-top hidden'} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top">↑</button>
    </>
    
  );
}