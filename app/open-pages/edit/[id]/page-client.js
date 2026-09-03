'use client';

// Open Pages — edit composer (client half). /open-pages/edit/[id]
//
// Mirrors the create composer (app/open-pages/new/page.js): same cinematic dark
// aesthetic, same Markdown textarea + preview, same cover/inline image upload, and
// the SAME moderation gate — on save we re-run /api/open-pages/moderate over the
// edited content. The difference from create:
//   • The form is PRE-FILLED from the existing open_pages/{id} post.
//   • Only the original author may edit (ownership gate below).
//   • On a passing moderation result the ENDPOINT updates the existing node in
//     place (adding an updatedAt timestamp) rather than publishing a brand-new post.
//
// Note on the moderation endpoint: it takes an optional `postId`, which puts it in
// EDIT mode — it verifies from the STORED record that the caller's verified uid is
// the author, re-screens, and on a pass writes the edited body and the fresh verdict
// into the original id in one atomic PATCH with service credentials. This page no
// longer writes to the database at all.
//
// It used to. The endpoint was create-only, so this page used it as an oracle: on a
// "published" verdict it deleted the throwaway post the endpoint had just made and
// then patched open_pages/{id} directly — with no moderation field. The record kept
// the verdict its original body had earned. The rules permitted that write (the
// author held .write on their own published post), so the re-screening was a
// property of THIS CLIENT rather than of the platform: anything holding the author's
// token could rewrite a screened piece and leave the old "pass" underneath it.
// R35 closed the rule and moved the write.

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import AuthModal from '../../../components/AuthModal';
import { useAuth } from '../../../lib/AuthContext';
import { db, storage } from '../../../lib/firebase';
import {
  OPEN_PAGES_NODE,
  OPEN_PAGE_GENRES,
  DEFAULT_GENRE,
  normalizeGenre,
} from '../../../lib/openPages';

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
// download URL — same storage path/pattern as the create composer.
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
const SANS = "Cormorant Garamond, Georgia, serif";
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

// ---------------------------------------------------------------------------
// Tiny, escape-safe Markdown → React renderer (preview only) — identical to the
// create composer so the preview matches exactly. Everything is built as React
// elements (React escapes all text); link/image hrefs are scheme-sanitised.
// ---------------------------------------------------------------------------

function safeHref(url) {
  const u = (url || '').trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || u.startsWith('/')) return u;
  return null;
}

function renderInline(text, keyPrefix) {
  const nodes = [];
  let k = 0;
  const re =
    /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let m;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      const src = safeHref(m[3]);
      if (src) {
        nodes.push(
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${keyPrefix}-img-${k++}`}
            src={src}
            alt={m[2] || ''}
            style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, display: 'block', margin: '0.6rem 0' }}
          />
        );
      } else {
        nodes.push(m[2] || '');
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
        nodes.push(m[5]);
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

export default function EditPageClient({ params }) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();

  // Loaded post: undefined = loading, null = not found, object = found.
  const [post, setPost] = useState(undefined);

  // Form state (pre-filled once the post loads).
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [genre, setGenre] = useState(DEFAULT_GENRE);
  const [coverImage, setCoverImage] = useState(null);
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState('');
  const [imgUploading, setImgUploading] = useState(false);
  const [imgError, setImgError] = useState('');

  // outcome: { kind: 'pending'|'rejected'|'error', message }
  const [outcome, setOutcome] = useState(null);

  const coverInputRef = useRef(null);
  const imgInputRef = useRef(null);
  const bodyRef = useRef(null);
  const prefilled = useRef(false);

  // Fetch the existing post once and pre-fill the form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `${OPEN_PAGES_NODE}/${id}`));
        if (cancelled) return;
        const val = snap.exists() ? snap.val() : null;
        const found = val ? { id, ...val } : null;
        setPost(found);
        if (found && !prefilled.current) {
          prefilled.current = true;
          setTitle(found.title || '');
          setBody(found.body || '');
          setGenre(normalizeGenre(found.genre));
          setCoverImage(found.coverImage || null);
        }
      } catch (e) {
        console.error('[open-pages] edit load failed:', e);
        if (!cancelled) setPost(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

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
    if (!user || !canSubmit || !post) return;
    setOutcome(null);
    setSubmitting(true);
    try {
      // Re-run moderation over the edited content (same gate as a new post).
      // The Function derives the author uid from this token; a body uid is
      // ignored, so it is no longer sent.
      const idToken = await user.getIdToken();
      const res = await fetch('/api/open-pages/moderate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        // `postId` puts the endpoint in EDIT mode: it re-screens, checks from the
        // STORED record that the verified uid is the author, and — only on a pass —
        // writes the new body and the fresh verdict together, with service
        // credentials.
        body: JSON.stringify({ title: title.trim(), body: body.trim(), coverImage, genre, postId: id }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.status === 'published') {
        // Nothing to write here any more — the post is already saved by the time we
        // get here. This branch used to delete a throwaway post the endpoint had
        // just published and then patch open_pages/{id} itself: title, body, genre,
        // coverImage, updatedAt, and NO moderation field, so the record kept the
        // verdict its ORIGINAL body had earned. R35 moved that write server-side and
        // the rules now refuse it from a client.
        router.push(`/open-pages/${id}`);
        return; // keep the spinner until navigation completes
      } else if (res.ok && data.status === 'pending') {
        setOutcome({
          kind: 'pending',
          message:
            'Thanks — your changes need a quick human review before they go live. Your published story stays as it is until they clear.',
        });
      } else if (res.ok && data.status === 'rejected') {
        setOutcome({
          kind: 'rejected',
          message: data.reason || 'These changes can’t be published because they appear to violate our community guidelines. Your published story is unchanged.',
        });
      } else {
        setOutcome({ kind: 'error', message: data.error || 'Something went wrong, please try again.' });
      }
    } catch {
      setOutcome({ kind: 'error', message: 'Something went wrong, please try again.' });
    }
    setSubmitting(false);
  }

  // ---- Loading (auth or post) ----
  if (loading || post === undefined) {
    return (
      <Shell>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '60px 24px' }}>
          <div style={{ width: '100%', height: 200, borderRadius: 12, background: 'rgba(245,240,232,0.04)', marginBottom: 26 }} />
          <div style={{ width: '60%', height: 34, borderRadius: 8, background: 'rgba(245,240,232,0.06)', marginBottom: 16 }} />
          <div style={{ width: '100%', height: 14, borderRadius: 6, background: 'rgba(245,240,232,0.04)' }} />
        </div>
      </Shell>
    );
  }

  // ---- Auth gate (same pattern as the create composer: AuthModal) ----
  if (!user) {
    return (
      <Shell>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '5rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: GOLD, opacity: 0.75, marginBottom: 16 }}>
            Open Pages
          </div>
          <div style={{ fontFamily: SERIF, fontSize: '2.4rem', fontWeight: 500, color: CREAM, marginBottom: '0.9rem', lineHeight: 1.1 }}>
            Sign in to edit
          </div>
          <p style={{ fontSize: '1.15rem', lineHeight: 1.7, color: 'rgba(245,240,232,0.7)', marginBottom: '2rem' }}>
            You need to be signed in as the author to edit this story.
          </p>
          <button
            onClick={() => setShowAuth(true)}
            style={{ background: PURPLE, color: CREAM, border: 'none', padding: '0.9rem 3rem', borderRadius: 9, fontWeight: 700, fontSize: '1rem', cursor: 'pointer', fontFamily: BODY_SERIF, boxShadow: '0 8px 28px rgba(107,47,173,0.35)' }}
          >
            Sign in
          </button>
          <div style={{ marginTop: '1.5rem' }}>
            <a href={`/open-pages/${id}`} style={backLink}>
              <IconArrowLeft size={15} /> Back to the story
            </a>
          </div>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </Shell>
    );
  }

  // ---- Not found ----
  if (post === null) {
    return (
      <Shell>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '6rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontFamily: SERIF, fontSize: '4rem', color: GOLD, opacity: 0.6, lineHeight: 1 }}>404</div>
          <div style={{ fontFamily: SERIF, fontSize: '1.9rem', color: CREAM, margin: '0.6rem 0 0.8rem' }}>
            This story isn’t here.
          </div>
          <p style={{ fontSize: '1.1rem', color: 'rgba(245,240,232,0.55)', marginBottom: '2rem' }}>
            It may have been removed, or the link is wrong.
          </p>
          <a href="/open-pages" style={backLink}>
            <IconArrowLeft size={16} /> Back to Open Pages
          </a>
        </div>
      </Shell>
    );
  }

  // ---- Ownership gate ----
  if (user.uid !== post.authorUid) {
    return (
      <Shell>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '6rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontFamily: SERIF, fontSize: '1.9rem', color: CREAM, margin: '0 0 0.8rem' }}>
            You don’t have permission to edit this story.
          </div>
          <p style={{ fontSize: '1.1rem', color: 'rgba(245,240,232,0.55)', marginBottom: '2rem' }}>
            Only the original author can make changes.
          </p>
          <a href={`/open-pages/${id}`} style={backLink}>
            <IconArrowLeft size={16} /> Back to the story
          </a>
        </div>
      </Shell>
    );
  }

  // ---- Authorised editor ----
  return (
    <Shell>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '60px 24px 96px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.75rem' }}>
          <div style={{ marginBottom: 18 }}>
            <a href={`/open-pages/${id}`} style={backLink}>
              <IconArrowLeft size={15} /> Back to the story
            </a>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: GOLD, opacity: 0.75, marginBottom: 16 }}>
            Open Pages
          </div>
          <h1 style={{ fontFamily: SERIF, fontSize: '2.5rem', fontWeight: 500, color: CREAM, margin: 0, lineHeight: 1.1 }}>
            Edit your story
          </h1>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '1.18rem', color: 'rgba(245,240,232,0.55)', marginTop: 14, marginBottom: 0 }}>
            Your changes are re-checked before they go live.
          </p>
        </div>

        {/* Outcome banner (pending / rejected / error — success navigates away) */}
        {outcome && (
          <div
            role="status"
            style={{
              border: `1px solid ${outcome.kind === 'pending' ? 'rgba(107,47,173,0.55)' : 'rgba(220,90,90,0.5)'}`,
              background: outcome.kind === 'pending' ? 'rgba(107,47,173,0.1)' : 'rgba(220,90,90,0.08)',
              borderRadius: 10,
              padding: '1rem 1.2rem',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.2rem', color: outcome.kind === 'pending' ? GOLD : '#e88', marginBottom: '0.25rem' }}>
              {outcome.kind === 'pending' && 'Under review'}
              {outcome.kind === 'rejected' && 'Couldn’t save these changes'}
              {outcome.kind === 'error' && 'Hmm — that didn’t work'}
            </div>
            <p style={{ margin: 0, lineHeight: 1.6, color: 'rgba(245,240,232,0.9)' }}>{outcome.message}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Hidden file inputs */}
          <input ref={coverInputRef} type="file" accept={ACCEPT_ATTR} style={{ display: 'none' }} onChange={handleCoverSelect} />
          <input ref={imgInputRef} type="file" accept={ACCEPT_ATTR} style={{ display: 'none' }} onChange={handleInlineSelect} />

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
                  style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(8,6,16,0.8)', color: CREAM, border: '1px solid rgba(245,240,232,0.3)', borderRadius: 6, padding: '0.35rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: BODY_SERIF }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current && coverInputRef.current.click()}
                disabled={coverUploading || submitting}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: '1px dashed rgba(201,168,76,0.3)', background: 'rgba(201,168,76,0.02)', borderRadius: 12, padding: '1.6rem', color: coverUploading ? 'rgba(245,240,232,0.45)' : 'rgba(245,240,232,0.7)', fontSize: '0.98rem', fontFamily: BODY_SERIF, cursor: coverUploading || submitting ? 'not-allowed' : 'pointer' }}
              >
                <IconUpload size={18} style={{ color: GOLD, opacity: 0.85 }} />
                {coverUploading ? 'Uploading cover…' : 'Add a cover image'}
              </button>
            )}
            {coverError && <div style={{ color: '#e88', fontSize: '0.82rem', marginTop: '0.5rem' }}>{coverError}</div>}
          </div>

          {/* Title */}
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
              style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderBottom: '0.5px solid rgba(245,240,232,0.12)', borderRadius: 0, padding: '0.4rem 0', color: CREAM, fontSize: '1.85rem', fontWeight: 500, fontFamily: SERIF, outline: 'none' }}
            />
          </div>

          {/* Genre picker */}
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
                    style={{ background: active ? PURPLE : 'rgba(245,240,232,0.04)', color: active ? CREAM : 'rgba(245,240,232,0.6)', border: `1px solid ${active ? PURPLE : 'rgba(245,240,232,0.14)'}`, borderRadius: 999, padding: '0.4rem 1rem', fontFamily: CINZEL, fontSize: '0.74rem', letterSpacing: '0.06em', fontWeight: active ? 600 : 500, cursor: submitting ? 'not-allowed' : 'pointer', transition: 'all 0.18s' }}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div>
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
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', border: '1px solid rgba(245,240,232,0.15)', borderRadius: 7, padding: '0.4rem 0.85rem', color: 'rgba(245,240,232,0.7)', fontSize: '0.8rem', fontWeight: 600, fontFamily: BODY_SERIF, opacity: imgUploading || inlineCapReached ? 0.45 : 1, cursor: imgUploading || submitting || inlineCapReached ? 'not-allowed' : 'pointer' }}
                >
                  <IconImagePlus size={15} />
                  {imgUploading ? 'Uploading…' : 'Insert image'}
                </button>
              </div>
            </div>
            {imgError && <div style={{ color: '#e88', fontSize: '0.82rem', marginBottom: '0.6rem' }}>{imgError}</div>}

            {!preview ? (
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                maxLength={BODY_MAX}
                placeholder="Begin writing…"
                disabled={submitting}
                rows={16}
                style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderRadius: 0, padding: 0, color: 'rgba(245,240,232,0.85)', fontSize: '1.18rem', lineHeight: 1.75, fontFamily: BODY_SERIF, outline: 'none', resize: 'vertical', minHeight: 340 }}
              />
            ) : (
              <div style={{ width: '100%', boxSizing: 'border-box', minHeight: 340, fontSize: '1.18rem', lineHeight: 1.75, color: 'rgba(245,240,232,0.85)' }}>
                {body.trim() ? renderMarkdown(body) : <span style={{ color: 'rgba(245,240,232,0.35)' }}>Nothing to preview yet.</span>}
              </div>
            )}

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

          {/* Save — centred */}
          <div style={{ textAlign: 'center', marginTop: '2.75rem' }}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{ background: canSubmit ? PURPLE : 'rgba(245,240,232,0.1)', color: canSubmit ? CREAM : 'rgba(245,240,232,0.4)', border: 'none', padding: '0.9rem 3.2rem', borderRadius: 9, fontWeight: 700, fontSize: '1rem', letterSpacing: '0.02em', cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: BODY_SERIF, boxShadow: canSubmit ? '0 8px 28px rgba(107,47,173,0.35)' : 'none', transition: 'all 0.2s' }}
            >
              {submitting ? 'Checking your changes…' : 'Save changes'}
            </button>
            {submitting && (
              <div style={{ marginTop: 12, fontSize: '0.85rem', color: 'rgba(245,240,232,0.5)' }}>
                Running a quick safety check — this takes a moment.
              </div>
            )}
          </div>
        </form>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell + shared styles + icons.
// ---------------------------------------------------------------------------

function Shell({ children }) {
  return (
    <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
      <Navbar />
      {children}
    </div>
  );
}

const backLink = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  color: 'rgba(245,240,232,0.55)',
  textDecoration: 'none',
  fontFamily: CINZEL,
  fontSize: '0.72rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const hintCode = { background: 'rgba(245,240,232,0.08)', padding: '0.05em 0.35em', borderRadius: 3 };

const segWrap = { display: 'inline-flex', gap: 2, padding: 3, background: 'rgba(245,240,232,0.05)', borderRadius: 9 };
function segBtn(active) {
  return { background: active ? PURPLE : 'transparent', color: active ? CREAM : 'rgba(245,240,232,0.5)', border: 'none', padding: '0.4rem 1.1rem', borderRadius: 7, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: BODY_SERIF, transition: 'all 0.18s' };
}

function Icon({ size = 18, children, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flexShrink: 0, ...style }}>
      {children}
    </svg>
  );
}
const IconImagePlus = (p) => (
  <Icon {...p}>
    <path d="M16 5h6" />
    <path d="M19 2v6" />
    <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    <circle cx="9" cy="9" r="2" />
  </Icon>
);
const IconUpload = (p) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8 12 3 7 8" />
    <path d="M12 3v12" />
  </Icon>
);
const IconArrowLeft = (p) => (
  <Icon {...p}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Icon>
);
