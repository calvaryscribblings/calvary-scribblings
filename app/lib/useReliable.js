'use client';
// W2 — the React half of app/lib/reliableRead.js. Two hooks, one for each shape of read:
//
//   useReliableLoad(load, deps)        a one-shot read: `load()` returns a promise of the data
//   useReliableListener(attach, deps)  a live listener: `attach(onValue, onError)` returns unsubscribe
//
// Both return { phase, data, failure, refreshing, retry }:
//   phase 'loading' → draw the skeleton (never "0", never "nothing here")
//   phase 'failed'  → draw <Unavailable kind={failure} onRetry={retry} />
//   phase 'ready'   → draw data — which may genuinely be empty, and only then say so
//
// Content, once drawn, is never replaced by a failure: a later read that fails keeps it and tries
// again quietly with backoff (reliableRead.js, nextState). Coming back online retries anything
// that is failed or behind, without the reader pressing anything.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  READ_DEADLINE_MS, readWithDeadline, firstValueWithDeadline, classifyFailure,
  initialState, nextState, backoffFor,
} from './reliableRead';

export function useReliableLoad(load, deps = [], { deadlineMs = READ_DEADLINE_MS } = {}) {
  const [state, dispatch] = useReducer(nextState, initialState);
  // Bookkeeping that is never rendered. Refs, written only in effects — never during render.
  const stateRef = useRef(initialState);
  const loadRef = useRef(load);
  const runRef = useRef(null);
  const timers = useRef({ generation: 0, quiet: null, first: true });
  useLayoutEffect(() => { stateRef.current = state; loadRef.current = load; });

  const run = useCallback(async () => {
    const t = timers.current;
    const mine = ++t.generation;
    clearTimeout(t.quiet);
    dispatch({ type: 'start' });
    try {
      const data = await readWithDeadline(() => loadRef.current(), { deadlineMs });
      if (mine !== t.generation) return;
      dispatch({ type: 'success', data });
    } catch (err) {
      if (mine !== t.generation) return;
      const before = stateRef.current;
      console.warn('[reliable-read] failed:', err?.kind || classifyFailure(err), err?.cause || err);
      dispatch({ type: 'failure', kind: err?.kind || classifyFailure(err) });
      // Content is on screen: keep it, and try again quietly.
      if (before.phase === 'ready') t.quiet = setTimeout(() => runRef.current(), backoffFor(before.quietFailures));
    }
  }, [deadlineMs]);
  useLayoutEffect(() => { runRef.current = run; }, [run]);

  useEffect(() => {
    // A change of subject (a different user, a different slug) is a new first load.
    const t = timers.current;
    if (!t.first) dispatch({ type: 'reset' });
    t.first = false;
    run();
    return () => { t.generation++; clearTimeout(t.quiet); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(async () => { await reconnectDatabase(); run(); }, [run]);
  useOnline(() => {
    const s = stateRef.current;
    if (s.phase === 'failed' || s.quietFailures > 0) retry();
  });

  return { ...state, retry };
}

export function useReliableListener(attach, deps = [], { deadlineMs = READ_DEADLINE_MS } = {}) {
  const [state, dispatch] = useReducer(nextState, initialState);
  const [epoch, setEpoch] = useState(0);
  const stateRef = useRef(initialState);
  const attachRef = useRef(attach);
  const seen = useRef({ first: true, deps });
  useLayoutEffect(() => { stateRef.current = state; attachRef.current = attach; });

  useEffect(() => {
    const k = seen.current;
    const subjectChanged = !k.first && deps.some((d, i) => d !== k.deps[i]);
    if (subjectChanged) dispatch({ type: 'reset' });
    k.first = false;
    k.deps = deps;
    return firstValueWithDeadline((onValue, onError) => attachRef.current(onValue, onError), {
      deadlineMs,
      onValue: (data) => dispatch({ type: 'success', data }),
      onError: (err) => dispatch({ type: 'failure', kind: err.kind }),
      onTimeout: (kind) => dispatch({ type: 'failure', kind }),
    });
  }, [...deps, epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(async () => { dispatch({ type: 'start' }); await reconnectDatabase(); setEpoch((e) => e + 1); }, []);
  useOnline(() => { if (stateRef.current.phase === 'failed') retry(); });

  return { ...state, retry };
}

/**
 * RETRY RECONNECTS. A Retry the reader presses must not re-ask a connection that is already
 * dead: after a network change the SDK can sit on a socket that is open and silent, and every
 * new get() queues behind it and hangs again. goOffline/goOnline drops it and dials afresh —
 * the SDK's own documented way to force a reconnection. Only on a reader's Retry (and on coming
 * back online), never on a first load. Fire-and-forget: a failure here changes nothing.
 */
export async function reconnectDatabase() {
  try {
    const [{ getApps }, { getDatabase, goOffline, goOnline }] = await Promise.all([import('firebase/app'), import('firebase/database')]);
    const app = getApps()[0];
    if (!app) return;
    const db = getDatabase(app);
    goOffline(db);
    goOnline(db);
  } catch { /* nothing to reconnect */ }
}

/** Call `fn` when the browser comes back online. */
export function useOnline(fn) {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  useEffect(() => {
    const on = () => ref.current();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);
}
