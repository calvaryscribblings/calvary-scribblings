// R48 — THE FLAG MATRIX, PROVED IN THE SHIPPED BYTES.
//
//   node tests/applinks/matrix.mjs
//
// ⚠ THIS IS THE ONLY TEST THAT CAN SEE THE FOUR FLAG STATES, and it is slow on purpose.
//
// IOS_APP_LIVE and ANDROID_APP_LIVE are build-time constants in app/lib/appLinks.js, and
// liveStores() branches on them with `if (CONSTANT)` so that SWC folds the dead branch and
// deletes the unlive store's URL from the bundle. That design is what makes the guarantee real
// — and it is also why no unit test can reach it: there is exactly one observable behaviour
// per build. A first attempt parameterised the flags so a unit test COULD walk all four; it
// passed, and shipped the Google Play URL in three JS chunks with Android in review.
//
// So this script does the only thing that actually answers the question: it rewrites the two
// constants, runs a real `next build`, and greps out/ for the URLs. Four builds, ~3 minutes
// each. It restores the file afterwards — including on failure, including on Ctrl-C.
//
// WHAT IT ASSERTS, per state:
//   · a store whose flag is FALSE has NO URL anywhere in out/ — not in a page, not in a chunk
//   · a store whose flag is TRUE has its URL in out/, so the test cannot pass by building
//     nothing (the non-vacuous half — a broken build would otherwise "pass" every absence)
//   · with both false, NEITHER URL appears anywhere at all
//   · NO STATE puts a store URL under out/bookstore/ — the 3.1.1 rule, checked in all four
//
// ⭑ RUN THIS BEFORE FLIPPING ANDROID_APP_LIVE, and again after.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = resolve(ROOT, 'app/lib/appLinks.js');

const IOS_URL = 'https://apps.apple.com/gb/app/story-island/id6769357370';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=uk.co.storyisland.app';

const STATES = [
  { ios: false, android: false, name: 'both flags FALSE — the app does not exist yet' },
  { ios: true, android: false, name: 'iOS only — TODAY, Android in Play review' },
  { ios: false, android: true, name: 'Android only — the mirror image' },
  { ios: true, android: true, name: 'both live — Play approval day' },
];

/** grep -rl over out/, returning the matching paths. Empty array when nothing matches. */
async function filesContaining(needle, dir = 'out') {
  try {
    // -F: the URLs carry ? and . — a fixed-string search, never a regex.
    const { stdout } = await run('grep', ['-rlF', needle, dir], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split('\n').filter(Boolean);
  } catch (e) {
    if (e.code === 1) return [];       // grep's "no match"
    throw e;
  }
}

const original = await readFile(MODULE, 'utf8');
let restored = false;
const restore = async () => {
  if (restored) return;
  restored = true;
  await writeFile(MODULE, original, 'utf8');
  console.log('\n  appLinks.js restored to its committed state.');
};
// ⚠ RESTORE ON EVERY EXIT PATH. This script edits a source file that is committed; leaving a
// mutated flag behind after a Ctrl-C would be a far worse bug than anything it tests for.
process.on('SIGINT', async () => { await restore(); process.exit(130); });
process.on('SIGTERM', async () => { await restore(); process.exit(143); });

const failures = [];
const note = (ok, line) => { console.log(`     ${ok ? '✓' : '✗'} ${line}`); if (!ok) failures.push(line); };

try {
  // Sanity: the committed file must be in a shape this script can rewrite, or every "absence"
  // below would pass for the wrong reason.
  for (const re of [/export const IOS_APP_LIVE = (true|false);/, /export const ANDROID_APP_LIVE = (true|false);/]) {
    if (!re.test(original)) {
      console.error(`appLinks.js does not match ${re} — the matrix cannot rewrite the flags.`);
      process.exit(1);
    }
  }

  for (const st of STATES) {
    console.log(`\n── ${st.name}`);
    console.log(`   IOS_APP_LIVE=${st.ios}  ANDROID_APP_LIVE=${st.android}`);
    const mutated = original
      .replace(/export const IOS_APP_LIVE = (?:true|false);/, `export const IOS_APP_LIVE = ${st.ios};`)
      .replace(/export const ANDROID_APP_LIVE = (?:true|false);/, `export const ANDROID_APP_LIVE = ${st.android};`);
    await writeFile(MODULE, mutated, 'utf8');

    process.stdout.write('   building… ');
    const t0 = Date.now();
    try {
      await run('npm', ['run', 'build'], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024, timeout: 900_000 });
    } catch (e) {
      console.log('FAILED');
      failures.push(`${st.name}: the build itself failed — ${String(e.stderr || e.message).slice(0, 400)}`);
      continue;
    }
    console.log(`${Math.round((Date.now() - t0) / 1000)}s`);

    const iosFiles = await filesContaining(IOS_URL);
    const playFiles = await filesContaining(PLAY_URL);

    // ── ABSENCE, which is the guarantee ──────────────────────────────────────────────────
    if (!st.ios) note(iosFiles.length === 0, `no App Store URL anywhere in out/ (found ${iosFiles.length}: ${iosFiles.slice(0, 4).join(', ')})`);
    if (!st.android) note(playFiles.length === 0, `no Google Play URL anywhere in out/ (found ${playFiles.length}: ${playFiles.slice(0, 4).join(', ')})`);

    // ── PRESENCE, which is what stops an absence passing vacuously ───────────────────────
    if (st.ios) note(iosFiles.length > 0, `the App Store URL IS in out/ (${iosFiles.length} files)`);
    if (st.android) note(playFiles.length > 0, `the Google Play URL IS in out/ (${playFiles.length} files)`);

    // ── AND THE 3.1.1 RULE, IN EVERY STATE ───────────────────────────────────────────────
    // Under App Store guideline 3.1.1 the iPhone app shows no prices and no buy button, so a
    // page that says "buy this book" must not send an iPhone reader to it. The Book Store's
    // pages mount TabBar and their own chrome — never <Footer /> — so this holds by
    // construction rather than by a denylist. It is checked anyway, in all four states,
    // because "by construction" is exactly the kind of claim that quietly stops being true
    // when someone adds a footer to a storefront.
    const bsIos = await filesContaining(IOS_URL, 'out/bookstore');
    const bsPlay = await filesContaining(PLAY_URL, 'out/bookstore');
    note(bsIos.length === 0 && bsPlay.length === 0,
      `no store link on ANY Book Store page (${[...bsIos, ...bsPlay].slice(0, 4).join(', ') || 'clean'})`);
  }
} finally {
  await restore();
}

console.log('\n' + '─'.repeat(78));
if (failures.length) {
  console.log(`MATRIX FAILED — ${failures.length} assertion(s):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('MATRIX PASSED — all four flag states verified in the built output.');
