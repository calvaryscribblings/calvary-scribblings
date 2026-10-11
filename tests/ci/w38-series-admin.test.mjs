// W38 — THE SERIES ADMIN (ruling 140), its pure halves.
//
//   node --test tests/ci/w38-series-admin.test.mjs      (part of npm run test:ci)
//
// The validators and the draft model, the checklist and every sentence it produces, London time
// across the 25 Oct clock change, the shared writer roster (and that the story CMS's own picker is
// unchanged by the move), the writer backfill's agreement check, the sitemap's Book Store list,
// the page check, and /book-reader. The rules half is tests/rules/w38-series.test.mjs; the screens
// are tests/series/w38-editor.spec.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  validateSeries, validateInstalmentDetail, PROVISIONAL_RELEASE_MS,
} from '../../app/lib/series/schema.js';
import {
  instalmentState, seriesState, needsFor, publishButtonLabel, pressingIt, goesLiveLine,
  seriesSummary, rowSubline, tierLabel, releaseChoice, audienceLine,
} from '../../app/lib/series/publishing.js';
import {
  londonFieldsToMs, londonFields, londonShort, londonLongDate, londonLongDateTime, londonClock, londonDaysUntil,
} from '../../app/lib/londonTime.js';
import { rosterUids, loadWriterRoster, findWriterByHandle } from '../../app/lib/writerRoster.js';
import { sitemapTitleSlugs } from '../../app/lib/bookstore/sitemapTitles.js';
import { waitForPages, pageAnswers } from '../../app/lib/series/pageCheck.js';
import { agreedWriter } from '../../scripts/series/backfill-writers.mjs';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 11, 12, 0);            // Sun 11 Oct 2026, 13:00 London
const H = 3600_000;

const SERIES_DRAFT = { schemaVersion: 1, slug: 's', title: 'S', synopsis: '', coverUrl: null, status: 'draft', addedAt: 1, updatedAt: 1, author: 'W', authorUid: 'u', authorHandle: 'w' };
const SERIES_LIVE = { ...SERIES_DRAFT, synopsis: 'A synopsis.', coverUrl: 'https://x/p.png', status: 'published' };
const DRAFT_ROW = { schemaVersion: 1, seriesId: 's', ordinal: 3, releaseAtMs: PROVISIONAL_RELEASE_MS, freeForGold: false, status: 'draft', addedAt: 1, updatedAt: 1 };
const FULL_DETAIL = { schemaVersion: 1, title: 'Three', author: 'W', authorUid: 'u', authorHandle: 'w', coverUrl: 'https://x/c.png', epubPath: 'series_epubs/s-i3/master.epub', wordCount: 4400, updatedAt: 1 };
const NEW_DETAIL = { ...FULL_DETAIL, coverUrl: null, epubPath: null, wordCount: null, choicesPending: { freeForGold: true, releaseAtMs: true } };

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · the validators', () => {
  test('a series writer is all three or none, and the handle is stored without its @', () => {
    assert.equal(validateSeries(SERIES_DRAFT).valid, true);
    const { author, authorUid, authorHandle, ...none } = SERIES_DRAFT;
    assert.equal(validateSeries(none).valid, true, 'a pre-W38 series with no writer still validates');
    assert.match(validateSeries({ ...none, authorUid: 'u' }).errors.join(), /all three or none/);
    assert.match(validateSeries({ ...SERIES_DRAFT, authorHandle: '@w' }).errors.join(), /without the @/);
  });
  test('a draft series may wait for its synopsis; a published one may not', () => {
    assert.equal(validateSeries({ ...SERIES_DRAFT, synopsis: '' }).valid, true);
    assert.match(validateSeries({ ...SERIES_DRAFT, status: 'published', coverUrl: 'https://x' }).errors.join(), /synopsis is required/);
  });
  test('141: publishing needs a cover as well as the EPUB', () => {
    const { coverUrl, ...noCover } = FULL_DETAIL;
    assert.match(validateInstalmentDetail({ ...noCover, coverUrl: null }, { publishing: true }).errors.join(), /coverUrl is required/);
    assert.match(validateInstalmentDetail({ ...FULL_DETAIL, epubPath: null }, { publishing: true }).errors.join(), /epubPath is required/);
    assert.equal(validateInstalmentDetail(FULL_DETAIL, { publishing: true }).valid, true);
    assert.equal(validateInstalmentDetail({ ...FULL_DETAIL, coverUrl: null }).valid, true, 'a draft may have no cover');
  });
  test('142: a draft may hold both choices open; publishing is refused until both are made', () => {
    assert.equal(validateInstalmentDetail(NEW_DETAIL).valid, true);
    const e = validateInstalmentDetail({ ...FULL_DETAIL, choicesPending: { freeForGold: true, releaseAtMs: true } }, { publishing: true }).errors.join();
    assert.match(e, /who can read it must be chosen/);
    assert.match(e, /when it goes live must be chosen/);
    assert.match(validateInstalmentDetail({ ...FULL_DETAIL, choicesPending: { freeForGold: true } }, { publishing: true }).errors.join(), /who can read it/);
    assert.match(validateInstalmentDetail({ ...FULL_DETAIL, releaseWhen: 'publish' }, { publishing: true }).errors.join(), /cleared when the instalment is published/);
    assert.match(validateInstalmentDetail({ ...FULL_DETAIL, choicesPending: { title: true } }).errors.join(), /may only hold/);
  });
  test('the provisional release is a valid row value, far in the future', () => {
    assert.ok(Number.isInteger(PROVISIONAL_RELEASE_MS) && PROVISIONAL_RELEASE_MS > Date.UTC(2099, 0, 1));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · states, as readers see them', () => {
  test('instalments: Draft, Scheduled, Live, Taken down', () => {
    assert.equal(instalmentState(DRAFT_ROW, NOW), 'draft');
    assert.equal(instalmentState({ ...DRAFT_ROW, status: 'published', releaseAtMs: NOW + H }, NOW), 'scheduled');
    assert.equal(instalmentState({ ...DRAFT_ROW, status: 'published', releaseAtMs: NOW - H }, NOW), 'live');
    assert.equal(instalmentState({ ...DRAFT_ROW, status: 'unpublished' }, NOW), 'taken-down');
  });
  test('a series is Draft, Live or Taken down', () => {
    assert.deepEqual(['draft', 'published', 'unpublished'].map((status) => seriesState({ status })), ['draft', 'live', 'taken-down']);
  });
  test('who can read it, including Not chosen', () => {
    assert.equal(tierLabel(DRAFT_ROW, NEW_DETAIL), 'Not chosen');
    assert.equal(tierLabel({ freeForGold: true }, FULL_DETAIL), 'Gold and Platinum');
    assert.equal(tierLabel({ freeForGold: false }, FULL_DETAIL), 'Platinum only');
    assert.equal(audienceLine({ freeForGold: true }), 'Gold and Platinum members can read it.');
    assert.equal(audienceLine({ freeForGold: false }), 'Platinum members can read it.');
  });
  test('an instalment from before W38 counts as chosen', () => {
    const legacy = { ...FULL_DETAIL };
    assert.equal(tierLabel({ freeForGold: false }, legacy), 'Platinum only');
    assert.deepEqual(releaseChoice({ releaseAtMs: NOW + H }, legacy), { mode: 'date', ms: NOW + H });
    assert.deepEqual(releaseChoice({ releaseAtMs: PROVISIONAL_RELEASE_MS }, NEW_DETAIL), { mode: null });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · "Before it goes live"', () => {
  test('a brand-new draft under a draft series needs everything, series poster and synopsis included', () => {
    const n = needsFor({ series: SERIES_DRAFT, row: DRAFT_ROW, detail: NEW_DETAIL, now: NOW });
    assert.deepEqual(n.needed.map((x) => x.label), ['Title', 'Writer', 'EPUB', 'Cover', 'Who can read it', 'When', 'Series poster', 'Series synopsis']);
    assert.deepEqual(n.needed.filter((x) => !x.done).map((x) => x.detail), ['Still needed', 'Still needed', 'Choose one', 'Choose one', 'Still needed', 'Still needed']);
    assert.equal(n.left, 6);
    assert.equal(publishButtonLabel(n), '6 things left');
    assert.deepEqual(n.optional.map((x) => x.label), ['Sponsor', 'Logline', 'Synopsis']);
  });
  test('under a live series, the series items are not asked for', () => {
    const n = needsFor({ series: SERIES_LIVE, row: DRAFT_ROW, detail: NEW_DETAIL, now: NOW });
    assert.equal(n.needed.some((x) => x.key === 'poster'), false);
    assert.equal(n.seriesGoesLive, false);
  });
  test('"1 thing left", then "Publish now" with its three lines', () => {
    const one = needsFor({ series: SERIES_LIVE, row: DRAFT_ROW, detail: { ...FULL_DETAIL, choicesPending: { releaseAtMs: true } }, now: NOW });
    assert.equal(publishButtonLabel(one), '1 thing left');
    const now = needsFor({ series: SERIES_LIVE, row: DRAFT_ROW, detail: { ...FULL_DETAIL, releaseWhen: 'publish' }, now: NOW });
    assert.equal(publishButtonLabel(now), 'Publish now');
    assert.deepEqual(pressingIt(now, 3), ['Publishes instalment 3.', 'Builds its page on the site, in about two minutes.', 'Checks the page opens, then tells you.']);
  });
  test('"Schedule for Wed 14 Oct, 08:00" and the scheduled lines, in London time', () => {
    const ms = londonFieldsToMs('2026-10-14', '08:00');
    const n = needsFor({ series: SERIES_LIVE, row: { ...DRAFT_ROW, releaseAtMs: ms }, detail: { ...FULL_DETAIL, releaseWhen: 'date' }, now: NOW });
    assert.equal(publishButtonLabel(n), 'Schedule for Wed 14 Oct, 08:00');
    assert.equal(n.needed.find((x) => x.key === 'when').detail, 'Wed 14 Oct, 08:00 London');
    assert.deepEqual(pressingIt(n, 3), ['Saves instalment 3 as scheduled.', 'Builds its page on the site, in about two minutes.', 'Opens it to readers at 08:00 London on Wednesday 14 October.']);
  });
  test('a date that has passed is not an answer', () => {
    const n = needsFor({ series: SERIES_LIVE, row: { ...DRAFT_ROW, releaseAtMs: NOW - H }, detail: { ...FULL_DETAIL, releaseWhen: 'date' }, now: NOW });
    assert.equal(n.needed.find((x) => x.key === 'when').detail, 'That time has passed');
    assert.equal(n.left, 1);
  });
  test('the EPUB line carries the word count', () => {
    const n = needsFor({ series: SERIES_LIVE, row: DRAFT_ROW, detail: FULL_DETAIL, now: NOW });
    assert.equal(n.needed.find((x) => x.key === 'epub').detail, '4,400 words');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · the plain lines', () => {
  test('"2 instalments live · instalment 3 in draft"', () => {
    const live = (o) => ({ row: { ...DRAFT_ROW, ordinal: o, status: 'published', releaseAtMs: NOW - H } });
    assert.equal(seriesSummary(SERIES_LIVE, [live(1), live(2), { row: DRAFT_ROW }], NOW), '2 instalments live · instalment 3 in draft');
  });
  test('"Not on the site · needs its poster and a first instalment"', () => {
    assert.equal(seriesSummary({ ...SERIES_DRAFT, synopsis: 'Has one.' }, [], NOW), 'Not on the site · needs its poster and a first instalment');
    assert.equal(seriesSummary(SERIES_DRAFT, [], NOW), 'Not on the site · needs its poster, its synopsis and a first instalment');
  });
  test('a draft row says what it still needs, in amber; a live row says reading time and sponsor', () => {
    const d = rowSubline({ series: SERIES_LIVE, row: DRAFT_ROW, detail: NEW_DETAIL, now: NOW });
    assert.equal(d.text, 'Still needed: epub, cover, who can read it, when');
    assert.equal(d.amber, true);
    const l = rowSubline({ series: SERIES_LIVE, row: { ...DRAFT_ROW, status: 'published', releaseAtMs: NOW - H }, detail: { ...FULL_DETAIL, sponsorName: 'Acme' }, now: NOW });
    assert.equal(l.text, 'About 20 min · Sponsored by Acme');
  });
  test('no line ever prints an epoch number or an instalment id', () => {
    const lines = [
      seriesSummary(SERIES_LIVE, [{ row: { ...DRAFT_ROW, status: 'published', releaseAtMs: NOW + 3 * 86400000 } }], NOW),
      ...needsFor({ series: SERIES_DRAFT, row: { ...DRAFT_ROW, releaseAtMs: NOW + H }, detail: { ...NEW_DETAIL, choicesPending: null, releaseWhen: 'date' }, now: NOW }).needed.map((x) => x.detail),
    ];
    for (const l of lines) {
      assert.doesNotMatch(l, /\d{10,}/, l);
      assert.doesNotMatch(l, /-i\d/, l);
      assert.doesNotMatch(l, /\b(published|unpublished)\b/, l);  // "in draft" is the design's own plain word
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · London time across 25 Oct 2026, when the clocks go back', () => {
  test('08:00 London on 24 Oct is 07:00 UTC; on 26 Oct it is 08:00 UTC', () => {
    assert.equal(londonFieldsToMs('2026-10-24', '08:00'), Date.UTC(2026, 9, 24, 7, 0));
    assert.equal(londonFieldsToMs('2026-10-26', '08:00'), Date.UTC(2026, 9, 26, 8, 0));
  });
  test('and it reads back as typed, either side of the change', () => {
    assert.deepEqual(londonFields(Date.UTC(2026, 9, 24, 7, 0)), ['2026-10-24', '08:00']);
    assert.deepEqual(londonFields(Date.UTC(2026, 9, 26, 8, 0)), ['2026-10-26', '08:00']);
    assert.equal(londonShort(Date.UTC(2026, 9, 24, 7, 0)), 'Sat 24 Oct, 08:00');
    assert.equal(londonShort(Date.UTC(2026, 9, 26, 8, 0)), 'Mon 26 Oct, 08:00');
    assert.equal(londonLongDateTime(Date.UTC(2026, 9, 7, 8, 0)), 'Wednesday 7 October, 09:00');
    assert.equal(londonLongDate(Date.UTC(2026, 9, 14, 7, 0)), 'Wednesday 14 October');
    assert.equal(londonClock(Date.UTC(2026, 9, 26, 8, 0)), '08:00');
  });
  test('"Goes live in n days" counts London calendar days across the change', () => {
    const fri = Date.UTC(2026, 9, 23, 22, 30);           // Fri 23 Oct, 23:30 London
    assert.equal(londonDaysUntil(Date.UTC(2026, 9, 26, 8, 0), fri), 3);
    assert.equal(goesLiveLine(Date.UTC(2026, 9, 26, 8, 0), fri), 'Goes live in 3 days, at 08:00 London time.');
    assert.equal(goesLiveLine(Date.UTC(2026, 9, 24, 7, 0), fri), 'Goes live tomorrow, at 08:00 London time.');
  });
  test('a half-typed date is not a time', () => {
    assert.ok(Number.isNaN(londonFieldsToMs('2026-10-24', '')));
    assert.ok(Number.isNaN(londonFieldsToMs('', '08:00')));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
// The story CMS's roster and handle lookup, AS THEY WERE IN app/admin/page.js BEFORE W38, copied
// here verbatim so the shared module can be held to them. If the module ever answers differently
// from these on the same database, the CMS has changed behaviour.
function fakeDb(data) {
  const at = (p) => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), data);
  return {
    db: {},
    ref: (_db, path) => path,
    get: async (path) => { const v = at(path); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  };
}
async function oldRoster({ ref, get, db }) {
  const storiesSnap = await get(ref(db, 'cms_stories'));
  const uidSet = new Set();
  if (storiesSnap.exists()) {
    Object.values(storiesSnap.val()).forEach(st => {
      const u = (st && st.authorUid ? String(st.authorUid) : '').trim();
      if (u) uidSet.add(u);
    });
  }
  const rosterArr = (await Promise.all([...uidSet].map(async uid => {
    try {
      const snap = await get(ref(db, `users/${uid}`));
      if (!snap.exists()) return null;
      const u = snap.val() || {};
      return { uid, displayName: u.displayName || '(unknown user)', username: u.username || '' };
    } catch (e) { return null; }
  }))).filter(Boolean);
  rosterArr.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return rosterArr;
}
async function oldLookup({ ref, get, db }, handleInput) {
  const raw = (handleInput || '').trim().toLowerCase().replace(/^@+/, '');
  if (!raw) return { resolvedHandle: null, handleError: '' };
  const hSnap = await get(ref(db, `usernames/${raw}`));
  const uid = hSnap.exists() ? String(hSnap.val() || '').trim() : '';
  if (!uid) return { resolvedHandle: null, handleError: `No user found for @${raw}.` };
  const uSnap = await get(ref(db, `users/${uid}`));
  const u = uSnap.exists() ? (uSnap.val() || {}) : {};
  return { resolvedHandle: { uid, displayName: u.displayName || '', username: u.username || raw }, handleError: '' };
}
const DATA = {
  cms_stories: { a: { authorUid: 'u2' }, b: { authorUid: ' u1 ' }, c: { authorUid: 'u2' }, d: {}, e: { authorUid: 'gone' } },
  users: { u1: { displayName: 'Zed Writer', username: 'zed' }, u2: { displayName: 'Ada Writer' }, u3: { username: 'nameless' } },
  usernames: { zed: 'u1', nameless: 'u3', ghost: 'nobody' },
};

describe('W38 · one writer roster for both admin screens', () => {
  test('the roster is the authorUids used across cms_stories, read per uid, sorted by name', async () => {
    const f = fakeDb(DATA);
    assert.deepEqual(rosterUids(DATA.cms_stories).sort(), ['gone', 'u1', 'u2']);
    assert.deepEqual(await loadWriterRoster(f), [
      { uid: 'u2', displayName: 'Ada Writer', username: '' },
      { uid: 'u1', displayName: 'Zed Writer', username: 'zed' },
    ]);
  });
  test('THE STORY CMS IS UNCHANGED: the module answers exactly as the old inline code did', async () => {
    const f = fakeDb(DATA);
    assert.deepEqual(await loadWriterRoster(f), await oldRoster(f));
    assert.deepEqual(await loadWriterRoster({ ...f, stories: DATA.cms_stories }), await oldRoster(f), 'with the stories handed in, as the CMS does');
    for (const typed of ['@Zed', 'zed', '  ZED ', '@@nameless', 'ghost', 'missing', '']) {
      const before = await oldLookup(f, typed);
      const now = await findWriterByHandle(f, typed);
      if (before.resolvedHandle) assert.deepEqual({ uid: now.uid, displayName: now.displayName, username: now.username }, before.resolvedHandle, typed);
      else assert.equal(now.error, before.handleError, typed);
    }
  });
  test('the CMS reads through the module, and carries no copy of its own', () => {
    const cms = src('app/admin/page.js');
    assert.match(cms, /from '\.\.\/lib\/writerRoster'/);
    assert.match(cms, /loadWriterRoster\(/);
    assert.match(cms, /findWriterByHandle\(/);
    assert.doesNotMatch(cms, /usernames\/\$\{raw\}/, 'the inline handle lookup is still in the CMS');
    assert.doesNotMatch(cms, /const uidSet = new Set\(\)/, 'the inline roster is still in the CMS');
  });
  test('the Series picker leaves out guests and writers with no handle', () => {
    const page = src('app/admin/series/page.js');
    assert.match(page, /r\.filter\(\(w\) => w\.username\)/);
    assert.doesNotMatch(page, /cms_authors/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · the writer backfill', () => {
  const d = (o) => ({ author: 'Tricia Ajax', authorUid: 'u9', authorHandle: 'tricia_ajax', ...o });
  test('instalments that agree give the series its writer; a stray @ is not a disagreement', () => {
    const v = agreedWriter([d(), d({ authorHandle: '@tricia_ajax' })]);
    assert.deepEqual(v.writer, { author: 'Tricia Ajax', authorUid: 'u9', authorHandle: 'tricia_ajax' });
    assert.equal(v.strayAt, 1);
  });
  test('a different account or name stops it', () => {
    assert.ok(agreedWriter([d(), d({ authorUid: 'other' })]).disagree);
    assert.ok(agreedWriter([d(), d({ author: 'Someone Else' })]).disagree);
    assert.ok(agreedWriter([d({ authorUid: '' })]).disagree);
  });
  test('no instalments, nothing to copy', () => { assert.ok(agreedWriter([]).none); });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · the page check', () => {
  test('polls until every page answers 200', async () => {
    let calls = 0;
    const fetchImpl = async (p, init) => { calls++; assert.equal(init.cache, 'no-store'); return { status: p === '/a' || calls > 4 ? 200 : 404 }; };
    let t = 0;
    const r = await waitForPages(['/a', '/b'], { fetchImpl, sleep: async (ms) => { t += ms; }, now: () => t, intervalMs: 10, timeoutMs: 1000 });
    assert.equal(r.ok, true);
  });
  test('gives up after the timeout, and a network failure is a no', async () => {
    let t = 0;
    const r = await waitForPages(['/x'], { fetchImpl: async () => { throw new Error('offline'); }, sleep: async (ms) => { t += ms; }, now: () => t, intervalMs: 100, timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.equal(await pageAnswers('/x', { fetchImpl: async () => ({ status: 404 }) }), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W38 · rulings 131 and 143', () => {
  test('131: the sitemap lists published catalogue titles only', () => {
    const titles = {
      a: { slug: 'alpha', status: 'published', publisherId: 'p1' },
      b: { slug: 'beta', status: 'published', publisherId: 'p2' },        // publisher inactive
      c: { slug: 'gamma', status: 'withdrawn', publisherId: 'p1' },
      d: { slug: 'delta', status: 'draft', publisherId: 'p1' },
      e: { slug: 'epsilon', status: 'published', publisherId: 'unknown' }, // passes, as on the shop
    };
    assert.deepEqual(sitemapTitleSlugs(titles, { p1: { status: 'active' }, p2: { status: 'inactive' } }), ['alpha', 'epsilon']);
  });
  test('131: the layout carries no noindex, the rooms still do, and the sitemap reads the shop', () => {
    assert.doesNotMatch(src('app/bookstore/layout.js').replace(/^\s*\/\/.*$/gm, ''), /robots\s*:/);
    for (const room of ['desiderata', 'search']) assert.match(src(`app/bookstore/${room}/page.js`), /robots: \{ index: false, follow: false \}/);
    assert.match(src('app/sitemap.js'), /sitemapTitleSlugs\(titles, publishers\)/);
  });
  test('143: /book-reader goes to /series through the generator, and the page is gone', () => {
    const gen = src('scripts/generate-redirects.mjs');
    assert.match(gen, /\['\/book-reader',\s+'\/series'\]/);
    assert.match(gen, /\['\/book-reader\.html',\s+'\/series'\]/);
    assert.equal(existsSync(new URL('../../app/book-reader/page.js', import.meta.url)), false);
    assert.doesNotMatch(src('app/search/page.js').replace(/^\s*\/\/.*$/gm, ''), /novel: '\/book-reader'/);
  });
});
