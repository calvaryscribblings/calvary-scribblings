// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERY READ THE BUILD MAKES GOES THROUGH HERE — PL-12
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The static export cannot be produced without reading Firebase. `output:'export'` means every
// dynamic route enumerates its paths at BUILD time, so a shop, a library, a roster of voices
// and a series all exist or do not exist according to what one network read returns on a
// machine in Cloudflare's build fleet. That is the whole of PL-12, and it is the only known
// item that can break the launch deploy.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⛔ THE DEADLINE IS NOT BELT-AND-BRACES. IT IS THE FIX. DO NOT REMOVE IT.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// MEASURED, 27 August 2026, before any of this was written:
//
//   `firebase/database`'s get() DOES NOT REJECT WHEN THE DATABASE IS UNREACHABLE.
//   It does not reject slowly. It does not reject eventually. It never settles.
//
//     DNS does not resolve        still pending at 75s
//     connection refused (RST)    still pending at 75s
//     unroutable, packets dropped still pending at 75s
//
//   And the whole build with the DB host pointed at a black hole:
//
//     $ timeout 420 npx next build
//     Terminated                  ← 420 seconds, no output, no error, no exit
//     out/ entries: 0
//
// ⭑ THE CONSEQUENCE, WHICH IS THE THING TO UNDERSTAND BEFORE EDITING THIS FILE: every
// `try/catch` around a build-time read in this repo WAS DEAD CODE for the failure that
// actually threatens a deploy. A catch cannot run for a promise that never settles. The
// generators looked like they degraded gracefully; measured, they did not degrade at all,
// because they never got the chance. The build simply stopped, and whatever Cloudflare
// eventually says about it is a message about a timeout, not about Firebase.
//
// SO THE ORDER MATTERS AND IT IS THE OPPOSITE OF THE OBVIOUS ONE. A retry wrapped around a
// call that never settles retries nothing — it waits for ever on the first attempt. The
// DEADLINE comes first and turns a hang into an error; the RETRY sits on top of it and turns a
// transient error into a completed read. Remove the deadline and the retry becomes decoration.
//
// ── EMPTY IS NOT UNREACHABLE, AND THEY GET SEPARATE PATHS ────────────────────────────────
//
// This module answers exactly one question: DID THE READ COMPLETE? It returns whatever the
// read returned — including nothing — and the caller decides what nothing means.
//
// That split is the second half of PL-12's defect. Every generator had ONE try/catch covering
// both, so "the CMS says there are no titles yet" and "the CMS could not be reached" arrived at
// the same line of code and produced the same output. They are opposite facts. A successful
// read returning nothing is a VALID ANSWER and stays green — it is the launch-day state, and it
// is what the sentinel slugs exist for. A read that could not be COMPLETED fails the build.
//
// ⚠ AN ACCEPTED BOUNDARY, DECIDED RATHER THAN MISSED: an empty-but-successful `cms_stories`
// therefore builds a green, empty library. Ikenna ruled on 27 Aug that there is NO FLOOR on the
// story count — "a threshold I invent today becomes a false alarm the first time it is
// legitimately low, and a number nobody can defend is worse than no number." If a floor is ever
// wanted it is his call, not a tidy-up.
//
// ── WHY process.exit(1) AND NOT A THROW ──────────────────────────────────────────────────
//
// Measured: a `process.exit(1)` from inside generateStaticParams gives `next build` exit code 1,
// leaves out/ EMPTY, and passes our own stdout through verbatim:
//
//     PROBE-MESSAGE-ON-STDOUT
//     ⨯ Next.js build worker exited with code: 1 and signal: null
//     out entries: 0
//
// A throw would be caught by whatever catch is above it — which is precisely how this defect
// hid for so long — and Next would re-describe it in its own words. The exit is the only route
// that guarantees all three of: non-zero exit, our reason on stdout, nothing partial in out/.

import { writeSync } from 'node:fs';

// ── THE NUMBERS ─────────────────────────────────────────────────────────────────────────────
export const BUILD_READ = {
  // FOUR ATTEMPTS. A deploy is triggered by a CMS mutation and is not watched by anyone, so the
  // cost of one more attempt is seconds and the cost of one fewer is a failed launch-day
  // deploy that a human has to notice and re-run.
  attempts: 4,

  // TWENTY SECONDS PER ATTEMPT. Measured against the live database on this container, cold:
  // cms_stories 313ms, bookstore_titles 13ms, and a permission-denied rejection in 10ms. Twenty
  // seconds is roughly sixty times the slowest real read. It is deliberately generous — this
  // deadline exists to convert an INFINITE hang into an error, not to police latency, and a
  // deadline tight enough to trip on a slow-but-working link would be a new way to fail a
  // deploy rather than a fix for the old one.
  timeoutMs: 20000,

  // 1s, 3s, 8s between the four attempts. Twelve seconds of waiting in total, which is what a
  // brief blip costs and what a regional outage will not be cured by. Worst case for one read
  // is 4 × 20s + 12s ≈ 92s, and the first read to exhaust its attempts ends the build, so 92s
  // is the ceiling for the whole mechanism rather than a per-site cost.
  backoffMs: [1000, 3000, 8000],
};

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * The deadline itself.
 *
 * ⚠ THE LOSING PROMISE IS ABANDONED, NOT CANCELLED, and that is not an oversight — there is no
 * way to cancel a `get()`. Its socket stays open and can keep Node alive. That is harmless on
 * the failing path (we exit the process) and it is why the two DEGRADING callers below are
 * documented as needing an explicit process.exit at the end of their scripts.
 */
function withDeadline(promise, ms, what) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`deadline exceeded — ${what} did not complete within ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Written with writeSync(1, …) rather than console.log. process.exit() does not flush an
// asynchronous stdout pipe, and a build log that ends mid-sentence — or without the reason at
// all — would put the next reader back where this round started.
const out = (s) => { try { writeSync(1, `${s}\n`); } catch { /* stdout is gone; nothing to do */ } };

/**
 * ⛔ THE MESSAGE, AND THE ONE IT EXISTS TO REPLACE.
 *
 * Before PL-12, a failed catalogue read reached a human as:
 *
 *     Error: Page "/reader/[slug]" is missing "generateStaticParams()" so it cannot be used
 *     with "output: export" config.
 *
 * — because the catch returned an empty array and `output:'export'` rejects that. THAT MESSAGE
 * IS A LIE ABOUT THE CAUSE. The function was not missing. It ran, it was handed nothing by a
 * network that did not answer, and it said so to a log nobody reads. Ikenna's ruling of 27 Aug:
 * that misdirection cost this round its diagnosis and must not survive the fix. So the words
 * FIREBASE and the route are both in the first two lines, and the old message is named and
 * disowned explicitly.
 */
function failLoudly(what, needs, lastError) {
  const line = '═'.repeat(78);
  out('');
  out(line);
  out('  BUILD FAILED — FIREBASE COULD NOT BE READ');
  out(line);
  out('');
  out(`  what could not be read : ${what}`);
  out(`  what needs it          : ${needs}`);
  out(`  attempts               : ${BUILD_READ.attempts}, each with a ${BUILD_READ.timeoutMs / 1000}s deadline,`
    + ` backing off ${BUILD_READ.backoffMs.map((m) => `${m / 1000}s`).join(' / ')}`);
  out(`  last failure           : ${lastError?.message || String(lastError)}`);
  out('');
  out('  THIS IS NOT A MISSING generateStaticParams(). The generator ran. Firebase did not');
  out('  answer it. A build that cannot read the catalogue must not publish a diminished');
  out('  site — a shelf whose books have no detail pages looks fine and is broken.');
  out('');
  out('  Nothing has been written to out/. No deploy can pick this up.');
  out('  Re-run the build once Firebase is reachable; nothing here needs changing.');
  out(line);
  out('');
  process.exit(1);
}

/**
 * A build-time read that MUST succeed.
 *
 * @param what  the node, in the words the database uses — it goes in the failure message
 * @param needs the route or artefact that cannot be built without it
 * @param read  () => Promise<T>, called afresh on every attempt
 * @returns whatever `read` resolved to, INCLUDING an empty result. See the header: empty is a
 *          valid answer and this function does not judge it. The caller does.
 */
export async function buildRead(what, needs, read) {
  let lastError = null;
  for (let attempt = 1; attempt <= BUILD_READ.attempts; attempt += 1) {
    try {
      return await withDeadline(read(), BUILD_READ.timeoutMs, what);
    } catch (e) {
      lastError = e;
      if (attempt < BUILD_READ.attempts) {
        const wait = BUILD_READ.backoffMs[attempt - 1] ?? BUILD_READ.backoffMs.at(-1);
        out(`[build-read] ${what}: attempt ${attempt}/${BUILD_READ.attempts} failed`
          + ` (${e?.message || e}) — retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  return failLoudly(what, needs, lastError);
}

/**
 * ⚠ A build-time read that is ALLOWED to fail — and there is exactly ONE reason left.
 *
 * Ikenna's ruling of 27 August 2026 is that a build which cannot read the catalogue FAILS. This
 * function is the named, argued exception to it, and `why` is mandatory so that another one
 * cannot be added without writing down the argument for it:
 *
 *   · app/lib/gateway-build.js and scripts/generate-gateway-wall.mjs — DECORATION. The story
 *     count, the rotating whispers and the cover mosaic behind the gateway hero. The gateway
 *     stands without them; nothing 404s and no page loses a link.
 *
 * ── THE SECOND EXCEPTION IS GONE, AND ITS ARGUMENT WAS BACKWARDS (R24.1, 27 Aug 2026) ───────
 *
 * app/u/[handle]/page.js used to be here, on the reasoning that "a static page at /u/<handle>
 * SHADOWS the /u/:handle → /user?handle=:handle rule, so emitting fewer pages costs a redirect
 * hop, not a destination". The premise was measured and it is FALSE. Cloudflare applies a
 * _redirects rule whether or not an asset matches: `/u/5yh7sr997w` — a handle that HAD a
 * prerendered page — 301'd to /user?handle=5yh7sr997w on the live site. The static pages never
 * shadowed the rule; the rule shadowed them, and all 98 of them had never been served.
 *
 * So the exception was not merely unnecessary, it was arguing for the weaker of the two. The
 * redirect covers every handle including ones created since the last deploy — which is the very
 * degrade path this note was written to protect — and /user?handle= resolves the handle live
 * and shows an honest "User not found." when it does not resolve. The route, its read and its
 * 5.4 MB of dead export are gone. The redirect is the product.
 *
 * Everything else fails. If you are about to add another caller, the question to answer first
 * is: what does a reader see when this data is missing? If the answer is "a link that 404s" or
 * "a shelf whose items do not open", it is not a candidate — that is the exact failure PL-12
 * exists to prevent. And if the answer is "an edge rule covers it", CHECK THAT IT DOES: the
 * exception removed above is what an unchecked one looks like.
 *
 * ⚠ IT STILL CARRIES THE DEADLINE AND THE RETRIES. Degrading is about the OUTCOME, never about
 * the waiting: without the deadline these two would hang the build just as thoroughly as a
 * required read, and a hang is not a degraded build, it is no build at all.
 */
export async function buildReadOptional(what, fallback, why, read) {
  if (!why) throw new Error('buildReadOptional requires a written reason — see the note above.');
  let lastError = null;
  for (let attempt = 1; attempt <= BUILD_READ.attempts; attempt += 1) {
    try {
      return await withDeadline(read(), BUILD_READ.timeoutMs, what);
    } catch (e) {
      lastError = e;
      if (attempt < BUILD_READ.attempts) await sleep(BUILD_READ.backoffMs[attempt - 1] ?? BUILD_READ.backoffMs.at(-1));
    }
  }
  out(`[build-read] ${what}: unreadable after ${BUILD_READ.attempts} attempts`
    + ` (${lastError?.message || lastError}). DEGRADING — ${why}`);
  return fallback;
}

/**
 * The REST half. The two pre-build scripts read over HTTP rather than through the SDK, for the
 * reason they both state: the SDK holds a WebSocket open and Node will not exit, which hangs
 * the build after the read has already succeeded.
 *
 * ⚠ `fetch` WITHOUT A SIGNAL HAS THE SAME DEFECT AS get(). It does not hang for ever — it waits
 * on the OS connect timeout, which is minutes — but "minutes, then a generic failure" is the
 * same class of problem, so the deadline is explicit here rather than inherited from the kernel.
 *
 * A non-2xx is an ERROR, not an empty result. That distinction is the whole of ruling 2: a 500
 * is Firebase failing to answer, and treating it as "no stories" is what silently dropped 326
 * legacy redirects.
 */
export function fetchJsonWithDeadline(url, ms = BUILD_READ.timeoutMs) {
  return (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    // A truncated or non-JSON body throws here, and it must: malformed is unreadable, not empty.
    return res.json();
  })();
}
