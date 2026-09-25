// W6 — the newsletter admin tells the truth (ADM-02, 03, 22, 24). The words are
// app/lib/newsletterOutcome.js; the page's use of them is pinned by source assertions. The Worker
// half is tests/ci/w6-worker.test.mjs.
//
//   node --test tests/ci/w6-newsletter.test.mjs          (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sendOutcome, retryOutcome, draftOutcome, confirmSendQuestion } from '../../app/lib/newsletterOutcome.js';

const page = readFileSync('app/admin/newsletter/page.js', 'utf8');

describe('W6 · a send says what it did', () => {
  test('ADM-03: a refused test is NOT "Test sent" — even when the old Worker answered 200', () => {
    const o = sendOutcome({ httpStatus: 200, data: { error: 'Test sends are restricted.' }, isTest: true, testEmail: 'a@b' });
    assert.equal(o.tone, 'error');
    assert.match(o.message, /^Test NOT sent — Test sends are restricted\./);
    const o2 = sendOutcome({ httpStatus: 403, data: { error: 'x is not on TEST_SEND_ALLOWLIST.' }, isTest: true });
    assert.equal(o2.tone, 'error');
  });
  test('a good test names the address', () => {
    const o = sendOutcome({ httpStatus: 200, data: { success: true, sent: 1, failed: 0 }, isTest: true, testEmail: 'me@x' });
    assert.deepEqual([o.tone, o.message], ['success', 'Test sent to me@x.']);
  });
  test('a partial send says how many went and how many did not, and offers the retry', () => {
    const o = sendOutcome({ httpStatus: 200, data: { success: true, sent: 70, failed: 50, sendId: '-P1' }, isTest: false });
    assert.equal(o.tone, 'partial');
    assert.match(o.message, /^Sent to 70 subscribers; 50 emails did NOT go\./);
    assert.equal(o.retrySendId, '-P1');
  });
  test('a total failure is an error with the counts', () => {
    const o = sendOutcome({ httpStatus: 502, data: { error: 'The mail service refused every batch.', sent: 0, failed: 55, sendId: '-P2' }, isTest: false });
    assert.equal(o.tone, 'error');
    assert.match(o.message, /0 went, 55 did not\./);
    assert.equal(o.retrySendId, '-P2');
  });
  test('success only when every email went', () => {
    const o = sendOutcome({ httpStatus: 200, data: { success: true, sent: 55, failed: 0 }, isTest: false });
    assert.equal(o.message, 'Newsletter sent to 55 subscribers. None failed.');
  });
  test('retry and draft outcomes', () => {
    assert.equal(retryOutcome({ httpStatus: 200, data: { success: true, sent: 50, stillFailed: 0 } }).tone, 'success');
    assert.equal(retryOutcome({ httpStatus: 200, data: { success: true, sent: 40, stillFailed: 10 } }).tone, 'partial');
    assert.equal(draftOutcome({ httpStatus: 502, data: { error: 'The draft was not deleted.' }, action: 'delete' }).tone, 'error');
    assert.equal(draftOutcome({ httpStatus: 200, data: { success: true }, action: 'save', scheduledLabel: 'Thu 1 Oct, 09:00 (London)' }).message,
      'Draft saved. It is still scheduled for Thu 1 Oct, 09:00 (London).');
  });
});

describe('W6 · the full send asks first, naming the count (ADM-02)', () => {
  test('the question', () => {
    assert.equal(confirmSendQuestion(55), 'Send to 55 subscribers?');
    assert.equal(confirmSendQuestion(1), 'Send to 1 subscriber?');
  });
  test('the page: the full send opens a confirmation; only its button mails', () => {
    const handle = page.slice(page.indexOf('  function handleSend(isTest) {'), page.indexOf('  async function doSend(isTest) {'));
    assert.match(handle, /setConfirmOpen\(true\);/);
    assert.doesNotMatch(handle, /fetch\("\/api\/newsletter\/send"/, 'handleSend itself never mails the list');
    assert.match(page, /role="dialog" aria-modal="true"/);
    assert.match(page, /\{confirmSendQuestion\(subscriberCount\)\}/);
    assert.match(page, /onClick=\{\(\) => doSend\(false\)\}/);
    assert.match(page, /Mail cannot be recalled once it is sent\./);
  });
  test('no count, no send: the button is disabled while the subscriber count is unknown', () => {
    assert.match(page, /disabled=\{status === "loading" \|\| !Number\.isFinite\(subscriberCount\)\}/);
  });
});

describe('W6 · scheduling (ADM-22)', () => {
  test('the schedule is sent as UTC ISO from London wall time, and Save keeps it', () => {
    assert.match(page, /schedule = londonWallToUtcIso\(scheduledAt\);/);
    assert.match(page, /\} else if \(intent === "save"\) \{\n\s*schedule = draftSchedule;/);
    assert.match(page, /handleSaveDraft\("unschedule"\)/);
  });
  test('a full send from a draft passes its id, so the Worker locks it', () => {
    assert.match(page, /draftId: !isTest && draftId \? draftId : undefined,/);
  });
});

describe('W6 · failed loads are drawn (ADM-24)', () => {
  test('subscribers, drafts and history each render the house panel on failure', () => {
    assert.match(page, /\.catch\(\(e\) => \{ setSubscriberCount\(null\); failed\("subscribers"\)\(e\); \}\);/);
    assert.match(page, /\.catch\(failed\("drafts"\)\);/);
    assert.match(page, /\.catch\(failed\("history"\)\);/);
    assert.match(page, /kind=\{loadFail\.history\} subject="the send history"/);
  });
  test('the drafts proxy answer is checked, not assumed', () => {
    assert.match(page, /if \(!r\.ok\) throw new Error\(`drafts: HTTP \$\{r\.status\}`\);/);
  });
  test('newsletter_sends is readable by the founders (it had no rule, so the read was always denied)', () => {
    const rules = JSON.parse(readFileSync('database.rules.json', 'utf8')).rules;
    assert.match(rules.newsletter_sends['.read'], /XaG6bTGqdDXh7VkBTw4y1H2d2s82/);
    assert.equal(rules.newsletter_sends['.write'], false);
  });
});
