// PROOFS-R3 — the pure rules of app/lib/proofMail.js and the tick script's log line. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import {
  dueFor, seedRecord, writerState, proofsByWriter, mailable, composeWriterMail, sampleMails, writerPath, storyLedgerPath,
  REMINDER_LEAD_MS, PROOF_MAIL_COPY, PROOF_MAIL_ADMIN_COPY, SAMPLE_PREFIX, logKey, mailHtml, mailText, MAIL_REPLY_TO, failureLine,
} from '../../app/lib/proofMail.js';
import { countsLine } from '../../scripts/proofs/mail-tick.mjs';
import { findIdentifiers } from '../../scripts/ops/redact.mjs';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const H = 3_600_000, D = 24 * H;
const s = (goLiveMs) => ({ slug: 'a-story', title: 'A Title', goLiveMs });

test('what is due: scheduled, changed, the 48-hour reminder, and nothing else', () => {
  assert.equal(dueFor(null, s(NOW + 5 * D), NOW).kind, 'scheduled');
  assert.equal(dueFor(null, s(NOW - 1), NOW), null, 'gone live (or past): nothing');
  const told = dueFor(null, s(NOW + 5 * D), NOW).next;
  assert.equal(dueFor(told, s(NOW + 5 * D), NOW + H), null, 'told, same time: nothing');
  const ch = dueFor(told, s(NOW + 6 * D), NOW + H);
  assert.equal(ch.kind, 'changed');
  assert.equal(ch.prevMs, NOW + 5 * D);
  assert.equal(ch.next.seq, 2);
  assert.equal(dueFor(told, s(NOW + 5 * D), NOW + 3 * D - 1), null, 'one ms before the 48 hours');
  const rem = dueFor(told, s(NOW + 5 * D), NOW + 3 * D);
  assert.equal(rem.kind, 'reminder');
  assert.equal(dueFor(rem.next, s(NOW + 5 * D), NOW + 4 * D), null, 'reminded once');
});

test('told inside the 48 hours: that email is the reminder', () => {
  const t = dueFor(null, s(NOW + 20 * H), NOW).next;
  assert.equal(t.remindedFor, NOW + 20 * H);
  assert.equal(dueFor(t, s(NOW + 20 * H), NOW + 10 * H), null);
  const seeded = seedRecord(s(NOW + 30 * H), NOW);
  assert.equal(dueFor(seeded, s(NOW + 30 * H), NOW + H), null, 'seeded inside 48h: no reminder');
  const seededEarly = seedRecord(s(NOW + 5 * D), NOW);
  assert.equal(dueFor(seededEarly, s(NOW + 5 * D), NOW + 5 * D - REMINDER_LEAD_MS).kind, 'reminder');
});

test('the log keys are never bare numbers (RTDB would make them an array)', () => {
  assert.equal(logKey(1), 'e1');
  assert.deepEqual(Object.keys(seedRecord(s(NOW + D), NOW).log), ['e1']);
});

test('writer state, the proofs by writer, and who has an address', () => {
  assert.equal(writerState(undefined), 'new');
  assert.equal(writerState({ excluded: { at: 1 } }), 'excluded');
  assert.equal(writerState({ excluded: { at: 1 }, opening: { at: 2 } }), 'opened');
  const at = (ms) => new Date(ms).toISOString();
  const by = proofsByWriter({
    'b-two': { authorUid: 'uidA', title: 'B', published: false, publishAt: at(NOW + 2 * D) },
    'a-one': { authorUid: 'uidA', title: 'A', published: false, publishAt: at(NOW + D) },
    'live': { authorUid: 'uidA', published: true, publishAt: at(NOW - D) },
    'ret': { authorUid: 'uidA', published: false, publishAt: at(NOW + D) },
    'nobody': { authorUid: null, published: false, publishAt: at(NOW + D) },
    'Bad Slug': { authorUid: 'uidA', published: false, publishAt: at(NOW + D) },
  }, { ret: true }, NOW);
  assert.deepEqual(Object.keys(by), ['uidA']);
  assert.deepEqual(by.uidA.map((x) => x.slug), ['a-one', 'b-two']);
  assert.equal(mailable({ email: 'w@example.test', emailVerified: true }), true);
  assert.equal(mailable({ email: 'w@example.test', emailVerified: false }), false);
  assert.equal(mailable({ email: 'w@example.test', emailVerified: true, disabled: true }), false);
  assert.equal(mailable({ email: null, emailVerified: true }), false);
});

test('ledger paths refuse anything that is not an id (LIVE-PATHS-1)', () => {
  assert.throws(() => writerPath('../users'));
  assert.throws(() => writerPath(''));
  assert.throws(() => storyLedgerPath('uidA', '../x'));
  assert.equal(storyLedgerPath('uidA', 'a-one'), 'proofs_mail/writers/uidA/stories/a-one');
});

test('the words: house style (curly, short forms), no story text, every email links its proof', () => {
  const all = [...sampleMails(NOW)];
  for (const m of all) {
    const text = [m.subject, ...m.lines].join('\n');
    assert.ok(!/[A-Za-z]'[A-Za-z]/.test(text), `a straight apostrophe in ${m.kind}`);
    assert.ok(!/\b(do not|cannot|can not|it will|we will|you are|that is|there is)\b/i.test(text), `a long form in ${m.kind}`);
    assert.ok(text.includes('https://calvaryscribblings.co.uk/proofs'), `${m.kind} links Proofs`);
    assert.ok(m.lines.at(-2) === 'The editors' && m.lines.at(-1) === 'Calvary Scribblings');
    assert.equal(m.lines[0], 'Hello,', 'ruling 297');
  }
  for (const v of Object.values(PROOF_MAIL_ADMIN_COPY)) {
    const t = typeof v === 'function' ? [v(0), v(1), v(2)].join(' ') : v;
    assert.ok(!/[A-Za-z]'[A-Za-z]/.test(t), t);
  }
  assert.equal(PROOF_MAIL_ADMIN_COPY.confirm(1), 'Open Proofs and email 1 writer');
  assert.equal(PROOF_MAIL_ADMIN_COPY.scheduledCount(2), '2 scheduled stories');
});

test('a sample is marked, and goes to the one address given', () => {
  const m = composeWriterMail('from@example.test', 'founder@example.test', PROOF_MAIL_COPY.scheduled(s(NOW + D)), { sample: true });
  assert.ok(m.subject.startsWith(SAMPLE_PREFIX));
  assert.equal(m.reply_to, MAIL_REPLY_TO);
  assert.deepEqual(m.to, ['founder@example.test']);
  assert.equal(m.from, 'Calvary Scribblings <from@example.test>');
  assert.equal(sampleMails(NOW).length, 5);
});

test('the tick script prints counts only, whatever the endpoint answers', () => {
  const line = countsLine({ open: true, scheduled: 2, failed: 0, extra: 'w@example.test', who: 'Zq3Lm8Rt2Vb6Nc1Xy4Kp7Hs9Dw0F' });
  assert.match(line, /^open=true writers=\? opening=\? scheduled=2 /);
  assert.deepEqual(findIdentifiers(line), []);
});

test('the workflow: a quarter-hourly schedule, one concurrency group, the guard on the log', () => {
  const doc = yaml.load(readFileSync(new URL('../../.github/workflows/proofs-mail.yml', import.meta.url), 'utf8'));
  const on = doc.on || doc[true];
  assert.equal(on.schedule[0].cron, '7,22,37,52 * * * *');
  assert.equal(doc.concurrency['cancel-in-progress'], false);
  const run = doc.jobs.tick.steps.map((st) => st.run || '').join('\n');
  assert.match(run, /node scripts\/proofs\/mail-tick\.mjs 2>&1 \| node scripts\/ops\/log-guard\.mjs/);
});

// ── PROOFS-R3 finish: the rulings and the designed part ───────────────────────────────────
const decode = (h) => h.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** The words of the designed body, in order: tags out, entities decoded, whitespace folded. */
function htmlWords(html) {
  const body = html.slice(html.indexOf('data-cs-body'), html.lastIndexOf('</td></tr>'));
  return decode(body.slice(body.indexOf('>') + 1).replace(/<br>/g, ' ').replace(/<\/(p|td|tr|div)>/g, ' ').replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean).join(' ');
}
const textWords = (text) => text.split(/\s+/).filter(Boolean).join(' ');
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1])).filter((u) => !u.startsWith('https://fonts.'));
const textLinks = (text) => [...text.matchAll(/https:\/\/[^\s]+[^\s.,;:)]/g)].map((m) => m[0]);

test('ruling 296: titles and the button name in single quotes, never double; the date-change line', () => {
  for (const m of sampleMails(NOW)) {
    const all = `${m.subject}\n${mailText(m.blocks)}\n${htmlWords(mailHtml(m))}`;
    assert.ok(!/[“”"]/.test(all), `${m.kind} carries a double quote`);
  }
  const ch = sampleMails(NOW).find((m) => m.kind === 'changed');
  assert.match(mailText(ch.blocks), /\nIt was due to go live \w+ \d+ \w+ at \d\d:\d\d\.\n/);
  assert.ok(!mailText(ch.blocks).includes('Before, it was'));
  assert.ok(mailText(sampleMails(NOW)[0].blocks).includes('press ‘Report a discrepancy’ on the proof'));
  assert.ok(sampleMails(NOW)[0].lines.includes('‘The Lamplighter’s Daughter’'));
});

test('the HTML and text parts carry the same words, in the same order, and the same links', () => {
  for (const m of sampleMails(NOW)) {
    const html = mailHtml(m), text = mailText(m.blocks);
    assert.equal(htmlWords(html), textWords(text.replace(/^(\d+)\. /gm, '$1. ')), `${m.kind}: words differ`);
    assert.deepEqual(hrefs(html), textLinks(text), `${m.kind}: links differ`);
    assert.ok(textLinks(text).length >= 1);
  }
});

test('built for mail clients: tables and inline styles, 600 wide, dark mode declared, no images, no SVG, no emoji', () => {
  for (const m of sampleMails(NOW)) {
    const html = mailHtml(m);
    assert.match(html, /<table role="presentation" class="cs-card" width="600"[^>]*max-width:600px/);
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.match(html, /<meta name="supported-color-schemes" content="light dark">/);
    assert.match(html, /@media \(prefers-color-scheme:dark\)/);
    assert.match(html, /\[data-ogsc\]/);
    assert.ok(!/<img|<svg|\.svg/i.test(html), 'no image: nothing is lost when images are blocked');
    assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'no emoji');
    assert.match(html, /font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif/);
    for (const a of html.match(/<a [^>]*>/g)) assert.match(a, /padding:1[24]px 0/, 'every link has its tap padding');
    // Images blocked: the words are all live text, so the stripped body still reads in full.
    assert.ok(htmlWords(html).startsWith('Hello,'));
  }
});

test('the designed part escapes what it is given', () => {
  const m = PROOF_MAIL_COPY.scheduled({ slug: 'x-y', title: 'A <b>bold</b> & "odd" title', goLiveMs: NOW + D });
  const html = mailHtml(m);
  assert.ok(html.includes('‘A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;odd&quot; title’'));
  assert.ok(!html.includes('<b>bold</b>'));
});

test('R3.1: a failure in /admin/proofs always shows the code and the message, or says the body was not ours', () => {
  const h = (m) => (k) => m[k] ?? null;
  assert.equal(failureLine(500, h({}), { error: 'Too many subrequests.', code: 'unavailable' }), 'Too many subrequests. (unavailable, HTTP 500)');
  assert.equal(failureLine(400, h({}), { error: 'Unknown action.' }), 'Unknown action. (no code, HTTP 400)');
  assert.equal(failureLine(502, h({ 'content-type': 'text/html; charset=UTF-8', 'cf-ray': '8a1b2c3d4e5f-LHR' }), null), 'HTTP 502, not from the Proofs server (text/html, ray 8a1b2c3d4e5f-LHR)');
  assert.equal(failureLine(502, h({}), null), 'HTTP 502, not from the Proofs server (no type)');
});

test('R3.1: the server never answers its own failures with 502', () => {
  for (const f of ['functions/api/proofs/writers.js', 'functions/api/proofs/mail-tick.js']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.ok(!/,\s*502\)/.test(src), `${f} still answers 502`);
  }
});
