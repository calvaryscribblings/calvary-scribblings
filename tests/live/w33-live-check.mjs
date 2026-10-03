// W33 — THE LIVE CHECK for a private copy's door, read-only, against invented ids only.
//
//   node tests/live/w33-live-check.mjs            (needs serviceAccountKey.json, for the test reader)
//
// Runs in .github/workflows/w33-proof.yml after each deploy it watches. THE IDS ARE INVENTED HERE,
// AT RUN TIME — never a real title's id: Actions logs are public (W12), and the real id is checked
// only at grant time, on a private machine, by scripts/bookstore/author-copy.mjs.
//
// 1. /api/bookstore/stream: signed out → 401; the W17 test reader → 403 not_purchased for one
//    invented id, BYTE-IDENTICAL to the 403 for a second; and for a published title they do not
//    hold — so a refusal says nothing about whether a title exists.
// 2. An unsigned GET of bookstore_epubs/<invented>/{master.epub,cover.jpg}, on both hosts → 403.
// 3. Site search lists published books only: the one non-published record's title, and several
//    published titles, are searched for; every book result must link a published slug.
// 4. /my-library/book (once deployed): signed out → the sign-in prompt; the test reader → one
//    generic page for an invented id, a published title they do not hold, and a malformed id —
//    the same text every time, naming nothing.
// Signed in only as the test reader, behind the W17 firewall (tests/live/firewall.mjs).
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { chromium } from '@playwright/test';
import { liveContext, statsLine } from './firewall.mjs';
import { ensureTestReader, testReaderSession, signInPage } from './test-reader.mjs';
import { unsignedUrls, epubPath, coverPath } from '../../scripts/bookstore/author-copy.mjs';

const SITE = process.env.LAUNCH_SITE || 'https://calvaryscribblings.co.uk';
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const HELD_PAGE_SHIPPED = existsSync(new URL('../../app/my-library/book/page.js', import.meta.url));
const invent = () => `w33-invented-${randomBytes(4).toString('hex')}`;
const A = invent();
const B = invent();

const results = [];
const record = (check, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`); };

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: DB });
const READER = await ensureTestReader();
const account = await testReaderSession(READER);

const stream = async (titleId, idToken) => {
  const r = await fetch(`${SITE}/api/bookstore/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ titleId }),
  });
  return { status: r.status, body: await r.text() };
};

const titles = await (await fetch(`${DB}/bookstore_titles.json`)).json() || {};
const published = Object.entries(titles).filter(([, t]) => t?.status === 'published');
const unpublished = Object.entries(titles).filter(([, t]) => t?.status !== 'published');
const publishedSlugs = new Set(published.map(([k, t]) => t.slug || k));
console.log(`invented ids: ${A}, ${B} · catalogue: ${published.length} published, ${unpublished.length} not`);

// ── 1. the stream ─────────────────────────────────────────────────────────────────────────────
{
  const out = await stream(A, null);
  record('stream, signed out → 401 signed_out', out.status === 401 && JSON.parse(out.body).code === 'signed_out', `${out.status}`);
  const a = await stream(A, account.idToken);
  const b = await stream(B, account.idToken);
  record('stream, the test reader, an invented id → 403 not_purchased', a.status === 403 && JSON.parse(a.body).code === 'not_purchased', `${a.status}`);
  record('…byte-identical to the 403 for a second invented id', a.status === b.status && a.body === b.body);
  const [pubId] = published[0] || [];
  if (pubId) {
    const p = await stream(pubId, account.idToken);
    record('…and to the 403 for a published title they do not hold', p.status === a.status && p.body === a.body);
  }
}

// ── 2. unsigned object GETs ───────────────────────────────────────────────────────────────────
for (const path of [epubPath(A), coverPath(A)]) {
  for (const u of unsignedUrls(path)) {
    const s = (await fetch(u, { redirect: 'manual' })).status;
    record(`unsigned GET ${path.replace(A, '<invented>')} on ${new URL(u).host} → 403`, s === 403, `${s}`);
  }
}

const browser = await chromium.launch();
try {
  // ── 3. site search ──────────────────────────────────────────────────────────────────────────
  {
    const { ctx, stats } = await liveContext(browser, { viewport: { width: 1280, height: 900 } }, { site: SITE });
    const page = await ctx.newPage();
    const probe = async (q) => {
      await page.goto(`${SITE}/search?q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(6000);
      return page.locator('a.ix-res[href^="/bookstore/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href').slice('/bookstore/'.length)));
    };
    for (const [k, t] of unpublished) {
      const hrefs = await probe(t.title || k);
      record(`search for the ${t.status || 'status-less'} record's own title lists no non-published book`, hrefs.every((s) => publishedSlugs.has(s)) && !hrefs.includes(t.slug || k), `${hrefs.length} book result(s)`);
    }
    for (const [k, t] of published.slice(0, 4)) {
      const hrefs = await probe(t.title);
      record(`search for a published title finds it, and only published books`, hrefs.includes(t.slug || k) && hrefs.every((s) => publishedSlugs.has(s)), `${hrefs.length} book result(s)`);
    }
    console.log(`firewall (search): ${statsLine(stats)}`);
    await ctx.close();
  }

  // ── 4. the held page ────────────────────────────────────────────────────────────────────────
  if (!HELD_PAGE_SHIPPED) {
    console.log('SKIP  /my-library/book is not in this commit — the held-page checks run on the commit that ships it');
  } else {
    const [pubId] = published[0] || [];
    const names = [A, B, pubId, ...published.map(([, t]) => t.title)].filter(Boolean);
    const read = async (page, q, state) => {
      await page.goto(`${SITE}/my-library/book${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const ok = await page.locator(`[data-held-state="${state}"]`).waitFor({ timeout: 45000 }).then(() => true, () => false);
      const text = ok ? await page.locator('body').innerText() : '';
      const named = names.filter((n) => text.includes(n));
      const store = await page.locator('a[href^="/bookstore"], .br-buy').count();
      return { ok, text, named, store };
    };
    for (const [who, state, signIn] of [['signed out', 'signed-out', false], ['the test reader', 'not-on-shelf', true]]) {
      const { ctx, stats } = await liveContext(browser, { viewport: { width: 390, height: 844 } }, { site: SITE });
      const page = await ctx.newPage();
      if (signIn) await signInPage(page, SITE, account);
      const seen = [];
      for (const [label, q] of [['an invented id', `?t=${A}`], ['a published title not held', `?t=${pubId}`], ['a malformed id', '?t=..%2F..%2Fx'], ['no id', '']]) {
        const r = await read(page, q, state);
        seen.push(r.text);
        record(`held page, ${who}, ${label} → ${state}, naming nothing, no store link`, r.ok && !r.named.length && r.store === 0, r.ok ? (r.named.length ? 'NAMED something' : '') : 'state not drawn');
      }
      record(`held page, ${who}: the same page for every address`, new Set(seen).size === 1);
      console.log(`firewall (held, ${who}): ${statsLine(stats)}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
