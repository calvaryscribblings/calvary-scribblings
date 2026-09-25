// WHAT A NEWSLETTER ACTION ACTUALLY DID — W6 (ADM-02, ADM-03, ADM-22). Pure, so the words are
// tested apart from the page.
//
// THE RULE: no action reports success unless everything it set out to do succeeded. A partial
// send says how many went and how many did not, and offers to retry exactly those. Before W6 the
// admin checked only `res.ok`, and the Worker answered its refusals with HTTP 200 and an `error`
// field — so a test to an address the allowlist refused read "Test sent", and nothing arrived.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {object} o
 * @param {number} o.httpStatus   the response status
 * @param {object|null} o.data    the parsed body (null if it would not parse)
 * @param {boolean} o.isTest
 * @param {string} [o.testEmail]
 * @returns {{ tone: 'success'|'partial'|'error', message: string, retrySendId: string|null }}
 */
export function sendOutcome({ httpStatus, data, isTest, testEmail = '' }) {
  const d = data && typeof data === 'object' ? data : null;
  const sent = Number.isFinite(d?.sent) ? d.sent : 0;
  const failed = Number.isFinite(d?.failed) ? d.failed : 0;
  const ok = httpStatus >= 200 && httpStatus < 300 && d && !d.error && d.success === true;

  if (!ok) {
    const why = d?.error || (d ? `the server answered ${httpStatus}` : `the server answered ${httpStatus} with no readable reply`);
    const counts = sent || failed ? ` ${sent} went, ${failed} did not.` : '';
    return {
      tone: 'error',
      message: isTest ? `Test NOT sent — ${why}.${counts}` : `Newsletter NOT sent — ${why}.${counts}`,
      retrySendId: !isTest && failed > 0 && d?.sendId ? d.sendId : null,
    };
  }
  if (isTest) {
    if (sent === 1 && failed === 0) {
      const open = d.allowlistOpen ? ' (Note: the test allowlist is not configured on the Worker.)' : '';
      return { tone: 'success', message: `Test sent to ${testEmail}.${open}`, retrySendId: null };
    }
    return { tone: 'error', message: `Test NOT sent to ${testEmail} — the mail service refused it.`, retrySendId: null };
  }
  if (failed > 0) {
    return {
      tone: 'partial',
      message: `Sent to ${plural(sent, 'subscriber', 'subscribers')}; ${plural(failed, 'email', 'emails')} did NOT go. They can be retried — only they will be mailed.`,
      retrySendId: d.sendId || null,
    };
  }
  return { tone: 'success', message: `Newsletter sent to ${plural(sent, 'subscriber', 'subscribers')}. None failed.`, retrySendId: null };
}

/** The confirmation's question. It names the count, because a full send cannot be recalled. */
export function confirmSendQuestion(count) {
  return `Send to ${plural(count, 'subscriber', 'subscribers')}?`;
}

/** A retry of the ones that failed. */
export function retryOutcome({ httpStatus, data }) {
  const d = data && typeof data === 'object' ? data : null;
  if (!(httpStatus >= 200 && httpStatus < 300) || !d || d.error) {
    return { tone: 'error', message: `Retry NOT sent — ${d?.error || `the server answered ${httpStatus}`}.`, retrySendId: null };
  }
  const still = Number.isFinite(d.stillFailed) ? d.stillFailed : (d.failed || 0);
  if (still > 0) {
    return { tone: 'partial', message: `Retry sent ${plural(d.sent || 0, 'email', 'emails')}; ${plural(still, 'is', 'are')} still failing.`, retrySendId: null };
  }
  return { tone: 'success', message: `Retry sent all ${plural(d.sent || 0, 'email', 'emails')}. Everyone on the list now has this issue.`, retrySendId: null };
}

/** A draft save / schedule / unschedule / delete, from the proxy's answer. */
export function draftOutcome({ httpStatus, data, action, scheduledLabel = '' }) {
  const d = data && typeof data === 'object' ? data : null;
  if (!(httpStatus >= 200 && httpStatus < 300) || !d || d.error || d.success !== true) {
    const what = { save: 'Draft NOT saved', schedule: 'NOT scheduled', unschedule: 'NOT unscheduled', delete: 'Draft NOT deleted' }[action] || 'NOT done';
    return { tone: 'error', message: `${what} — ${d?.error || `the server answered ${httpStatus}`}.` };
  }
  const done = {
    save: scheduledLabel ? `Draft saved. It is still scheduled for ${scheduledLabel}.` : 'Draft saved. It is not scheduled.',
    schedule: `Scheduled for ${scheduledLabel}.`,
    unschedule: 'Unscheduled. It is now a draft and will not be sent.',
    delete: 'Draft deleted.',
  }[action] || 'Done.';
  return { tone: 'success', message: done };
}
