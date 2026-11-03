// LIMITS-1 — the bulk quiz reset's loop, for /admin/quiz-resets. Pure: the call is handed in, so
// tests/limits/limits.emulator.mjs drives this exact loop against the real endpoint.
//
// The server (functions/api/admin/reset-attempt.js, action 'bulk') resets one batch per call, each
// batch one atomic write that carries its resets and their audit entries, within Cloudflare's 50
// subrequests. It answers { resetCount, remaining, more, runId }. This calls again with the runId
// until more is false, as /admin/proofs does with its send batches.
//
// A call that fails is tried again (up to BULK_RETRIES in a row): a batch either landed whole or
// not at all, and the run's audit entries stop anyone being reset twice, so retrying is safe.

export const BULK_CALLS = 200;     // 45 readers a call at most: 200 calls is 9,000 readers
export const BULK_RETRIES = 3;

/**
 * @param call(body) → Promise<{ ok, status, data }>   one POST to /api/admin/reset-attempt
 * @param opts.slug, opts.reason
 * @param opts.onProgress(n)   optional; the running total after each batch
 * @param opts.wait(ms)        optional; the pause before a retry
 * @returns {Promise<{ ok: true, count, calls } | { ok: false, count, calls, error }>}
 */
export async function runBulkReset(call, { slug, reason = null, onProgress = () => {}, wait } = {}) {
  const pause = wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let runId = null;
  let count = 0;
  let misses = 0;
  let calls = 0;
  let lastError = null;
  for (let i = 0; i < BULK_CALLS; i++) {
    calls += 1;
    let res;
    try {
      res = await call({ slug, action: 'bulk', reason: reason || null, runId });
    } catch (e) {
      res = { ok: false, status: 0, data: { error: e?.message || 'network error' } };
    }
    if (!res.ok) {
      lastError = res.data?.error || `HTTP ${res.status}`;
      // A refusal will not change by asking again; a failure might.
      if (res.status >= 400 && res.status < 500) break;
      if (++misses > BULK_RETRIES) break;
      await pause(800 * misses);
      continue;
    }
    misses = 0;
    runId = res.data?.runId ?? runId;
    count += res.data?.resetCount ?? 0;
    onProgress(count);
    if (!res.data?.more) return { ok: true, count, calls };
  }
  return { ok: false, count, calls, error: lastError || 'The reset did not finish.' };
}
