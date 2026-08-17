// R9.3 — WHICH PARAGRAPH GETS THE DROP CAP, AND WHETHER A GLYPH ACTUALLY LANDS.
//
//   npm run test:dropcap
//
// The bug: app/lib/dropcap.js chose the opening paragraph from TEXT alone. CHAFF opens with
// <p class="intro-note">I.</p>; "I." is short but terminated, so the old predicate read it as
// a finished sentence — prose — and floated a 4.2em "I." beside the opening paragraph. Eight
// further stories opened on a quote mark or a digit and had that character capped, because
// ::first-letter swallows leading punctuation and there is no CSS way to stop it.
//
// WHAT IS UNDER TEST IS THE SHIPPED MODULE. app/lib/dropcap.js and app/lib/proseCSS.js are
// read off disk and injected — no transcription, no fixture copy of the logic. A copy would
// pass forever while the app regressed. The injection strips `export`/`'use client'` (both
// meaningless in a classic script) and asserts that the strip actually matched, so the day
// the module's shape changes this suite fails loudly rather than testing an empty page.
//
// THE CORPUS is the real thing wherever possible: the CHAFF, Village People, i-dey-your-back
// and drip-drip-drip cases below are verbatim openings from cms_stories, not invented markup.
// Village People and drip-drip-drip are the regression guards for the fail-safe rule — both
// open on a SHORT sentence and must keep their drop cap.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// A 1x1 transparent GIF: the image cases need a real <img> that lays out without a network.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// R11.8: `deps` was added when dropcap.js stopped being self-contained. The exclusion
// list, the front-matter heuristics and the walk moved to app/lib/prosePredicate.js so
// the preview cutter could run the SAME rules rather than a second copy of them — see
// that file's header. This spec still runs the real module against real DOM in a real
// browser, which is its whole value, so the dependency is inlined ahead of it and the
// `import` statement stripped rather than the test being rewritten against a mock.
function asClassicScript(relPath, exposes, deps = []) {
  const strip = (path) => {
    const src = readFileSync(join(ROOT, path), 'utf8');
    const exportCount = (src.match(/^export (const|function|class) /gm) || []).length;
    if (exportCount === 0) {
      throw new Error(`${path}: found no top-level exports to strip — has the module's shape changed?`);
    }
    return src
      .replace(/^'use client';\s*$/m, '')
      // Multi-line `import { … } from '…';` as well as single-line.
      .replace(/^import\s+[\s\S]*?from\s+'[^']+';\s*$/gm, '')
      .replace(/^export (const|function|class) /gm, '$1 ');
  };
  const body = [...deps, relPath].map(strip).join('\n');
  return `${body}\n${exposes.map((n) => `window.${n} = ${n};`).join('\n')}`;
}

const DROPCAP_JS = asClassicScript(
  'app/lib/dropcap.js',
  ['tagDropcap', 'DROPCAP_EXCLUDED_SELECTORS'],
  ['app/lib/prosePredicate.js'],
);
// R12.5: proseCSS.js stopped being self-contained when the subheading colour was pinned to
// house gold. The tone it uses is DERIVED (see app/lib/houseGold.js — it is the lightest
// tone of the house hue that clears 4.5:1 on the cream reading surface), so the constant is
// inlined ahead of the stylesheet exactly as prosePredicate.js is ahead of dropcap.js.
// Without it the stripped script defines proseCSS over an undefined identifier and every
// case in this file fails with a ReferenceError at first call.
const PROSECSS_JS = asClassicScript('app/lib/proseCSS.js', ['proseCSS'], ['app/lib/houseGold.js']);

// ── THE CORPUS ───────────────────────────────────────────────────────────────────────────
// `expect` is the text the drop cap must land on, or null for "no drop cap at all".
const CASES = [
  {
    name: 'normal story — plain opening paragraph',
    html: '<p>Nnamdi stole a glance at Amaka, caressing her cheek with his thumb.</p> <p>It felt lighter than it used to.</p>',
    expect: 'Nnamdi stole a glance',
  },
  {
    name: 'content note before the prose',
    html: '<p>Content note: this story depicts grief and medical detail.</p> <p>The scream ripped through the spa.</p>',
    expect: 'The scream ripped',
    frontmatter: ['Content note'],
  },
  {
    name: "CHAFF — numbered section marker as <p class='intro-note'> (the reported bug)",
    html: '<p class="intro-note">I.</p> <p>Nnamdi stole a glance at Amaka, caressing her cheek with his thumb. His other hand hung from the armrest as he fingered his wedding band.</p>',
    expect: 'Nnamdi stole a glance',
    // The marker keeps its own .intro-note presentation and must NOT be restyled as
    // front-matter — that would shrink it to 0.85em and grey it out.
    notFrontmatter: ['I.'],
  },
  {
    name: 'CHAFF — same marker with the class stripped (the class-blind fail-safe)',
    html: '<p>I.</p> <p>Nnamdi stole a glance at Amaka, caressing her cheek with his thumb.</p>',
    expect: 'Nnamdi stole a glance',
  },
  {
    name: 'CHAFF — the CMS <h3> workaround still works after the revert',
    html: '<h3 class="intro-note">I.</h3> <p>Nnamdi stole a glance at Amaka, caressing her cheek with his thumb.</p>',
    expect: 'Nnamdi stole a glance',
  },
  {
    name: 'dialogue opener — straight apostrophe (i-dey-your-back, verbatim)',
    html: "<p>'...I dey your back.'</p> <p>The line went dead before she could answer him.</p>",
    expect: null,
  },
  {
    name: 'dialogue opener — curly double quote',
    html: '<p>“You can have some, B.” Preye pushes half her toast toward me.</p>',
    expect: null,
  },
  {
    name: 'digit opener (is-2026-shaping-up…, verbatim)',
    html: '<p>2026 is shaping up to be a massive year for cinema, with blockbusters landing all year.</p>',
    expect: null,
  },
  {
    name: 'em dash opener — capped alone by Chromium if allowed through',
    html: '<p>— and then the lights went out over the whole street.</p>',
    expect: null,
  },
  {
    name: 'image opener — <p> wrapping an image, then prose',
    html: `<p><img src="${PIXEL}"> A view of the harbour at dawn.</p> <p>The scream ripped through the spa.</p>`,
    expect: 'The scream ripped',
  },
  {
    name: 'image opener — <figure> with a caption, then prose',
    html: `<figure><img src="${PIXEL}"><figcaption>A view of the harbour.</figcaption></figure> <p>Nnamdi stole a glance at Amaka.</p>`,
    expect: 'Nnamdi stole a glance',
  },
  {
    name: 'blockquote epigraph opener — the quote is not the drop cap',
    html: '<blockquote><p>All happy families are alike.</p></blockquote> <p>Nnamdi stole a glance at Amaka.</p>',
    expect: 'Nnamdi stole a glance',
  },
  {
    name: 'section break marker opens the body',
    html: '<p class="section-break">* * *</p> <p>Nnamdi stole a glance at Amaka.</p>',
    expect: 'Nnamdi stole a glance',
  },
  {
    name: 'REGRESSION — village-people opens on a short sentence and keeps its cap',
    html: '<p>The scream ripped through the spa.</p> <p>It was so sudden that Amara jerked on the treatment bed.</p>',
    expect: 'The scream ripped',
  },
  {
    name: 'REGRESSION — drip-drip-drip: short, but multiple terminal marks means prose',
    html: '<p>Drip. Drip. Drip.</p> <p>I make a mental note to call the plumber to fix my leaky bathroom faucet.</p>',
    expect: 'Drip. Drip. Drip.',
  },
  {
    name: 'nothing but front-matter — silent, not broken',
    html: '<p class="intro-note">I.</p> <p class="section-break">* * *</p>',
    expect: null,
  },
  {
    name: 'empty body',
    html: '',
    expect: null,
  },
];

// Render a body, run the SHIPPED tagger, and report both the tagger's opinion and what
// Chromium actually drew.
async function render(page, html, { dropcap = true } = {}) {
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');
  await page.addScriptTag({ content: PROSECSS_JS });
  await page.addScriptTag({ content: DROPCAP_JS });
  return page.evaluate(({ html, dropcap }) => {
    const root = document.getElementById('root');
    root.innerHTML = `<style>${window.proseCSS('#6b46c1')}</style>`
      + `<article id="art"><div class="prose${dropcap ? ' has-dropcap' : ''}">${html}</div></article>`;
    const article = document.getElementById('art');
    window.tagDropcap(article);

    const paras = Array.from(article.querySelectorAll('p'));
    const tagged = paras.filter((p) => p.classList.contains('dropcap-target'));

    // What Chromium actually drew: the height of the first character's box. ~20px is body
    // text at this size; the 4.2em cap measures ~86px. Anything oversized ANYWHERE in the
    // body is a rendered drop cap, whoever asked for it.
    const firstCharHeight = (p) => {
      const node = p.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE || !node.length) return 0;
      const r = document.createRange();
      r.setStart(node, 0); r.setEnd(node, 1);
      return Math.round(r.getBoundingClientRect().height);
    };
    const oversized = paras.filter((p) => firstCharHeight(p) > 40).map((p) => p.textContent.trim().slice(0, 30));

    return {
      taggedCount: tagged.length,
      taggedText: tagged.length ? tagged[0].textContent.trim() : null,
      taggedHeight: tagged.length ? firstCharHeight(tagged[0]) : 0,
      oversized,
      frontmatter: paras.filter((p) => p.classList.contains('story-frontmatter')).map((p) => p.textContent.trim()),
    };
  }, { html, dropcap });
}

for (const width of [375, 390]) {
  test.describe(`drop-cap targeting @ ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const c of CASES) {
      test(c.name, async ({ page }) => {
        const r = await render(page, c.html);

        if (c.expect === null) {
          expect(r.taggedCount, 'no paragraph should be tagged').toBe(0);
          // The assertion that actually matters: nothing in the body is drawn oversized.
          expect(r.oversized, 'no drop cap should be rendered anywhere').toEqual([]);
          // …and giving up must be silent. Greying out a whole body because the walk liked
          // nothing in it is a worse failure than rendering no ornament.
          expect(r.frontmatter, 'a body with no target must not be restyled as front-matter').toEqual([]);
        } else {
          expect(r.taggedCount, 'exactly one paragraph should be tagged').toBe(1);
          expect(r.taggedText).toContain(c.expect);
          // …and the tag produced a real glyph, not just a class name.
          expect(r.taggedHeight, 'the tagged paragraph should render an enlarged cap').toBeGreaterThan(40);
          expect(r.oversized.length, 'only the tagged paragraph should be oversized').toBe(1);
        }

        for (const t of c.frontmatter || []) {
          expect(r.frontmatter.some((f) => f.includes(t)), `"${t}" should be marked front-matter`).toBe(true);
        }
        for (const t of c.notFrontmatter || []) {
          expect(r.frontmatter.some((f) => f.includes(t)), `"${t}" carries its own styling and must not be restyled`).toBe(false);
        }
      });
    }
  });
}

test.describe('structural guarantees', () => {
  test('poetry (no .has-dropcap) is never tagged', async ({ page }) => {
    const r = await render(page, '<p>Nnamdi stole a glance at Amaka.</p>', { dropcap: false });
    expect(r.taggedCount).toBe(0);
    expect(r.oversized).toEqual([]);
  });

  test('tagging is idempotent — a second pass converges on the same paragraph', async ({ page }) => {
    await render(page, '<p class="intro-note">I.</p> <p>Nnamdi stole a glance at Amaka.</p>');
    const again = await page.evaluate(() => {
      const article = document.getElementById('art');
      window.tagDropcap(article);
      window.tagDropcap(article);
      const tagged = Array.from(article.querySelectorAll('p.dropcap-target'));
      return { count: tagged.length, text: tagged[0]?.textContent.trim() };
    });
    expect(again.count).toBe(1);
    expect(again.text).toContain('Nnamdi stole a glance');
  });

  test('re-tagging clears a stale target when the body is replaced', async ({ page }) => {
    await render(page, '<p>Nnamdi stole a glance at Amaka.</p>');
    const after = await page.evaluate(() => {
      const article = document.getElementById('art');
      article.querySelector('.prose').innerHTML = "<p>'I killed my mother.'</p>";
      window.tagDropcap(article);
      return article.querySelectorAll('p.dropcap-target').length;
    });
    expect(after, 'the replaced body opens on a quote — the old tag must not survive').toBe(0);
  });

  test('the exclusion list reached the browser intact', async ({ page }) => {
    await render(page, '<p>Nnamdi stole a glance at Amaka.</p>');
    const sels = await page.evaluate(() => window.DROPCAP_EXCLUDED_SELECTORS);
    expect(sels).toContain('.intro-note');
    expect(sels).toContain('blockquote');
  });
});
