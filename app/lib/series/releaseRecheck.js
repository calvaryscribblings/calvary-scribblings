// W35 — AN OPEN SERIES PAGE ASKS AGAIN AT THE RELEASE MINUTE.
//
// Every Series surface reads its rows once, at load, against the clock of that moment. A reader
// who opened an instalment at 08:58 for a 09:00 release saw "This instalment hasn't arrived yet"
// until they reloaded — the page had no idea the minute had come.
//
// So each surface that is currently SHOWING an unreleased instalment hands this module the
// release instants it is waiting on, and gets its load function called again:
//
//   · at the earliest of those instants, plus RECHECK_SLACK_MS;
//   · whenever the tab becomes visible again and one of them has passed (a background tab's
//     timers are throttled, and a laptop lid stops them altogether);
//   · and, if the re-read still says "not yet" after the instant has passed — the device clock
//     is ahead of the server's, or the read raced the rule — again on a short backoff, for a
//     bounded number of tries.
//
// ⛔ IT ONLY ASKS AGAIN. The release gate is the RTDB rule on series_instalments_detail and the
// stream endpoint's own check, both against the SERVER's clock. Nothing here decides who may
// read anything; a recheck that fires early gets the same refusal a reload would have.
//
// ⛔ setTimeout STORES ITS DELAY AS A SIGNED 32-BIT INT. A delay over 2^31-1 ms (~24.8 days)
// overflows and fires IMMEDIATELY — so a release a month away would re-read the page in a
// tight loop. A far release is approached in steps of at most MAX_STEP_MS, re-planning at each
// step without calling the load.

import { useEffect, useLayoutEffect, useRef } from 'react';

/** The largest delay setTimeout honours. Anything above it fires at once. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** How far one timer reaches toward a distant release before re-planning. One day. */
export const MAX_STEP_MS = 24 * 60 * 60 * 1000;
/** After the instant, a beat for the server's clock and the write path to agree. */
export const RECHECK_SLACK_MS = 1500;
/** The retry ladder once an instant has passed and the surface still shows it unreleased. */
export const RETRY_BASE_MS = 5000;
export const RETRY_CAP_MS = 60000;
export const MAX_RETRIES = 8;

/**
 * Plan the next timer. Pure.
 *
 * @param {number[]} pending  release instants (epoch ms) of instalments the surface is
 *                            currently drawing as not arrived
 * @param {number}   now
 * @param {number}   retries  how many re-reads have already fired for this same set
 * @returns {null | { delay: number, fire: boolean }}  fire:false = a step toward a far
 *          release; wake, re-plan, do not reload
 */
export function planRecheck(pending, now, retries = 0) {
  const times = (pending || []).filter((t) => typeof t === 'number' && Number.isFinite(t));
  if (!times.length) return null;

  const future = times.filter((t) => t > now);
  const overdue = times.length > future.length;

  let plan = null;
  if (future.length) {
    const delay = Math.min(...future) - now + RECHECK_SLACK_MS;
    plan = delay > MAX_STEP_MS ? { delay: MAX_STEP_MS, fire: false } : { delay, fire: true };
  }
  if (overdue && retries < MAX_RETRIES) {
    const backoff = Math.min(RETRY_BASE_MS * 2 ** retries, RETRY_CAP_MS);
    if (!plan || backoff < plan.delay) plan = { delay: backoff, fire: true };
  }
  if (plan) plan.delay = Math.max(0, Math.min(plan.delay, MAX_TIMEOUT_MS));
  return plan;
}

/**
 * Call `onDue` when one of `pending` arrives, and when the tab comes back after one has.
 *
 * `pending` is recomputed by the caller on every render from what it is DRAWING; when a
 * re-read shows the instalment released it drops out of the list and the timers stop by
 * themselves. An empty list arms nothing.
 */
export function useReleaseRecheck(pending, onDue) {
  const key = (pending || [])
    .filter((t) => typeof t === 'number' && Number.isFinite(t))
    .sort((a, b) => a - b)
    .join(',');
  const onDueRef = useRef(onDue);
  useLayoutEffect(() => { onDueRef.current = onDue; });

  useEffect(() => {
    if (!key) return undefined;
    const times = key.split(',').map(Number);
    let retries = 0;
    let timer = null;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timer);
      const plan = planRecheck(times, Date.now(), retries);
      if (!plan) return;
      timer = setTimeout(() => {
        if (stopped) return;
        if (plan.fire) fire();
        else schedule();
      }, plan.delay);
    };
    function fire() {
      retries += 1;
      onDueRef.current?.();
      // Re-armed in case the re-read still shows the same set — the clock-skew case. If it
      // shows the instalment released, `key` changes, this effect is torn down, and the
      // timer below is cleared with it.
      schedule();
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (times.some((t) => t <= Date.now())) fire();
      else schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);
}
