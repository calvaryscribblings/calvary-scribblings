// UNRELEASED-1 — A STORY THAT IS NOT LIVE HAS NO PAGE IN THE EXPORT.
//
//   npx next build && node --test tests/build/unreleased-pages.test.mjs
//
// Runs against a BUILT out/ — the artifact Cloudflare Pages serves — so it is a step after the
// build in reader-tests.yml, not part of test:ci. Without out/ it fails, rather than passing on
// nothing.
//
// ── WHAT IT HOLDS ────────────────────────────────────────────────────────────────────────────
//
// PROOFS-R0 (31 Oct 2026): hasStaticPage built a page for every story carrying a publishAt,
// live or not, and the free-week policy read a future publishAt as "free this week" — so the
// export inlined the WHOLE body of a scheduled story at /stories/<slug>. 12 of 36 scheduled
// stories answered 200 with their text, and the midnight rebuild would have added the rest.
// Now a story's page arrives with the deploy after its go-live (app/lib/storyAccess.js).
//
// So for every cms_stories record that is not live — scheduled (a publishAt to come), held
// (coverHold), hidden (hiddenAt) or a plain draft — this asserts, over the export itself:
//   · no page: nothing at /stories/<slug> or /reader/<slug>;
//   · no link: no /stories/<slug> or /reader/<slug> path in any HTML, RSC payload or sitemap
//     that the build emitted (an editor's absolute link in a live story's prose is reported);
//   · no metadata: its title in no <title> and no og:/twitter:title.
// A title as a word in somebody's prose is not metadata, and is not looked for.
//
// ── IT READS LIVE DATA, AND PINS NONE OF IT ──────────────────────────────────────────────────
//
// The subjects are whatever records are unreleased when it runs — read from the public
// cms_stories REST endpoint, as the build itself read them. No slug, title or count is
// written here. A class with no member today is reported as SKIPPED by name, never as a pass.
// (Measured at writing: 10 scheduled, 28 held, 8 hidden, 13 plain drafts; on 79618af6 the
// export carried a page for all 38 scheduled and held.)
//
// ⚠ ACTIONS LOGS ARE PUBLIC (W12). A failure names COUNTS and ROUTES, never a slug or a title:
// an unreleased story's slug is its title in lower case. Set UNRELEASED_SHOW_SLUGS=1 locally to
// see them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReadableStory } from '../../app/lib/storyAccess.js';

const OUT = fileURLToPath(new URL('../../out/', import.meta.url));
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const SHOW = process.env.UNRELEASED_SHOW_SLUGS === '1';

const classOf = (s) => (s.hiddenAt ? 'hidden' : s.coverHold ? 'held' : typeof s.publishAt === 'string' && s.publishAt ? 'scheduled' : 'draft');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const htmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

test('a story that is not live has no page, no link and no metadata in the export', async (t) => {
  assert.ok(existsSync(join(OUT, 'index.html')), 'out/ is not built — run `npx next build` first; this suite asserts over the export');

  const res = await fetch(`${DB}/cms_stories.json`);
  assert.ok(res.ok, `cms_stories read failed: HTTP ${res.status}`);
  const all = (await res.json()) || {};
  const liveTitles = new Set(Object.values(all).filter(isReadableStory).map((s) => String(s.title || '').trim()));
  const unreleased = Object.entries(all).filter(([, s]) => s && typeof s === 'object' && !isReadableStory(s));
  // /reader/<slug> is ALSO the sample reader of every published Book Store title, which can share
  // a slug with a pulled story (the Book Reader records that became books). That page is the
  // book's, built from bookstore_titles; it is not the story's and is not looked for.
  const bres = await fetch(`${DB}/bookstore_titles.json`);
  assert.ok(bres.ok, `bookstore_titles read failed: HTTP ${bres.status}`);
  const books = new Set(Object.values((await bres.json()) || {}).filter((b) => b?.status === 'published' && b.slug).map((b) => b.slug));

  const files = walk(OUT).filter((f) => /\.(html|txt|xml|rsc|json)$/.test(f) && !relative(OUT, f).startsWith('dict/'));
  const texts = files.map((f) => [relative(OUT, f), readFileSync(f, 'utf8')]);
  const html = texts.filter(([f]) => f.endsWith('.html'));

  const findings = { page: [], link: [], metadata: [] };
  const seen = { scheduled: 0, held: 0, hidden: 0, draft: 0 };
  for (const [slug, s] of unreleased) {
    const cls = classOf(s);
    seen[cls]++;
    for (const route of ['stories', 'reader']) {
      if (route === 'reader' && books.has(slug)) continue;
      for (const p of [`${route}/${slug}.html`, `${route}/${slug}`, `${route}/${slug}.txt`]) {
        if (existsSync(join(OUT, p))) findings.page.push({ cls, slug, where: `/${route}/` });
      }
      // Every occurrence, and what precedes it: an absolute https://calvaryscribblings.co.uk/
      // link inside a story page is an editor's link in somebody's prose (see below).
      const re = new RegExp(`(calvaryscribblings\\.co\\.uk)?/${route}/${escRe(slug)}(?![a-z0-9-])`, 'g');
      for (const [f, text] of texts) {
        for (const m of text.matchAll(re)) {
          const prose = !!m[1] && f.startsWith('stories/');
          findings.link.push({ cls, slug, prose, where: `/${route}/ in ${f.split('/')[0]}` });
        }
      }
    }
    const title = String(s.title || '').trim();
    if (title && !liveTitles.has(title)) {
      const forms = [...new Set([title, htmlEsc(title)])].map(escRe).join('|');
      const meta = new RegExp(`<title>(?:${forms}) —|(?:og|twitter):title" content="(?:${forms})"`);
      for (const [f, text] of html) if (meta.test(text)) findings.metadata.push({ cls, slug, where: f.split('/')[0] });
    }
  }

  for (const cls of ['scheduled', 'held', 'hidden']) {
    if (!seen[cls]) t.diagnostic(`SKIPPED: no ${cls} story exists right now, so that class was not exercised`);
  }
  t.diagnostic(`checked ${unreleased.length} unreleased records (${Object.entries(seen).map(([k, v]) => `${v} ${k}`).join(', ')}) over ${texts.length} files`);

  const report = (kind) => {
    const rows = findings[kind];
    const byKey = {};
    for (const r of rows) {
      const k = `${r.cls} → ${r.where}`;
      (byKey[k] ??= new Set()).add(r.slug);
    }
    return Object.entries(byKey).map(([k, v]) => `  ${k}: ${v.size}${SHOW ? ` (${[...v].join(', ')})` : ''}`).join('\n');
  };

  await t.test('no page at /stories/<slug> or /reader/<slug>', () => {
    assert.equal(findings.page.length, 0, `unreleased stories with a page in the export:\n${report('page')}`);
  });
  await t.test('no link to one, anywhere in the export', () => {
    // A live story's prose may link to a slug an editor has not published yet — measured at
    // writing, one live news piece links to an unpublished draft. That link 404s and gives away
    // nothing its own text did not already print, so it is reported, not refused. It is told
    // apart by its form: an editor types the absolute URL; everything the build emits (cards,
    // lists, the sitemap's own entries aside) is a relative path, and the sitemap is in no
    // story page. Anything else is a link the export built, and fails.
    const prose = findings.link.filter((r) => r.prose);
    if (prose.length) t.diagnostic(`${new Set(prose.map((r) => r.slug)).size} unreleased slug(s) linked from a live story's prose (an editor's link; 404s)`);
    findings.link = findings.link.filter((r) => !r.prose);
    assert.equal(findings.link.length, 0, `links to unreleased stories built into the export:\n${report('link')}`);
  });
  await t.test('no <title>, og:title or twitter:title', () => {
    assert.equal(findings.metadata.length, 0, `unreleased titles in the export's metadata:\n${report('metadata')}`);
  });
});
