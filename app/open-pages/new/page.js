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
// R37 — drafts. Device first, synced when signed in; never screened (a draft is not
// published, so it costs no model call and no rate-limit slot). See app/lib/openPagesDrafts.js
// for the contract the app composer reads too.
import { useOpenPagesDraft } from '../../lib/useOpenPagesDraft';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import AuthModal from '../../components/AuthModal';
import { useAuth } from '../../lib/AuthContext';
import { storage } from '../../lib/firebase';
import { OPEN_PAGE_GENRES, DEFAULT_GENRE, normalizeGenre } from '../../lib/openPages';
import { COMPOSER_NOTE, INDEX_INVITATION } from '../../lib/openPagesCopy';
// R39 — THE PRIVATE COPY OF THE MARKDOWN RENDERER IS GONE. This file carried its own
// safeHref/renderInline/renderMarkdown while /open-pages, /open-pages/[id] and the admin
// forum all imported the shared module. Two renderers means a writer's PREVIEW can differ
// from what a reader sees, which on a writing surface is the one divergence that matters.
import { renderMarkdown } from '../../lib/openPagesMarkdown';
import { ComposerRail, applyControl, RAIL_LEFT } from '../../components/ComposerRail';
import { attachDropcap } from '../../lib/dropcap';

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

// ═════════════════════════════════════════════════════════════════════════════
// THE COMPOSER'S TYPE. Written as CSS rather than inline styles because a writing
// surface needs :focus, ::placeholder and a media query, and none of the three can
// be expressed inline.
//
// ⚠ CONTRAST, MEASURED ON THE INK GROUND #080610 BEFORE THESE NUMBERS WERE CHOSEN:
//   body      rgba(245,240,232,0.85)  12.72:1  passes AA body
//   rail      rgba(245,240,232,0.45)   4.07:1  passes the 3:1 UI minimum
//   gold      #c9a84c                  8.80:1  passes AA body
//   PLACEHOLDER at the old 0.35 was 2.86:1 — IT FAILED BOTH THRESHOLDS, and it is
//   the single most-read string on an empty composer. 0.48 is the alpha at which it
//   reaches 4.5:1, and that is what it is set to. The word count and the markdown
//   hint were 0.30 (2.39:1) and are raised for the same reason.
//
// ⚠ AND THE PUBLISH BUTTON IS NO LONGER PURPLE-ON-CREAM. #6b2fad under cream text
// measures 2.52:1 — it failed, on the one control the whole page exists to reach.
// The action is now the house gold as a hairline-bordered button on ink: 8.80:1.
const COMPOSER_CSS = `
  /* ⚠ 84px OF TOP PADDING IS LOAD-BEARING, NOT TASTE. .cs-nav is position:fixed,
     68px tall, z-index 1000, with a gradient that covers whatever is beneath it.
     Playwright found this by trying to click Publish and being told
     "<nav class="cs-nav top"> intercepts pointer events" — the chrome rendered
     correctly and the one action on it was unreachable. 68 + 16 of air. */
  .op-chrome { display: flex; align-items: center; gap: 20px; max-width: 660px; margin: 0 auto; padding: 84px 24px 0; }
  .op-imprint { display: inline-flex; align-items: baseline; gap: 9px; text-decoration: none; color: rgba(245,240,232,0.72); }
  /* THE MARKS ARE PINNED TO A TEXT PRESENTATION — belt and braces, and the record of
     a false alarm worth keeping. U+2766 FLORAL HEART and U+2726 have emoji
     presentations on some platforms, and at 16px on the first screenshot this one
     LOOKED orange, so it was called an emoji. Cropping it at 6x showed a clean gold
     glyph in the house face: it was antialiasing at a small size, not a substituted
     font. The rule stays because the risk is real on other platforms even though it
     did not fire here — but it is a precaution, not a fix for an observed defect,
     and saying otherwise in a comment is how a repo ends up believing something
     untrue about itself. */
  .op-imprint-mark, .op-screen-mark, .op-outcome-mark { font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif; font-variant-emoji: text; }
  .op-imprint-mark { color: #c9a84c; font-size: 16px; line-height: 1; }
  .op-imprint-word { font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; }
  .op-state { margin-left: auto; font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(245,240,232,0.45); }
  .op-action { background: transparent; border: 1px solid rgba(201,168,76,0.55); border-radius: 999px; padding: 7px 20px; color: #c9a84c; font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; cursor: pointer; transition: background 160ms ease, color 160ms ease; }
  .op-action:hover:not(:disabled) { background: rgba(201,168,76,0.12); }
  .op-action:disabled { opacity: 0.35; cursor: not-allowed; }

  /* THE MEASURE. 660px is the reading measure the piece publishes at. position:
     relative is what the rail hangs off — it is absolutely positioned in the margin
     this creates, and never inside it. */
  .op-measure { position: relative; max-width: 660px; margin: 0 auto; padding: 52px 24px 120px; }

  .op-title { display: block; width: 100%; box-sizing: border-box; background: transparent; border: none; outline: none; padding: 0; margin: 0 0 26px; color: #f5f0e8; font-family: Cormorant Garamond, Georgia, serif; font-size: 2.9rem; font-weight: 600; line-height: 1.1; }
  .op-title::placeholder { color: rgba(245,240,232,0.48); }

  .op-body { display: block; width: 100%; box-sizing: border-box; background: transparent; border: none; outline: none; padding: 0; margin: 0; resize: none; overflow: hidden; min-height: 46vh; color: rgba(245,240,232,0.85); font-family: Cormorant Garamond, Georgia, serif; font-size: 1.22rem; line-height: 1.8; }
  .op-body::placeholder { color: rgba(245,240,232,0.48); }
  .op-empty { color: rgba(245,240,232,0.48); }

  /* THE DROP CAP, LIVE. Geometry and the on-dark gold ported from the story page;
     proseCSS itself is NOT imported — it assumes a cream ground (#1a1a1a text) and
     would set near-black type on this near-black page. R38 measured that. */
  .op-prose.has-dropcap p.dropcap-target::first-letter { font-size: 4.2em; font-weight: 600; float: left; line-height: 0.78; margin: 0.06em 0.12em 0 0; color: #c9a84c; font-family: Cormorant Garamond, Georgia, serif; }
  .op-prose.has-dropcap p.dropcap-target { text-indent: 0; }
  .op-prose p { margin: 0 0 1.05em; }

  .op-footline { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-top: 30px; padding-top: 14px; border-top: 1px solid rgba(245,240,232,0.07); }
  .op-modes { display: inline-flex; gap: 16px; }
  .op-mode { background: none; border: none; padding: 0; cursor: pointer; font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(245,240,232,0.4); }
  .op-mode.is-on { color: #c9a84c; }
  .op-count { font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(245,240,232,0.45); }
  .op-err { color: #e88; font-size: 0.85rem; margin: 10px 0 0; }
  .op-notice { margin-top: 18px; border: 1px solid rgba(232,184,123,0.4); background: rgba(232,184,123,0.08); border-radius: 10px; padding: 14px 16px; display: flex; gap: 12px; align-items: flex-start; }
  .op-notice p { margin: 0; flex: 1; line-height: 1.6; color: rgba(245,240,232,0.9); }
  .op-notice button { background: none; border: none; padding: 0; cursor: pointer; font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(245,240,232,0.5); }

  /* THE RAIL. Hidden where there is no margin to hold it — NOT overlapped, absent.
     Below 900px the measure needs the full window and a rail beside it would cross
     the words, which is the one thing it must never do. */
  @media (max-width: 900px) { .op-rail { display: none !important; } }

  /* THE SIDE PANEL. It slides from the side because a rising sheet is a phone
     gesture; on a laptop the thing that slides is the thing beside you. */
  .op-scrim { position: fixed; inset: 0; background: rgba(8,6,16,0.72); z-index: 1100; }
  .op-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(380px, 92vw); z-index: 1101; background: #0d0a18; border-left: 1px solid rgba(245,240,232,0.09); padding: 34px 30px; overflow-y: auto; display: flex; flex-direction: column; gap: 26px; animation: op-slide 260ms cubic-bezier(.22,.61,.36,1); }
  @keyframes op-slide { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  .op-panel-h { font-family: Cormorant Garamond, Georgia, serif; font-size: 1.7rem; font-weight: 600; color: #f5f0e8; margin: 0; }
  .op-field { display: flex; flex-direction: column; gap: 11px; }
  .op-label { font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(245,240,232,0.45); }
  .op-genres { display: flex; flex-wrap: wrap; gap: 7px; }
  .op-genre { background: transparent; border: 1px solid rgba(245,240,232,0.16); border-radius: 999px; padding: 6px 13px; color: rgba(245,240,232,0.6); font-family: Cormorant Garamond, Georgia, serif; font-size: 0.92rem; cursor: pointer; }
  .op-genre.is-on { border-color: rgba(201,168,76,0.6); color: #c9a84c; background: rgba(201,168,76,0.1); }
  .op-cover img { width: 100%; border-radius: 8px; display: block; margin-bottom: 9px; }
  .op-cover button, .op-coverbtn { background: transparent; border: 1px dashed rgba(245,240,232,0.22); border-radius: 8px; padding: 11px 14px; width: 100%; color: rgba(245,240,232,0.6); font-family: Cormorant Garamond, Georgia, serif; font-size: 0.92rem; cursor: pointer; }
  .op-publish { margin-top: auto; background: transparent; border: 1px solid rgba(201,168,76,0.6); border-radius: 999px; padding: 12px 24px; color: #c9a84c; font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; }
  .op-publish:hover:not(:disabled) { background: rgba(201,168,76,0.12); }
  .op-publish:disabled { opacity: 0.35; cursor: not-allowed; }
  .op-cancel { background: none; border: none; padding: 0; cursor: pointer; font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(245,240,232,0.45); }
  .op-note { margin: 0; font-family: Cormorant Garamond, Georgia, serif; font-size: 0.9rem; line-height: 1.55; color: rgba(245,240,232,0.48); }

  /* THE SCREENING MOMENT. */
  /* ⚠ ABOVE .cs-nav (z-index 1000). The screening moment is the whole point of the
     round; painting it under the navbar would have shipped silently. */
  .op-screen { position: fixed; inset: 0; z-index: 1200; background: rgba(8,6,16,0.96); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; text-align: center; padding: 24px; }
  .op-screen-mark { color: #c9a84c; font-size: 26px; line-height: 1; opacity: 0; animation: op-in 700ms ease 120ms forwards; }
  .op-screen-rule { display: block; width: 88px; height: 1px; background: #c9a84c; margin: 20px 0 24px; transform: scaleX(0); animation: op-rule 900ms cubic-bezier(.22,.61,.36,1) 320ms forwards; }
  .op-screen-h { margin: 0 0 10px; font-family: Cormorant Garamond, Georgia, serif; font-size: 1.9rem; font-weight: 500; color: #f5f0e8; opacity: 0; animation: op-in 700ms ease 560ms forwards; }
  .op-screen-p { margin: 0; max-width: 30ch; font-family: Cormorant Garamond, Georgia, serif; font-size: 1rem; line-height: 1.65; color: rgba(245,240,232,0.6); opacity: 0; animation: op-in 700ms ease 820ms forwards; }
  @keyframes op-in { to { opacity: 1; } }
  @keyframes op-rule { to { transform: scaleX(1); } }

  .op-outcome { position: fixed; inset: 0; z-index: 1300; background: rgba(8,6,16,0.97); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 24px; }
  .op-outcome-mark { color: #c9a84c; font-size: 18px; line-height: 1; }
  .op-outcome h2 { margin: 0; font-family: Cormorant Garamond, Georgia, serif; font-size: 2rem; font-weight: 500; color: #f5f0e8; }
  .op-outcome p { margin: 0; max-width: 42ch; font-family: Cormorant Garamond, Georgia, serif; font-size: 1.05rem; line-height: 1.65; color: rgba(245,240,232,0.7); }
  .op-outcome-link { color: #c9a84c; text-decoration: none; font-family: 'Cinzel', 'Cormorant Garamond', Georgia, serif; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }

  /* ⚠ REDUCE MOTION COLLAPSES THE SCREENING MOMENT TO ITS FINAL STATE. The words
     are the point; the timing is a grace note, and a grace note must not be the
     price of reading the message. */
  @media (prefers-reduced-motion: reduce) {
    .op-screen-mark, .op-screen-h, .op-screen-p { opacity: 1; animation: none; }
    .op-screen-rule { transform: scaleX(1); animation: none; }
    .op-panel { animation: none; }
  }
`;

// ⚠ THE REFUSALS ARE HONEST. "Rejected" is what a machine says; a flagged piece has
// not failed, it is WAITING FOR A PERSON, and a writer told their work was rejected
// by a machine does not come back. The rate-limit line names what happened and when
// they can write again — a silent failure on a writing surface reads as the platform
// losing the piece.
const OUTCOME_TITLES = Object.freeze({
  published: 'It is live',
  pending: 'Held for an editor',
  rejected: 'We cannot publish this one',
  rate_limited: 'Just a moment',
  error: 'That did not go through',
});

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

  // R37 — the draft. `enabled` is false while an outcome banner is showing so a
  // published piece cannot be re-saved as a draft on its way out of the composer.
  const draft = useOpenPagesDraft({
    uid: user?.uid || null,
    title, body, genre, coverImage,
    enabled: !outcome,
  });

  // Restoring a draft into the composer. The composer owns the fields, so the hook
  // hands back the record and this puts it in the boxes.
  function restoreDraft(slot) {
    const d = draft.openDraft(slot);
    if (!d) return;
    setTitle(d.title || '');
    setBody(d.body || '');
    setGenre(normalizeGenre(d.genre));
    setCoverImage(d.coverImage || null);
  }
  const [panelOpen, setPanelOpen] = useState(false);
  const previewRef = useRef(null);

  // The word count sits quiet in Cinzel — words, not characters. A writer counts in
  // words; characters are a database unit.
  const wordCount = body.trim() ? body.trim().split(/\s+/).filter(Boolean).length : 0;

  // ⭑ THE DROP CAP IS REAL WHILE YOU WRITE. The SHARED tagger, not a second copy —
  // R38 established it is ground-agnostic, and two taggers would mean the writer's
  // opening could be capped differently from the reader's.
  useEffect(() => {
    if (!preview || !previewRef.current) return;
    return attachDropcap(previewRef.current);
  }, [preview, body]);

  // The textarea grows with the writing: a scrollbar inside the measure would be a
  // box, and the surface has no boxes.
  useEffect(() => {
    const ta = bodyRef.current;
    if (!ta || preview) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [body, preview]);

  // The rail inserts MARKDOWN — never rich text. There is no sanitiser in this repo
  // and R38 recorded that; a contentEditable model here would be a security decision
  // disguised as a design one.
  function handleRailControl(control) {
    if (control.action === 'image') { imgInputRef.current && imgInputRef.current.click(); return; }
    const ta = bodyRef.current;
    if (!ta) return;
    const start = typeof ta.selectionStart === 'number' ? ta.selectionStart : body.length;
    const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : body.length;
    const next = applyControl(control, body, start, end);
    if (next.text.length > BODY_MAX) return;
    setPreview(false);
    setBody(next.text);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(next.caret, next.caret); });
  }

  // /open-pages/drafts links here with ?draft=dN. Restore once, when the hook has read
  // the device copy — before that the slot is not there to open yet.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !draft.ready) return;
    const slot = new URLSearchParams(window.location.search).get('draft');
    if (!slot) { restoredRef.current = true; return; }
    if (!draft.drafts || !draft.drafts[slot]) return;
    restoredRef.current = true;
    // Deferred by a tick so the restore runs as a callback rather than a synchronous
    // cascade out of the effect body — the same shape the hook's own loader uses.
    const id = setTimeout(() => restoreDraft(slot), 0);
    return () => clearTimeout(id);
  }, [draft.ready, draft.drafts]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setPanelOpen(false);
    setSubmitting(true);
    try {
      // The Function derives the author uid from this token; a body uid is
      // ignored, so it is no longer sent.
      const idToken = await user.getIdToken();
      const res = await fetch('/api/open-pages/moderate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), coverImage, genre }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.status === 'published') {
        // RULING 3 — THE DRAFT DIES WITH THE PUBLICATION. A kept draft and a
        // published piece diverge, and then nobody knows which is the work. The
        // published piece is the record.
        //
        // Only on `published`. A `pending` verdict below leaves the draft exactly where
        // it is — nothing was published, the composer has been cleared, and that draft
        // is now the only copy of the writing. Same for `rejected` and `rate_limited`.
        await draft.discardOnPublish();
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
            'An editor will read this before it goes up. Your piece is safe — nothing has been lost, and you will see it on Open Pages once they have.',
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
          message: data.reason || 'This one falls outside what we can publish on the island. Your writing is still in the composer — nothing has been lost.',
        });
      } else if (res.status === 429 && data.status === 'rate_limited') {
        // Not an error, and it must not read like one: the piece is still in the
        // textarea and the message says so and says when they can try again. A
        // writing surface that fails silently reads as the platform losing the work.
        setOutcome({
          kind: 'rate_limited',
          message: data.reason || 'You’ve submitted a lot in a short time. Your work is safe — please try again shortly.',
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
  // ═════════════════════════════════════════════════════════════════════════════
  // ⭑⭑ A COMPOSER IS NOT A FORM.
  // ═════════════════════════════════════════════════════════════════════════════
  // Most are a title field, a body field, a row of icons and a button — a form
  // pretending to be a page. THE WRITING SURFACE IS THE PIECE: the title set in
  // Cormorant at the size it will publish at, the body in the reading face at the
  // reading measure, on the ink ground the piece will live on, with no box and no
  // card around anything. The chrome recedes and the type is the interface.
  //
  // Everything that is not the piece has been moved out of the writing path:
  //   · the toolbar is a rail in the LEFT MARGIN, never crossing the measure
  //   · the cover and the genre are not here at all — you write first and FILE IT
  //     AFTER, in a side panel met at publish. Keeping them out is what lets the
  //     page stay a page.
  //   · the chrome is three things on one line: the imprint, the draft state, one
  //     gold action.
  //
  // ⚠ WHAT THIS ROUND DID NOT TOUCH, and must not: R37's drafts (500ms local, 10s
  // remote with a 60s floor, twenty slots, fork-never-overwrite), R36's limiter,
  // and R35's rule that publishing goes through the Function and never to the node.
  // The redesign made none of them awkward — the hook takes the same four values it
  // always did, and the publish path is byte-identical.
  return (
    <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
      <Navbar />
      <style>{COMPOSER_CSS}</style>

      {/* ── THE CHROME. Three things, one line. ────────────────────────────────
          The imprint mark, the draft state, one gold action. Nothing else — no
          back link competing with the mark, no preview toggle competing with the
          action. Preview lives on the rail's own line beneath, where it belongs
          with the other things that act on the text. */}
      <header className="op-chrome">
        <Link href="/open-pages" className="op-imprint" aria-label="Open Pages">
          <span className="op-imprint-mark" aria-hidden="true">{'\u2766\uFE0E'}</span>
          <span className="op-imprint-word">Open Pages</span>
        </Link>

        <span className="op-state" data-draft-status>
          {draft.status === 'saving' ? 'Saving'
            : draft.status === 'local-only' ? 'Saved on this device'
            : draft.status === 'saved' ? 'Draft saved'
            : 'Drafts on'}
        </span>

        <button
          type="button"
          className="op-action"
          onClick={() => setPanelOpen(true)}
          disabled={!canSubmit}
          data-publish-open
        >
          Publish
        </button>
      </header>

      {/* ── THE MEASURE. ~660px, centred — the measure the piece publishes at.
             A composer is not full-width because a piece is not. ─────────────── */}
      <main className="op-measure">
        {/* The rail sits in the left margin, absolutely positioned, and is hidden
            below the width at which a margin exists. It NEVER crosses the measure —
            asserted at three widths in tests/openpages/composer.test.mjs. */}
        <ComposerRail
          className="op-rail"
          style={{ position: 'absolute', left: RAIL_LEFT, top: 4 }}
          onControl={handleRailControl}
          disabled={submitting}
          imageBusy={imgUploading}
        />

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
          maxLength={TITLE_MAX}
          placeholder="Title"
          aria-label="Title"
          disabled={submitting}
          className="op-title"
        />

        {!preview ? (
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
            maxLength={BODY_MAX}
            placeholder="Begin writing…"
            aria-label="Your piece"
            disabled={submitting}
            className="op-body"
          />
        ) : (
          /* ⭑ THE DROP CAP IS REAL WHILE YOU WRITE. The ground is the same ink the
             piece publishes on, so a writer sees their own opening set the way a
             reader will. The TAGGER is the shared one — R38 established it is
             ground-agnostic — and the CSS is the geometry and the on-dark gold,
             never proseCSS's cream-assuming colours. */
          <div ref={previewRef} className="op-body op-prose has-dropcap" data-composer-preview>
            {body.trim() ? renderMarkdown(body) : <span className="op-empty">Nothing to preview yet.</span>}
          </div>
        )}

        {/* ── The quiet line: write/preview, and the word count in Cinzel. ───── */}
        <div className="op-footline">
          <div className="op-modes">
            <button type="button" onClick={() => setPreview(false)} className={`op-mode${!preview ? ' is-on' : ''}`} aria-pressed={!preview}>Write</button>
            <button type="button" onClick={() => setPreview(true)} className={`op-mode${preview ? ' is-on' : ''}`} aria-pressed={preview}>Preview</button>
          </div>
          <span className="op-count">{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
        </div>

        {imgError ? <p className="op-err" role="alert">{imgError}</p> : null}

        {draft.notice ? (
          <div role="status" data-draft-notice className="op-notice">
            <p>{draft.notice.message}</p>
            <button type="button" onClick={draft.dismissNotice}>Dismiss</button>
          </div>
        ) : null}
      </main>

      <input ref={imgInputRef} type="file" accept={ACCEPT_ATTR} onChange={handleInlineSelect} style={{ display: 'none' }} />
      <input ref={coverInputRef} type="file" accept={ACCEPT_ATTR} onChange={handleCoverSelect} style={{ display: 'none' }} />

      {/* ── ⭑ FILE IT AFTER. The cover and the genre are met at publish, in a side
             panel. A rising sheet is a phone gesture; on a laptop the thing that
             slides is the thing beside you. ─────────────────────────────────── */}
      {panelOpen ? (
        <>
          <div className="op-scrim" onClick={() => setPanelOpen(false)} aria-hidden="true" />
          <aside className="op-panel" role="dialog" aria-modal="true" aria-label="Publish" data-publish-panel>
            <h2 className="op-panel-h">Before it goes</h2>

            <div className="op-field">
              <span className="op-label">Genre</span>
              <div className="op-genres">
                {OPEN_PAGE_GENRES.map((g) => (
                  <button key={g} type="button" onClick={() => setGenre(g)} aria-pressed={genre === g}
                    className={`op-genre${genre === g ? ' is-on' : ''}`}>{g}</button>
                ))}
              </div>
            </div>

            <div className="op-field">
              <span className="op-label">Cover</span>
              {coverImage ? (
                <div className="op-cover">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverImage} alt="" />
                  <button type="button" onClick={handleRemoveCover}>Remove</button>
                </div>
              ) : (
                <button type="button" className="op-coverbtn" onClick={() => coverInputRef.current && coverInputRef.current.click()} disabled={coverUploading}>
                  {coverUploading ? 'Uploading…' : 'Choose an image'}
                </button>
              )}
              {coverError ? <p className="op-err">{coverError}</p> : null}
            </div>

            <button type="button" className="op-publish" onClick={handleSubmit} disabled={!canSubmit || submitting} data-publish-confirm>
              {submitting ? 'Sending…' : 'Publish'}
            </button>
            <button type="button" className="op-cancel" onClick={() => setPanelOpen(false)}>Keep writing</button>

            {/* ⭑ R38's approved copy, at the panel's foot — the last thing read
                before the piece goes. Attention, not outcome. */}
            {/* ⭑ R40 — THE COMMISSIONING SENTENCE LIVES HERE NOW. It was the feed's
                second standfirst line; Ikenna's ruling moved it to the composer, where
                a writer is about to act and will read it once, rather than the feed,
                where a weekly reader would meet it until it became wallpaper. */}
            <p className="op-note" data-op-composer-note>
              {COMPOSER_NOTE}
              <br />
              <span data-op-commissioning>{INDEX_INVITATION.line2}</span>
            </p>
          </aside>
        </>
      ) : null}

      {/* ── ⭑⭑ THE SCREENING MOMENT. ────────────────────────────────────────────
             Publishing sends the piece to Haiku, which is a wait, and the default
             answer to a wait is a spinner. A spinner says "the system is busy". This
             says what is actually happening, which is the entire commissioning
             argument made literal: the house reads everything. It is the one moment
             a writer can FEEL that is true, so it gets the ❦, a hairline, and two
             lines of type rather than a rotating arc.
             ⚠ Reduce Motion collapses it to its final state — see COMPOSER_CSS. */}
      {submitting ? (
        <div className="op-screen" role="status" aria-live="polite" data-screening>
          <span className="op-screen-mark" aria-hidden="true">{'\u2766\uFE0E'}</span>
          <span className="op-screen-rule" aria-hidden="true" />
          <p className="op-screen-h">Reading your piece</p>
          <p className="op-screen-p">Every piece published on the island is read before it lands.</p>
        </div>
      ) : null}

      {/* ── The outcome. ⚠ A FLAGGED PIECE IS HELD FOR AN EDITOR, NEVER "REJECTED":
             it has not failed, it is waiting for a person, and a writer told their
             work was rejected by a machine will not come back. And a rate-limit
             refusal says what happened and when they can write again, because a
             silent failure on a writing surface reads as the platform losing the
             piece. ─────────────────────────────────────────────────────────────── */}
      {outcome ? (
        <div className="op-outcome" role="status" data-outcome={outcome.kind}>
          <span className="op-outcome-mark" aria-hidden="true">{'\u2726\uFE0E'}</span>
          <h2>{OUTCOME_TITLES[outcome.kind] || 'Hmm'}</h2>
          <p>{outcome.message}</p>
          {outcome.link ? <Link href={outcome.link} className="op-outcome-link">Read it on Open Pages</Link> : null}
          <button type="button" onClick={() => setOutcome(null)} className="op-cancel">Close</button>
        </div>
      ) : null}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
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
    label = 'Going live on Calvary Scribblings';
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
