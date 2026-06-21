'use client';

// Open Pages — composer (Stage 3). /open-pages/new
//
// A logged-in user writes a post in MARKDOWN, submits, the moderation Pages
// Function (/api/open-pages/moderate) screens it, and the UI shows the outcome:
//   published -> live on the public feed
//   pending   -> held for a quick human review (mature/explicit content)
//   rejected  -> violates guidelines; form kept so they can edit
//
// Body is Markdown, so a plain styled <textarea> is correct — NO WYSIWYG / HTML
// editor. The optional live preview renders Markdown to React ELEMENTS only via a
// tiny inline renderer (no dangerouslySetInnerHTML, no raw HTML — XSS-safe).

import { useState } from 'react';
import Navbar from '../../components/Navbar';
import AuthModal from '../../components/AuthModal';
import { useAuth } from '../../lib/AuthContext';

const TITLE_MAX = 200;
const BODY_MAX = 50000;

// Brand palette.
const INK = '#080610';
const PURPLE = '#6b2fad';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const SERIF = "'Cormorant Garamond', 'Cochin', Georgia, serif";
const BODY_SERIF = "'Cochin', Georgia, serif";

// ---------------------------------------------------------------------------
// Tiny, escape-safe Markdown → React renderer (preview only).
// Supports: #..### headings, blank-line paragraphs, - / * unordered lists,
// > blockquotes, and inline **bold**, *italic*, `code`, [text](url).
// Everything is built as React elements, so React escapes all text. Link hrefs
// are sanitised to http(s)/mailto/relative — never javascript: etc.
// ---------------------------------------------------------------------------

function safeHref(url) {
  const u = (url || '').trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || u.startsWith('/')) return u;
  return null; // unsafe scheme → render as plain text
}

function renderInline(text, keyPrefix) {
  const nodes = [];
  let i = 0;
  let k = 0;
  const push = (n) => nodes.push(typeof n === 'string' ? n : { ...n });
  // Token regex: links, bold, italic, code (in priority order via alternation).
  const re = /(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let m;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      const href = safeHref(m[3]);
      if (href) {
        nodes.push(
          <a key={`${keyPrefix}-a-${k++}`} href={href} target="_blank" rel="noopener noreferrer nofollow" style={{ color: GOLD, textDecoration: 'underline' }}>
            {m[2]}
          </a>
        );
      } else {
        nodes.push(m[2]); // drop unsafe link, keep its text
      }
    } else if (m[4]) {
      nodes.push(<strong key={`${keyPrefix}-b-${k++}`}>{m[5]}</strong>);
    } else if (m[6]) {
      nodes.push(<em key={`${keyPrefix}-i-${k++}`}>{m[7]}</em>);
    } else if (m[8]) {
      nodes.push(
        <code key={`${keyPrefix}-c-${k++}`} style={{ background: 'rgba(245,240,232,0.08)', padding: '0.05em 0.35em', borderRadius: 3, fontSize: '0.9em' }}>
          {m[9]}
        </code>
      );
    }
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(md) {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const txt = para.join(' ');
      blocks.push(
        <p key={`p-${key++}`} style={{ margin: '0 0 0.85rem', lineHeight: 1.7, color: CREAM }}>
          {renderInline(txt, `p${key}`)}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${key++}`} style={{ margin: '0 0 0.85rem 1.2rem', lineHeight: 1.7, color: CREAM }}>
          {list.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li${key}-${idx}`)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const sizes = [0, 1.9, 1.55, 1.3, 1.15, 1.05, 1];
      blocks.push(
        <p key={`h-${key++}`} style={{ margin: '1.1rem 0 0.5rem', fontFamily: SERIF, fontWeight: 700, fontSize: `${sizes[level]}rem`, color: GOLD }}>
          {renderInline(heading[2], `h${key}`)}
        </p>
      );
    } else if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (quote) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote key={`q-${key++}`} style={{ margin: '0 0 0.85rem', padding: '0.2rem 0 0.2rem 1rem', borderLeft: `3px solid ${PURPLE}`, color: 'rgba(245,240,232,0.85)', fontStyle: 'italic' }}>
          {renderInline(quote[1], `q${key}`)}
        </blockquote>
      );
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

// ---------------------------------------------------------------------------
// Page.
// ---------------------------------------------------------------------------

export default function NewOpenPagePage() {
  const { user, loading } = useAuth();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  // outcome: { kind: 'published'|'pending'|'rejected'|'error', message, link? }
  const [outcome, setOutcome] = useState(null);

  const titleLeft = TITLE_MAX - title.length;
  const bodyLeft = BODY_MAX - body.length;
  const titleNearLimit = title.length > TITLE_MAX * 0.9;
  const bodyNearLimit = body.length > BODY_MAX * 0.95;

  const canSubmit =
    !!title.trim() &&
    !!body.trim() &&
    title.length <= TITLE_MAX &&
    body.length <= BODY_MAX &&
    !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    setOutcome(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/open-pages/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, title: title.trim(), body: body.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.status === 'published') {
        setOutcome({
          kind: 'published',
          message: 'Your post is live on Open Pages.',
          link: '/open-pages',
        });
        setTitle('');
        setBody('');
        setPreview(false);
      } else if (res.ok && data.status === 'pending') {
        setOutcome({
          kind: 'pending',
          message:
            'Thanks — your post is being reviewed and will appear once approved. Posts with mature or explicit content get a quick human check first.',
        });
        setTitle('');
        setBody('');
        setPreview(false);
      } else if (res.ok && data.status === 'rejected') {
        // Keep the form so they can edit. Non-graphic generic message.
        setOutcome({
          kind: 'rejected',
          message: data.reason || 'This post can’t be published because it appears to violate our community guidelines.',
        });
      } else {
        setOutcome({
          kind: 'error',
          message: data.error || 'Something went wrong, please try again.',
        });
      }
    } catch {
      setOutcome({ kind: 'error', message: 'Something went wrong, please try again.' });
    }
    setSubmitting(false);
  }

  // ---- Auth gate ----
  if (!loading && !user) {
    return (
      <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
        <Navbar />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '5rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontFamily: SERIF, fontSize: '2.2rem', fontWeight: 700, color: GOLD, marginBottom: '0.75rem' }}>
            Open Pages
          </div>
          <p style={{ fontSize: '1.15rem', lineHeight: 1.7, color: 'rgba(245,240,232,0.85)', marginBottom: '2rem' }}>
            Open Pages is a place for our community to publish their own writing.
            Sign in to share a post.
          </p>
          <button
            onClick={() => setShowAuth(true)}
            style={{
              background: `linear-gradient(135deg, ${PURPLE}, #8b4fd1)`,
              color: '#fff',
              border: 'none',
              padding: '0.85rem 2rem',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
              fontFamily: BODY_SERIF,
              boxShadow: '0 6px 22px rgba(107,47,173,0.4)',
            }}
          >
            Sign in to write
          </button>
          <div style={{ marginTop: '1.5rem' }}>
            <a href="/open-pages" style={{ color: 'rgba(245,240,232,0.5)', fontSize: '0.9rem', textDecoration: 'none' }}>
              ← Browse Open Pages
            </a>
          </div>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  return (
    <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
      <Navbar />

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '2.5rem 1.5rem 5rem' }}>
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontFamily: SERIF, fontSize: '2.4rem', fontWeight: 700, color: GOLD, lineHeight: 1.1 }}>
            Write on Open Pages
          </div>
          <p style={{ fontSize: '1.05rem', color: 'rgba(245,240,232,0.7)', marginTop: '0.5rem', lineHeight: 1.6 }}>
            Share a story, a poem, a reflection. Your post is checked before it goes live.
          </p>
        </div>

        {/* Outcome banner */}
        {outcome && (
          <div
            role="status"
            style={{
              border: `1px solid ${
                outcome.kind === 'published'
                  ? 'rgba(201,168,76,0.5)'
                  : outcome.kind === 'pending'
                  ? 'rgba(107,47,173,0.55)'
                  : 'rgba(220,90,90,0.5)'
              }`,
              background:
                outcome.kind === 'published'
                  ? 'rgba(201,168,76,0.08)'
                  : outcome.kind === 'pending'
                  ? 'rgba(107,47,173,0.1)'
                  : 'rgba(220,90,90,0.08)',
              borderRadius: 10,
              padding: '1rem 1.2rem',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.2rem', color: outcome.kind === 'rejected' || outcome.kind === 'error' ? '#e88' : GOLD, marginBottom: '0.25rem' }}>
              {outcome.kind === 'published' && 'Your post is live!'}
              {outcome.kind === 'pending' && 'Under review'}
              {outcome.kind === 'rejected' && 'Couldn’t publish this'}
              {outcome.kind === 'error' && 'Hmm — that didn’t work'}
            </div>
            <p style={{ margin: 0, lineHeight: 1.6, color: 'rgba(245,240,232,0.9)' }}>{outcome.message}</p>
            {outcome.link && (
              <a href={outcome.link} style={{ display: 'inline-block', marginTop: '0.6rem', color: GOLD, fontWeight: 700, textDecoration: 'none' }}>
                View on Open Pages →
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <label style={{ display: 'block', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.55)' }}>Title</span>
              <span style={{ fontSize: '0.78rem', color: titleNearLimit ? '#e88' : 'rgba(245,240,232,0.4)' }}>{titleLeft}</span>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              placeholder="Give your post a title"
              disabled={submitting}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(245,240,232,0.04)',
                border: '1px solid rgba(245,240,232,0.18)',
                borderRadius: 8,
                padding: '0.8rem 1rem',
                color: CREAM,
                fontSize: '1.2rem',
                fontFamily: SERIF,
                outline: 'none',
              }}
            />
          </label>

          {/* Body */}
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.55)' }}>Your writing</span>
              <span style={{ fontSize: '0.78rem', color: bodyNearLimit ? '#e88' : 'rgba(245,240,232,0.4)' }}>{bodyLeft.toLocaleString()}</span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setPreview(false)}
                style={tabStyle(!preview)}
              >
                Write
              </button>
              <button
                type="button"
                onClick={() => setPreview(true)}
                style={tabStyle(preview)}
              >
                Preview
              </button>
            </div>

            {!preview ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                maxLength={BODY_MAX}
                placeholder="Write your post in Markdown…"
                disabled={submitting}
                rows={16}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'rgba(245,240,232,0.04)',
                  border: '1px solid rgba(245,240,232,0.18)',
                  borderRadius: 8,
                  padding: '1rem 1.1rem',
                  color: CREAM,
                  fontSize: '1.08rem',
                  lineHeight: 1.7,
                  fontFamily: BODY_SERIF,
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 320,
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'rgba(245,240,232,0.04)',
                  border: '1px solid rgba(245,240,232,0.18)',
                  borderRadius: 8,
                  padding: '1.1rem 1.2rem',
                  minHeight: 320,
                  fontSize: '1.08rem',
                }}
              >
                {body.trim() ? (
                  renderMarkdown(body)
                ) : (
                  <span style={{ color: 'rgba(245,240,232,0.4)' }}>Nothing to preview yet.</span>
                )}
              </div>
            )}
          </label>

          {/* Markdown hint */}
          <div style={{ fontSize: '0.82rem', color: 'rgba(245,240,232,0.45)', marginBottom: '1.75rem', lineHeight: 1.6 }}>
            <strong style={{ color: 'rgba(245,240,232,0.6)' }}>Markdown supported</strong> — bold <code style={hintCode}>**like this**</code>, italic{' '}
            <code style={hintCode}>*like this*</code>, links <code style={hintCode}>[text](url)</code>, headings <code style={hintCode}>#</code>.
          </div>

          {/* Publish */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                background: canSubmit ? `linear-gradient(135deg, ${PURPLE}, #8b4fd1)` : 'rgba(245,240,232,0.1)',
                color: canSubmit ? '#fff' : 'rgba(245,240,232,0.4)',
                border: 'none',
                padding: '0.85rem 2.2rem',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: '1rem',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: BODY_SERIF,
                boxShadow: canSubmit ? '0 6px 22px rgba(107,47,173,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {submitting ? 'Checking your post…' : 'Publish'}
            </button>
            {submitting && (
              <span style={{ fontSize: '0.9rem', color: 'rgba(245,240,232,0.55)' }}>
                Running a quick safety check — this takes a moment.
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

const hintCode = { background: 'rgba(245,240,232,0.08)', padding: '0.05em 0.35em', borderRadius: 3 };

function tabStyle(active) {
  return {
    background: active ? 'rgba(107,47,173,0.25)' : 'transparent',
    color: active ? CREAM : 'rgba(245,240,232,0.5)',
    border: `1px solid ${active ? 'rgba(107,47,173,0.5)' : 'rgba(245,240,232,0.15)'}`,
    padding: '0.35rem 0.9rem',
    borderRadius: 6,
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: BODY_SERIF,
  };
}
