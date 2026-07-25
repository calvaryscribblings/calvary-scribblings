'use client';
// Drop cap targeting — shared by the story page and the offline shelf reader.
//
// ── PROVENANCE ───────────────────────────────────────────────────────────────────────────
// This is a VERBATIM MOVE out of app/stories/[slug]/page-client.js, not a rewrite. Every
// regex, predicate, threshold and comment below is byte-identical to what shipped there;
// the only thing that changed is where the closure boundary falls — `article` arrives as a
// parameter instead of being read from a ref, and the effect's return value became this
// function's return value. Nothing was improved, tidied, renamed or "obviously" fixed while
// it was in transit, deliberately: the decorated-opener behaviour on the story page is
// verified, and a move that also edits is a move whose verification is worthless.
//
// The shelf reader renders the same prose HTML into the same .prose.has-dropcap container,
// so it needs the same tagger. Importing it is the only way the two cannot drift.
//
// ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────────
// The CSS ::first-letter rule can't tell front-matter (content notes, epigraphs,
// dedications) from the story proper, so we tag the first real paragraph with
// .dropcap-target and let the CSS hook that. Selects paragraphs with querySelectorAll
// scoped to the prose container (so a story whose opening <p> is nested in a wrapper div is
// still found), and keeps a MutationObserver on the article: if React ever re-applies the
// body HTML (which would wipe the class) or the content arrives after the first pass, it
// re-tags. Idempotent — clears prior tags before each pass.

const FRONTMATTER_RE = /^(content note|content warning|cw|trigger warning|tw|author's note|note|dedication|epigraph)[:\s—–-]/i;
// A line that ends on sentence-ending punctuation reads as prose, not a bare
// label — closing quotes after the terminal mark still count as terminated.
const TERMINATED_RE = /[.!?…]['"”’]*$/;

const isEntirelyItalic = (p) => {
  const t = (p.textContent || '').trim();
  if (!t) return false;
  const kids = Array.from(p.children);
  return kids.length === 1
    && (kids[0].tagName === 'EM' || kids[0].tagName === 'I')
    && (kids[0].textContent || '').trim().length >= t.length * 0.9;
};

const isFrontmatter = (p, next) => {
  const t = (p.textContent || '').trim();
  if (!t) return false;
  if (FRONTMATTER_RE.test(t)) return true;
  if (isEntirelyItalic(p)) return true;
  if (t.length < 40 && !TERMINATED_RE.test(t) && next && (next.textContent || '').trim().length > t.length) return true;
  return false;
};

// One tagging pass over an article element. Exported for callers that render prose once
// and know it will not change; most callers want attachDropcap instead.
export function tagDropcap(article) {
  if (!article) return;
  const container = article.querySelector('.prose.has-dropcap');
  if (!container) return; // poetry (no has-dropcap) or body not in the DOM yet
  const paras = Array.from(container.querySelectorAll('p'))
    .filter((p) => (p.textContent || '').trim().length > 0);
  if (!paras.length) return;
  // Clear any tags from a prior pass so re-runs converge on the same state.
  paras.forEach((p) => p.classList.remove('dropcap-target', 'story-frontmatter'));
  const frontmatter = [];
  let target = null;
  for (let i = 0; i < paras.length; i++) {
    if (isFrontmatter(paras[i], paras[i + 1] || null)) { frontmatter.push(paras[i]); continue; }
    target = paras[i];
    break;
  }
  if (!target) target = paras[0]; // safety: everything looked like front-matter
  frontmatter.forEach((p) => { if (p !== target) p.classList.add('story-frontmatter'); });
  target.classList.add('dropcap-target');
}

// Tag now, and keep tagging if the body is replaced. Returns the cleanup function an
// effect should return.
export function attachDropcap(article) {
  if (!article) return undefined;
  const tag = () => tagDropcap(article);

  tag();
  // Adding a class is an attribute mutation, not childList, so re-tagging here
  // never retriggers the observer — no loop.
  let obs;
  if (typeof MutationObserver !== 'undefined') {
    obs = new MutationObserver(() => tag());
    obs.observe(article, { childList: true, subtree: true });
  }
  return () => { if (obs) obs.disconnect(); };
}
