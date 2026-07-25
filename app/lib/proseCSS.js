'use client';
// THE PROSE STYLESHEET — shared by the story page and the offline shelf reader.
//
// ── PROVENANCE ───────────────────────────────────────────────────────────────────────────
// A VERBATIM EXTRACTION from app/stories/[slug]/page-client.js. Every declaration below is
// byte-identical to the block that shipped there, in the same order, so the cascade
// resolves exactly as it did before. Nothing was consolidated, reordered, modernised or
// de-duplicated in transit — the story page's typography is verified, and an extraction
// that also edits is an extraction whose verification is void.
//
// The one thing that had to change is mechanical: these rules interpolate the story
// page's ${accentColor}, so the block is a function of that colour instead of a bare
// string. Callers pass their own accent and get the identical CSS.
//
// ── WHY A MODULE AND NOT A COPY ──────────────────────────────────────────────────────────
// The shelf reader renders the same CMS prose HTML into the same .prose container. Two
// copies of ~47 typographic rules WILL drift — someone fixes a blockquote on the story
// page and a reader offline gets the old one, with nothing to catch it. Importing is the
// only arrangement in which drift is impossible.
//
// Note what is NOT here: .story-body-wrap, the proseEnter keyframes, .story-body,
// .back-link-row and the hero/nav rules all stay on the story page. This module is the
// typography of the words themselves — the part both readers genuinely share — and
// deliberately not the page furniture around them, which the two surfaces do not share.
export function proseCSS(accentColor = '#6b46c1') {
  return `
        .prose { font-size: 1.15rem; line-height: 1.85; color: #1a1a1a; font-family: Cormorant Garamond, Georgia, serif; font-weight: 400; }
        .prose em, .prose i { font-family: Cormorant Garamond, Georgia, serif; font-style: italic; }
        .prose p { margin-bottom: 0; } .prose:not(.is-verse) p + p { text-indent: 1.5em; }
        .prose.has-dropcap p.dropcap-target::first-letter { font-size: 4.2em; font-weight: 600; float: left; line-height: 0.78; margin: 0.06em 0.12em 0 0; color: #c9a84c; font-family: Cormorant Garamond, Georgia, serif; }
        .prose.has-dropcap p.dropcap-target { text-indent: 0; }
        .prose.has-dropcap p.story-frontmatter { font-style: italic; font-size: 0.85em; color: rgba(26,26,26,0.55); margin-bottom: 1.5em; }
        .prose h2 { font-size: 1.45rem; font-weight: 700; color: #1a1a1a; margin: 2.2em 0 0.7em; font-family: Cormorant Garamond, Georgia, serif; line-height: 1.3; }
        .prose h3 { font-size: 1.15rem; font-style: italic; color: ${accentColor}; margin: 2em 0 0.5em; font-weight: 400; font-family: Cormorant Garamond, Georgia, serif; }
        .prose p[style*='text-align:center'], .prose p[style*='text-align: center'] { text-align: center; font-family: Cormorant Garamond, Georgia, serif; letter-spacing: 0.3em; color: rgba(26,26,26,0.4); margin: 2.5em auto; font-size: 0.9rem; }
        .prose h4 { font-size: 1rem; font-weight: 700; color: #1a1a1a; margin: 1.5em 0 0.4em; font-family: Cormorant Garamond, Georgia, serif; }
        .prose img { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 4px; margin: 2em 0 0.5em; min-height: 200px; background: #e8e0d4; }
.prose img.loaded { min-height: unset; background: none; }
        .prose .article-image { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 8px; margin: 2em 0 0.5em; }
        .prose figure { margin: 2em 0; }
        .prose figcaption { font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: 0.5em; font-family: Cormorant Garamond, Georgia, serif; }
        .prose img + em { display: block; font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: -1em; margin-bottom: 2em; font-family: Cormorant Garamond, Georgia, serif; }
        .prose .image-caption { display: block; font-size: 0.85rem; color: #888; font-style: italic; text-align: center; margin-top: 0.5em; margin-bottom: 2em; font-family: Cormorant Garamond, Georgia, serif; }
        .prose .inline-image-caption { display: block; font-size: 0.82rem; color: #888; font-style: italic; text-align: right; margin-top: 0.4em; margin-bottom: 2em; font-family: Cormorant Garamond, Georgia, serif; }
        .prose .features-list { background: #e8e0f5; border-left: 4px solid ${accentColor}; border-radius: 0 8px 8px 0; padding: 1.25rem 1.5rem; margin: 1.5em 0 2em; }
        .prose .features-list ul { background: transparent; border: none; padding: 0; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
        .prose .features-list ul li { padding-left: 1.2rem; position: relative; font-size: 1.05rem; line-height: 1.6; color: #1a1a1a; }
        .prose .features-list ul li::before { content: '•'; position: absolute; left: 0; color: ${accentColor}; font-weight: 700; }
        .prose blockquote { margin: 2.2em 0; padding: 1.2em 1.6em; border-left: 4px solid ${accentColor}; background: rgba(107,70,193,0.07); font-size: 1.1rem; font-style: italic; color: ${accentColor}; line-height: 1.7; border-radius: 0 4px 4px 0; font-family: Cormorant Garamond, Georgia, serif; }
        .prose blockquote p { margin-bottom: 0; color: ${accentColor}; font-family: Cormorant Garamond, Georgia, serif; }
        .prose ul { margin: 1.8em 0; padding: 1.2em 1.5em 1.2em 2em; background: #ede6f5; border-left: 4px solid ${accentColor}; border-radius: 0 4px 4px 0; list-style: disc; }
        .prose ul li { margin-bottom: 0.55em; color: #1a1a1a; font-size: 1.05rem; line-height: 1.75; }
        .prose ul li::marker { color: ${accentColor}; }
        .prose ol { margin: 1.5em 0; padding-left: 1.8em; }
        .prose ol li { margin-bottom: 0.5em; color: #1a1a1a; }
        .prose hr { border: none; height: 2px; background: linear-gradient(90deg, transparent, ${accentColor}, transparent); width: 100px; margin: 3em auto; display: block; }
        .prose em { font-style: italic; color: inherit; font-family: Cormorant Garamond, Georgia, serif; }
        .prose i { font-style: italic; color: inherit; font-family: Cormorant Garamond, Georgia, serif; }
        .prose strong { font-weight: 700; color: #1a1a1a; }
        .prose .poem-collection-intro { font-style: italic; font-family: Cormorant Garamond, Georgia, serif; color: #555; margin-bottom: 1.5em; display: block; font-size: 1.1rem; }
        .prose .section-break { text-align: center; font-family: Cormorant Garamond, Georgia, serif; letter-spacing: 0.3em; color: rgba(26,26,26,0.4); margin: 2.5em auto; font-size: 0.9rem; }
        .prose .poem-numeral { text-align: center; font-family: Cormorant Garamond, Georgia, serif; letter-spacing: 0.3em; color: ${accentColor}; margin: 2.5em auto 1em; font-size: 1.05rem; }
        .prose .intro-note { font-style: italic; font-family: Cormorant Garamond, Georgia, serif; color: ${accentColor}; display: block; font-size: 1.1rem; margin-bottom: 1.5em; }
        .prose .poem-contents { border-left: 4px solid ${accentColor}; padding: 0.8em 1.2em; margin: 1.5em 0; background: #ede6f5; border-radius: 0 4px 4px 0; }
        .prose .poem-contents p { margin-bottom: 0.5em; font-weight: 600; color: #1a1a1a; }
        .prose .poem-contents ol, .prose .poem-contents ul { background: transparent; border: none; padding: 0 0 0 1.2em; margin: 0; }
        .prose .poem-contents li { font-style: italic; color: #444; font-family: Cormorant Garamond, Georgia, serif; font-size: 1.1rem; }
        .prose .poem-block { margin-bottom: 3.5em; display: block; }
        .prose .poem-title { font-size: 1.5rem; font-style: normal; color: ${accentColor}; margin-bottom: 1.2em; display: block; font-family: Cormorant Garamond, Georgia, serif; font-weight: 700; }
        .prose .poem-stanza { font-family: Cormorant Garamond, Georgia, serif; margin-bottom: 1.8em; display: block; white-space: pre-line; line-height: 1.75; color: #1a1a1a; font-size: 1.15rem; }
        .prose .poem-stanza p { margin-bottom: 0.25em; line-height: 1.75; color: #1a1a1a; white-space: pre-line; }
        .prose .poem-stanza p::first-letter { all: unset; }
        .prose .poem-stanza br { display: block; }
`;
}
