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

import { useState, useRef, useEffect } from 'react';
import Navbar from '../../components/Navbar';
import AuthModal from '../../components/AuthModal';
import { useAuth } from '../../lib/AuthContext';
import { storage } from '../../lib/firebase';
import { OPEN_PAGE_GENRES, DEFAULT_GENRE } from '../../lib/openPages';

const TITLE_MAX = 200;
const BODY_MAX = 50000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_INLINE_IMAGES = 10; // soft cap per post
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/gif';

// Validate a chosen file before upload. Returns an error string, or null if ok.
function validateImageFile(file) {
  if (!file) return 'No file selected.';
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Please choose a JPG, PNG, WebP, or GIF image.';
  if (file.size > MAX_IMAGE_BYTES) return 'Image is too large — please keep it under 5MB.';
  return null;
}

// Upload an image to Firebase Storage under open_pages/{uid}/ and return its
// download URL. Reuses the platform's storage upload pattern (uploadBytes +
// getDownloadURL, lazy-imported), same storage instance as profile avatars.
async function uploadOpenPageImage(uid, file, kind) {
  const safeName = (file.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `open_pages/${uid}/${kind}-${Date.now()}-${safeName}`;
  const { ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const r = sRef(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

// Count inline Markdown images currently in the body.
function countInlineImages(md) {
  const m = (md || '').match(/!\[[^\]]*\]\([^)\s]+\)/g);
  return m ? m.length : 0;
}

// Brand palette.
const INK = '#080610';
const PURPLE = '#6b2fad';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const SERIF = "Cormorant Garamond, Georgia, serif";
const BODY_SERIF = "Cormorant Garamond, Georgia, serif";

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
  let k = 0;
  // Token regex (priority order via alternation):
  //   image ![alt](url) — MUST come before link so the leading ! isn't stripped
  //   link [text](url), bold **x**, italic *x*, code `x`
  const re =
    /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let m;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      // image — same href sanitisation as links; render a width-capped <img>
      const src = safeHref(m[3]);
      if (src) {
        nodes.push(
          <img
            key={`${keyPrefix}-img-${k++}`}
            src={src}
            alt={m[2] || ''}
            style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, display: 'block', margin: '0.6rem 0' }}
          />
        );
      } else {
        nodes.push(m[2] || ''); // unsafe src → keep alt text only
      }
    } else if (m[4]) {
      const href = safeHref(m[6]);
      if (href) {
        nodes.push(
          <a key={`${keyPrefix}-a-${k++}`} href={href} target="_blank" rel="noopener noreferrer nofollow" style={{ color: GOLD, textDecoration: 'underline' }}>
            {m[5]}
          </a>
        );
      } else {
        nodes.push(m[5]); // drop unsafe link, keep its text
      }
    } else if (m[7]) {
      nodes.push(<strong key={`${keyPrefix}-b-${k++}`}>{m[8]}</strong>);
    } else if (m[9]) {
      nodes.push(<em key={`${keyPrefix}-i-${k++}`} style={{ fontFamily: SERIF }}>{m[10]}</em>);
    } else if (m[11]) {
      nodes.push(
        <code key={`${keyPrefix}-c-${k++}`} style={{ background: 'rgba(245,240,232,0.08)', padding: '0.05em 0.35em', borderRadius: 3, fontSize: '0.9em' }}>
          {m[12]}
        </code>
      );
    }
    last = re.lastIndex;
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
        <blockquote key={`q-${key++}`} style={{ margin: '0 0 0.85rem', padding: '0.2rem 0 0.2rem 1rem', borderLeft: `3px solid ${PURPLE}`, color: 'rgba(245,240,232,0.85)', fontStyle: 'italic', fontFamily: SERIF }}>
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
  const [genre, setGenre] = useState(DEFAULT_GENRE);
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  // Pocket eligibility strip — collapsed by default (Task 4). Real thresholds
  // arrive in Stage 7; for now the values are placeholders (all 0).
  const [pocketOpen, setPocketOpen] = useState(false);

  // Cover image (optional hero).
  const [coverImage, setCoverImage] = useState(null); // download URL
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState('');

  // Inline image upload state.
  const [imgUploading, setImgUploading] = useState(false);
  const [imgError, setImgError] = useState('');

  const coverInputRef = useRef(null);
  const imgInputRef = useRef(null);
  const bodyRef = useRef(null);

  // outcome: { kind: 'published'|'pending'|'rejected'|'error', message, link? }
  const [outcome, setOutcome] = useState(null);

  const inlineCount = countInlineImages(body);
  const inlineCapReached = inlineCount >= MAX_INLINE_IMAGES;

  async function handleCoverSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!file || !user) return;
    setCoverError('');
    const err = validateImageFile(file);
    if (err) { setCoverError(err); return; }
    setCoverUploading(true);
    try {
      const url = await uploadOpenPageImage(user.uid, file, 'cover');
      setCoverImage(url);
    } catch {
      setCoverError('Cover upload failed, try again.');
    }
    setCoverUploading(false);
  }

  function handleRemoveCover() {
    setCoverImage(null);
    setCoverError('');
  }

  async function handleInlineSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!file || !user) return;
    setImgError('');
    if (inlineCapReached) { setImgError(`You can add up to ${MAX_INLINE_IMAGES} images per post.`); return; }
    const err = validateImageFile(file);
    if (err) { setImgError(err); return; }
    setImgUploading(true);
    try {
      const url = await uploadOpenPageImage(user.uid, file, 'img');
      const alt = (file.name || 'image').replace(/\.[^.]+$/, '');
      const snippet = `\n\n![${alt}](${url})\n\n`;
      // Insert at the textarea cursor if available, else append.
      const ta = bodyRef.current;
      let next;
      if (ta && typeof ta.selectionStart === 'number') {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        next = body.slice(0, start) + snippet + body.slice(end);
      } else {
        next = body + snippet;
      }
      if (next.length > BODY_MAX) {
        setImgError('Adding this image would exceed the length limit.');
      } else {
        setBody(next);
        setPreview(false);
      }
    } catch {
      setImgError('Image upload failed, try again.');
    }
    setImgUploading(false);
  }

  const titleLeft = TITLE_MAX - title.length;
  const bodyLeft = BODY_MAX - body.length;
  const titleNearLimit = title.length > TITLE_MAX * 0.9;
  const bodyNearLimit = body.length > BODY_MAX * 0.95;

  const canSubmit =
    !!title.trim() &&
    !!body.trim() &&
    title.length <= TITLE_MAX &&
    body.length <= BODY_MAX &&
    !submitting &&
    !coverUploading &&
    !imgUploading;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    setOutcome(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/open-pages/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, title: title.trim(), body: body.trim(), coverImage, genre }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.status === 'published') {
        setOutcome({
          kind: 'published',
          message: 'Your post is live on Open Pages.',
          link: '/open-pages',
          hookStatus: data.hookStatus || 'not_called',
        });
        setTitle('');
        setBody('');
        setGenre(DEFAULT_GENRE);
        setCoverImage(null);
        setPreview(false);
      } else if (res.ok && data.status === 'pending') {
        setOutcome({
          kind: 'pending',
          message:
            'Thanks — your post is being reviewed and will appear once approved. Posts with mature or explicit content get a quick human check first.',
        });
        setTitle('');
        setBody('');
        setGenre(DEFAULT_GENRE);
        setCoverImage(null);
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
          <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: GOLD, opacity: 0.75, marginBottom: 16 }}>
            Open Pages
          </div>
          <div style={{ fontFamily: SERIF, fontSize: '2.4rem', fontWeight: 500, color: CREAM, marginBottom: '0.9rem', lineHeight: 1.1 }}>
            Tell your story
          </div>
          <p style={{ fontSize: '1.15rem', lineHeight: 1.7, color: 'rgba(245,240,232,0.7)', marginBottom: '2rem' }}>
            Open Pages is a place for our community to publish their own writing.
            Sign in to share a post.
          </p>
          <button
            onClick={() => setShowAuth(true)}
            style={{
              background: PURPLE,
              color: CREAM,
              border: 'none',
              padding: '0.9rem 3rem',
              borderRadius: 9,
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
              fontFamily: BODY_SERIF,
              boxShadow: '0 8px 28px rgba(107,47,173,0.35)',
            }}
          >
            Sign in to write
          </button>
          <div style={{ marginTop: '1.5rem' }}>
            <a href="/open-pages" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(245,240,232,0.5)', fontSize: '0.9rem', textDecoration: 'none' }}>
              <IconArrowLeft size={15} /> Browse Open Pages
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

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '60px 24px 96px' }}>
        {/* Centred header */}
        <div style={{ textAlign: 'center', marginBottom: '2.75rem' }}>
          <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: GOLD, opacity: 0.75, marginBottom: 16 }}>
            Open Pages
          </div>
          <h1 style={{ fontFamily: SERIF, fontSize: '2.5rem', fontWeight: 500, color: CREAM, margin: 0, lineHeight: 1.1 }}>
            Tell your story
          </h1>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '1.18rem', color: 'rgba(245,240,232,0.55)', marginTop: 14, marginBottom: 0 }}>
            A story, a poem, a reflection — checked before it goes live.
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
            {outcome.kind === 'published' && <DeployStatusPulse hookStatus={outcome.hookStatus} />}
            <p style={{ margin: 0, lineHeight: 1.6, color: 'rgba(245,240,232,0.9)' }}>{outcome.message}</p>
            {outcome.link && (
              <a href={outcome.link} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: '0.6rem', color: GOLD, fontWeight: 700, textDecoration: 'none' }}>
                View on Open Pages <IconArrowRight size={16} />
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Hidden file inputs */}
          <input
            ref={coverInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            style={{ display: 'none' }}
            onChange={handleCoverSelect}
          />
          <input
            ref={imgInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            style={{ display: 'none' }}
            onChange={handleInlineSelect}
          />

          {/* Cover image */}
          <div style={{ marginBottom: '1.5rem' }}>
            {coverImage ? (
              <div style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImage}
                  alt="Cover preview"
                  style={{ width: '100%', maxHeight: 320, objectFit: 'cover', borderRadius: 10, display: 'block', border: '1px solid rgba(245,240,232,0.18)' }}
                />
                <button
                  type="button"
                  onClick={handleRemoveCover}
                  disabled={submitting}
                  style={{
                    position: 'absolute', top: 10, right: 10,
                    background: 'rgba(8,6,16,0.8)', color: CREAM,
                    border: '1px solid rgba(245,240,232,0.3)', borderRadius: 6,
                    padding: '0.35rem 0.8rem', fontSize: '0.8rem', fontWeight: 600,
                    cursor: 'pointer', fontFamily: BODY_SERIF,
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current && coverInputRef.current.click()}
                disabled={coverUploading || submitting}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  border: '1px dashed rgba(201,168,76,0.3)',
                  background: 'rgba(201,168,76,0.02)',
                  borderRadius: 12,
                  padding: '1.6rem',
                  color: coverUploading ? 'rgba(245,240,232,0.45)' : 'rgba(245,240,232,0.7)',
                  fontSize: '0.98rem',
                  fontFamily: BODY_SERIF,
                  cursor: coverUploading || submitting ? 'not-allowed' : 'pointer',
                }}
              >
                <IconUpload size={18} style={{ color: GOLD, opacity: 0.85 }} />
                {coverUploading ? 'Uploading cover…' : 'Add a cover image'}
              </button>
            )}
            {coverError && (
              <div style={{ color: '#e88', fontSize: '0.82rem', marginTop: '0.5rem' }}>{coverError}</div>
            )}
          </div>

          {/* Title — borderless, placeholder-only, subtle counter top-right */}
          <div style={{ marginBottom: '1.9rem' }}>
            <div style={{ textAlign: 'right', fontSize: '0.72rem', color: titleNearLimit ? '#e88' : 'rgba(245,240,232,0.3)', marginBottom: 2 }}>
              {titleLeft}
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              placeholder="Title"
              disabled={submitting}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'transparent',
                border: 'none',
                borderBottom: '0.5px solid rgba(245,240,232,0.12)',
                borderRadius: 0,
                padding: '0.4rem 0',
                color: CREAM,
                fontSize: '1.85rem',
                fontWeight: 500,
                fontFamily: SERIF,
                outline: 'none',
              }}
            />
          </div>

          {/* Genre picker — six categories; defaults to General */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.45)', marginBottom: 10 }}>
              Genre
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {OPEN_PAGE_GENRES.map((g) => {
                const active = genre === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenre(g)}
                    disabled={submitting}
                    style={{
                      background: active ? PURPLE : 'rgba(245,240,232,0.04)',
                      color: active ? CREAM : 'rgba(245,240,232,0.6)',
                      border: `1px solid ${active ? PURPLE : 'rgba(245,240,232,0.14)'}`,
                      borderRadius: 999,
                      padding: '0.4rem 1rem',
                      fontFamily: CINZEL,
                      fontSize: '0.74rem',
                      letterSpacing: '0.06em',
                      fontWeight: active ? 600 : 500,
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      transition: 'all 0.18s',
                    }}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body — borderless writing area */}
          <div>
            {/* Toolbar: segmented Write/Preview + Insert image */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div style={segWrap}>
                <button type="button" onClick={() => setPreview(false)} style={segBtn(!preview)}>Write</button>
                <button type="button" onClick={() => setPreview(true)} style={segBtn(preview)}>Preview</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {inlineCount > 0 && (
                  <span style={{ fontSize: '0.72rem', color: inlineCapReached ? '#e88' : 'rgba(245,240,232,0.35)' }}>
                    {inlineCount}/{MAX_INLINE_IMAGES}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => imgInputRef.current && imgInputRef.current.click()}
                  disabled={imgUploading || submitting || inlineCapReached}
                  title={inlineCapReached ? `Up to ${MAX_INLINE_IMAGES} images per post` : 'Insert an image at the cursor'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    background: 'transparent',
                    border: '1px solid rgba(245,240,232,0.15)',
                    borderRadius: 7,
                    padding: '0.4rem 0.85rem',
                    color: 'rgba(245,240,232,0.7)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    fontFamily: BODY_SERIF,
                    opacity: imgUploading || inlineCapReached ? 0.45 : 1,
                    cursor: imgUploading || submitting || inlineCapReached ? 'not-allowed' : 'pointer',
                  }}
                >
                  <IconImagePlus size={15} />
                  {imgUploading ? 'Uploading…' : 'Insert image'}
                </button>
              </div>
            </div>
            {imgError && (
              <div style={{ color: '#e88', fontSize: '0.82rem', marginBottom: '0.6rem' }}>{imgError}</div>
            )}

            {!preview ? (
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                maxLength={BODY_MAX}
                placeholder="Begin writing…"
                disabled={submitting}
                rows={16}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  padding: 0,
                  color: 'rgba(245,240,232,0.85)',
                  fontSize: '1.18rem',
                  lineHeight: 1.75,
                  fontFamily: BODY_SERIF,
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 340,
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  minHeight: 340,
                  fontSize: '1.18rem',
                  lineHeight: 1.75,
                  color: 'rgba(245,240,232,0.85)',
                }}
              >
                {body.trim() ? (
                  renderMarkdown(body)
                ) : (
                  <span style={{ color: 'rgba(245,240,232,0.35)' }}>Nothing to preview yet.</span>
                )}
              </div>
            )}

            {/* Markdown hint (left) + body counter (right), low-key under the body */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginTop: '0.9rem', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.78rem', color: 'rgba(245,240,232,0.4)', lineHeight: 1.5 }}>
                Markdown supported — bold <code style={hintCode}>**like this**</code>, italic{' '}
                <code style={hintCode}>*like this*</code>, links <code style={hintCode}>[text](url)</code>, headings <code style={hintCode}>#</code>.
              </div>
              <div style={{ fontSize: '0.72rem', color: bodyNearLimit ? '#e88' : 'rgba(245,240,232,0.3)', whiteSpace: 'nowrap' }}>
                {bodyLeft.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Publish — centred */}
          <div style={{ textAlign: 'center', marginTop: '2.75rem' }}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                background: canSubmit ? PURPLE : 'rgba(245,240,232,0.1)',
                color: canSubmit ? CREAM : 'rgba(245,240,232,0.4)',
                border: 'none',
                padding: '0.9rem 3.2rem',
                borderRadius: 9,
                fontWeight: 700,
                fontSize: '1rem',
                letterSpacing: '0.02em',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: BODY_SERIF,
                boxShadow: canSubmit ? '0 8px 28px rgba(107,47,173,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {submitting ? 'Checking your post…' : 'Publish'}
            </button>
            {submitting && (
              <div style={{ marginTop: 12, fontSize: '0.85rem', color: 'rgba(245,240,232,0.5)' }}>
                Running a quick safety check — this takes a moment.
              </div>
            )}
          </div>

          {/* Pocket eligibility — collapsed accordion, subtle, below Publish.
              Placeholder progress (all 0) until real data lands in Stage 7. */}
          <PocketEligibility open={pocketOpen} onToggle={() => setPocketOpen((v) => !v)} />
        </form>
      </div>
    </div>
  );
}

const SANS = "Cormorant Garamond, Georgia, serif";
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const hintCode = { background: 'rgba(245,240,232,0.08)', padding: '0.05em 0.35em', borderRadius: 3 };

// Segmented Write/Preview toggle.
const segWrap = {
  display: 'inline-flex',
  gap: 2,
  padding: 3,
  background: 'rgba(245,240,232,0.05)',
  borderRadius: 9,
};
function segBtn(active) {
  return {
    background: active ? PURPLE : 'transparent',
    color: active ? CREAM : 'rgba(245,240,232,0.5)',
    border: 'none',
    padding: '0.4rem 1.1rem',
    borderRadius: 7,
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: BODY_SERIF,
    transition: 'all 0.18s',
  };
}

// ---------------------------------------------------------------------------
// Deploy status pulse — a subtle, self-dismissing system-status line shown under
// the "Your post is live!" heading once a post publishes. It reflects whether the
// Cloudflare deploy hook fired (hookStatus from the moderation response), cycling
// through three stages and then fading out. Not a prominent UI element.
//   stage 1 (immediate): "Notifying the web…"            — gold, pulsing
//   stage 2 (+1.2s):     hook ok  -> "Going live…"        — gold, settled
//                        hook bad -> "Deploy queued…"     — creamFaint
//   stage 3 (+2.5s):     fade out; stage 4 unmounts.
// ---------------------------------------------------------------------------

const CREAM_FAINT = 'rgba(245,240,232,0.45)';

function DeployStatusPulse({ hookStatus }) {
  const [stage, setStage] = useState(1);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(2), 1200),
      setTimeout(() => setStage(3), 2500),
      setTimeout(() => setStage(4), 3050), // after the fade transition completes
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  if (stage >= 4) return null;

  const ok = typeof hookStatus === 'string' && hookStatus.startsWith('ok_');
  const settled = stage >= 2;
  const fading = stage === 3;

  let label;
  let color;
  if (!settled) {
    label = 'Notifying the web…';
    color = GOLD;
  } else if (ok) {
    label = 'Going live on Calvary Scribblings ✓';
    color = GOLD;
  } else {
    label = 'Deploy queued — your story will appear shortly';
    color = CREAM_FAINT;
  }

  return (
    <div
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '0.1rem 0 0.45rem',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.5s ease',
        fontFamily: CINZEL,
        fontSize: 10,
        letterSpacing: '0.15em',
        color,
      }}
    >
      <style>{`@keyframes opDeployPulse{0%,100%{opacity:0.35;transform:scale(0.8)}50%{opacity:1;transform:scale(1.25)}}`}</style>
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          animation: settled ? 'none' : 'opDeployPulse 0.9s ease-in-out infinite',
        }}
      />
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pocket eligibility strip.
//
// "Pocket" is a future creator-earnings tier. Eligibility is gated on four
// thresholds. The real progress numbers arrive in Stage 7 — for now every value
// is a placeholder 0, so the strip renders the four bars empty and never shows
// the "Pocket Ready" badge. Collapsed by default so it doesn't interrupt writing.
// ---------------------------------------------------------------------------

const POCKET_THRESHOLDS = [
  { key: 'weeks', label: 'Consistent posting', detail: '8 consecutive weeks, min. 2 posts/week — resets on a missed week', current: 0, target: 8, unit: 'weeks' },
  { key: 'followers', label: 'Verified followers', detail: 'genuine, verified accounts following you', current: 0, target: 100, unit: 'followers' },
  { key: 'comments', label: 'Received comments', detail: 'comments from others, excluding your own', current: 0, target: 200, unit: 'comments' },
  { key: 'stories', label: 'Published stories', detail: 'cleared by moderation and live on Open Pages', current: 0, target: 10, unit: 'stories' },
];

function PocketEligibility({ open, onToggle }) {
  const allMet = POCKET_THRESHOLDS.every((t) => t.current >= t.target);

  return (
    <div
      style={{
        marginTop: '2.25rem',
        border: '1px solid rgba(245,240,232,0.08)',
        borderRadius: 12,
        background: 'rgba(245,240,232,0.015)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: 'transparent',
          border: 'none',
          padding: '0.95rem 1.15rem',
          cursor: 'pointer',
          color: 'rgba(245,240,232,0.7)',
          fontFamily: CINZEL,
          fontSize: '0.72rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <IconPocket size={15} style={{ color: GOLD, opacity: 0.8 }} />
          Pocket eligibility
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {allMet ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(201,168,76,0.14)',
                border: `1px solid ${GOLD}`,
                color: GOLD,
                borderRadius: 999,
                padding: '0.2rem 0.7rem',
                fontSize: '0.64rem',
                letterSpacing: '0.12em',
              }}
            >
              <IconCheck size={12} /> Pocket Ready
            </span>
          ) : null}
          <IconChevron
            size={16}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', opacity: 0.6 }}
          />
        </span>
      </button>

      {open && (
        <div style={{ padding: '0.25rem 1.15rem 1.2rem' }}>
          <p style={{ margin: '0 0 1.1rem', fontFamily: BODY_SERIF, fontSize: '0.92rem', lineHeight: 1.6, color: 'rgba(245,240,232,0.5)' }}>
            Meet all four and you can apply to the Pocket creator tier. Progress
            updates automatically as you publish — nothing to do here yet.
          </p>
          <div style={{ display: 'grid', gap: '1.1rem' }}>
            {POCKET_THRESHOLDS.map((t) => {
              const pct = t.target > 0 ? Math.min(100, Math.round((t.current / t.target) * 100)) : 0;
              const met = t.current >= t.target;
              return (
                <div key={t.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: SERIF, fontSize: '1.05rem', fontWeight: 600, color: met ? GOLD : CREAM }}>
                        {t.label}
                      </div>
                      <div style={{ fontFamily: BODY_SERIF, fontSize: '0.8rem', color: 'rgba(245,240,232,0.4)', lineHeight: 1.45, marginTop: 1 }}>
                        {t.detail}
                      </div>
                    </div>
                    <div
                      style={{
                        flexShrink: 0,
                        fontFamily: CINZEL,
                        fontSize: '0.74rem',
                        letterSpacing: '0.04em',
                        color: met ? GOLD : 'rgba(245,240,232,0.55)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.current}/{t.target} {t.unit}
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: 'rgba(245,240,232,0.07)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        borderRadius: 999,
                        background: met ? GOLD : PURPLE,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — the platform uses inline <svg> (no icon library is
// installed). These are Lucide glyphs (MIT) inlined to match that convention.
// ---------------------------------------------------------------------------

function Icon({ size = 18, children, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {children}
    </svg>
  );
}

// Lucide "image-plus"
const IconImagePlus = (p) => (
  <Icon {...p}>
    <path d="M16 5h6" />
    <path d="M19 2v6" />
    <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    <circle cx="9" cy="9" r="2" />
  </Icon>
);

// Lucide "upload"
const IconUpload = (p) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8 12 3 7 8" />
    <path d="M12 3v12" />
  </Icon>
);

// Lucide "arrow-left" / "arrow-right"
const IconArrowLeft = (p) => (
  <Icon {...p}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Icon>
);
const IconArrowRight = (p) => (
  <Icon {...p}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);

// Lucide "wallet" — stands in for the Pocket tier.
const IconPocket = (p) => (
  <Icon {...p}>
    <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
    <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
  </Icon>
);

// Lucide "check"
const IconCheck = (p) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

// Lucide "chevron-down"
const IconChevron = (p) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
