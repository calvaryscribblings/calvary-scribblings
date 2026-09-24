// W2 — EVERY BROWSER READ HAS A DEADLINE, AND A FAILED READ NEVER LOOKS EMPTY.
//
// The build learnt this in PL-12 (app/lib/build-read.mjs): a Firebase get() against an
// unreachable database NEVER SETTLES. It neither resolves nor rejects, so a page awaiting it sits
// on its skeleton for good, and a page that catches it and falls back to [] tells a reader the
// island is empty. The audit found both shapes on every tab of the spine (BS-01/02/03, LIB-01,
// SRCH-01, STORY-04, SER-01, HOME-05, SQ-03, ACC-06). This module is the browser's half of the
// same fix, and there is one of it so every surface fails the same way.
//
// THREE RULES, each a function below:
//
//   1. A DEADLINE turns a hang into a failure (readWithDeadline, firstValueWithDeadline).
//   2. A failure has a KIND — offline, slow, or ours — so the page can say what happened and what
//      to do next (classifyFailure). "Empty" is never a kind: an empty answer is a SUCCESS.
//   3. RENDERED CONTENT STAYS (loadState / nextState). Only the FIRST load may show a failure. Once
//      a page has drawn its content, a later read that fails keeps what is on screen and retries
//      quietly with backoff. The app hit exactly this on 24 Sep: its unreachable screen replaced an
//      open story every ~2 minutes.
//
// The React half is app/lib/useReliable.js; the drawn state is app/components/Unavailable.js.
// This file has no React and no Firebase import, so node tests load it directly.

/**
 * How long a read may take before it is a failure. CHOSEN, NOT DERIVED: the slowest healthy read
 * the audit measured was the Book Store gate read at 4.8s on Lighthouse's Fast 3G profile
 * (BS-01), and 12s is two and a half times that — long enough that a slow-but-working phone is
 * never told it failed, short enough that a reader is not left looking at a skeleton.
 */
export const READ_DEADLINE_MS = 12000;

/** Quiet background retries after content is on screen: 5s, 10s, 20s, 40s, then every 60s. */
export const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];
export const backoffFor = (attempt) => BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];

export const FAILURE_KINDS = ['offline', 'slow', 'ours'];

/** A read that failed, with the kind the page shows. `cause` is kept for the console, never shown. */
export class ReadFailure extends Error {
  constructor(kind, cause) {
    super(`read failed: ${kind}`);
    this.name = 'ReadFailure';
    this.kind = kind;
    this.cause = cause;
  }
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * offline — the device says it has no connection, or Firebase says the client is offline.
 * slow    — the deadline passed with no answer (a hang, which is what "unreachable" looks like).
 * ours    — anything else: a refusal by the rules, a 5xx, a malformed answer. Not the reader's doing.
 */
export function classifyFailure(err, { offline = isOffline() } = {}) {
  if (err instanceof ReadFailure) return err.kind;
  const msg = String(err?.message || err || '').toLowerCase();
  if (offline || msg.includes('client is offline') || msg.includes('network') || msg.includes('failed to fetch')) return 'offline';
  if (err?.name === 'DeadlineError' || msg.includes('deadline')) return 'slow';
  return 'ours';
}

class DeadlineError extends Error {
  constructor(ms) { super(`deadline exceeded after ${ms}ms`); this.name = 'DeadlineError'; }
}

/**
 * Run `read()` (a function returning a promise — a get(), a fetch, several of them) under a
 * deadline. Resolves with its value, or rejects with a ReadFailure whose kind says why.
 */
export async function readWithDeadline(read, { deadlineMs = READ_DEADLINE_MS } = {}) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new DeadlineError(deadlineMs)), deadlineMs); });
  try {
    return await Promise.race([Promise.resolve().then(read), deadline]);
  } catch (err) {
    throw new ReadFailure(classifyFailure(err), err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A LISTENER cannot reject — an onValue against an unreachable database simply never fires. So its
 * deadline is on the FIRST value: `attach(onValue, onError)` subscribes and returns an unsubscribe;
 * `onTimeout(kind)` is called once if nothing has arrived by the deadline. The listener stays
 * attached either way, so a value that arrives late still lands (and clears the failure).
 * Returns a function that detaches the listener and cancels the deadline.
 */
export function firstValueWithDeadline(attach, { onValue, onError, onTimeout, deadlineMs = READ_DEADLINE_MS }) {
  let arrived = false;
  const timer = setTimeout(() => { if (!arrived) onTimeout(isOffline() ? 'offline' : 'slow'); }, deadlineMs);
  const unsubscribe = attach(
    (value) => { arrived = true; clearTimeout(timer); onValue(value); },
    (err) => { clearTimeout(timer); onError(new ReadFailure(classifyFailure(err), err)); },
  );
  return () => { clearTimeout(timer); if (typeof unsubscribe === 'function') unsubscribe(); };
}

// ── THE STATE MACHINE (pure, so the rule "rendered content stays" is testable without React) ──
//
//   phase     'loading' → first attempt in flight, nothing drawn yet
//             'ready'   → content is on screen (data may be an empty list: that is a real answer)
//             'failed'  → the FIRST load failed; the page draws <Unavailable kind=…>
//   refreshing  true while a retry is in flight (the Retry button shows it)
//   quietFailures  how many background refreshes have failed since content was drawn
export const initialState = { phase: 'loading', data: undefined, failure: null, refreshing: false, quietFailures: 0 };

export function nextState(state, event) {
  switch (event.type) {
    case 'reset':
      return initialState;
    case 'start':
      return { ...state, refreshing: state.phase !== 'loading' };
    case 'success':
      return { phase: 'ready', data: event.data, failure: null, refreshing: false, quietFailures: 0 };
    case 'failure':
      // THE RULE. Content already drawn is never replaced by a failure.
      if (state.phase === 'ready') return { ...state, refreshing: false, quietFailures: state.quietFailures + 1 };
      return { ...state, phase: 'failed', failure: event.kind, refreshing: false };
    default:
      return state;
  }
}
