# W4: the free week and the archive (the web's half)

Ruled by Ikenna, 24–25 Sep 2026. Live from **30 Sept 00:00 London (29 Sept 23:00 UTC)** by the clock
alone; no deploy happens at that moment.

## The rule

- **The free week is Monday 00:00 to Sunday 23:59:59.999, London time.** Every story published in
  a week is free to everyone until that week ends. At Monday 00:00 London **the whole week goes to
  the archive together**, including a story published at Sunday 23:58.
- **The archive** is open to Gold and Platinum, counted through the effective tier, so a day or
  week pass opens it.
- **Poetry stays free.** **News locks** like fiction. **No most-recent-5 floor.**
- **The Series tier gate** switches on at the same instant.
- **Code:** `app/lib/storyAccess.js` (`grantFor`, `gatingOn`, `GATE_ON_MS` derived from `LAUNCH`) and
  `app/lib/londonWeek.js`.

## Parity with the app

The fixture is `app/lib/storyAccess.parity.json`. It holds 22 grant cases and 4 week cases, and the
expected values are written by hand, not generated. The web runs it in
`tests/ci/story-access.test.mjs`. Each case is `grantFor(story, { tier, now })` → `{ access, reason,
freeUntilMs }`, where `tier` is the **effective** tier.

On the app side, from the app repo, with this repo checked out beside it:

```sh
WEB_PARITY_FIXTURE=../calvary-scribblings/app/lib/storyAccess.parity.json node harness/story-access-parity.mjs
```

The fixture can also be fetched from
`https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/main/app/lib/storyAccess.parity.json`.
⚠ The harness lives in the app repo, which this container cannot see. The variable name above is a
proposal. If the harness already imports the web's module instead, the check it makes, that the
floor is gone, now passes: `resolveRecentFloor` and `RECENT_FLOOR_COUNT` no longer exist.

## The static pages, and the minutes after midnight

The site is a static export, so one build answers for every reader until the next. Three layers:

1. **The build** (`buildInlinePlan` in `app/lib/storyLock.js`) inlines a story's full body only if
   a signed-out reader may read it in full **both now and three hours later**. A build that finishes
   after a boundary therefore cannot carry a body that has just gone to the archive.
2. **The page's own refusal.** A page that does carry a full body also carries the instant it locks:
   its Sunday 23:59:59.999 + 1ms, or the 30 Sept switch, whichever is later. An inline script swaps
   the body for the preview **before paint** once that instant has passed, and the client's first
   render matches it. Members then get the body from `/api/story`, as on any page.
3. **The rebuild.** The `calvary-newsletter` Worker (cron `*/15`) fires the stories deploy hook on
   **the first tick after every London midnight**. That covers every Monday, and 30 Sept (a
   Wednesday). London's hour comes from Intl, so the schedule is right in BST and in GMT with nothing
   to change in October or March.

**The exact schedule:** a build is triggered at about **00:00:05 London every day**. That's 23:00
UTC during BST and 00:00 UTC during GMT. It is live about 1–2 minutes later: Pages builds took
30–120s this week.

**What a reader sees between 00:00 and the new build:**
- A signed-out reader opening **an archive story** sees its preview and the locked panel. The inline
  script replaces the body before the first paint, and `/api/story` answers `preview`.
- **This week's stories are unaffected.**
- **A reader with JavaScript disabled** still receives the old HTML, with the full body, until the
  new build lands. That window is at most about 2 minutes, once a week.
- **The body stays reachable in `cms_stories`** until the October app binary. Ikenna accepted this
  for launch.

**The built-HTML check** is `scripts/check-built-gate.mjs`. A real `next build` with the clock
faked to 1 Oct 2026 (`FAKE_NOW=… NODE_OPTIONS="--import ./tests/build/fake-clock.mjs"`) carries the
ending of **0 of 167** archive stories. The same check against today's pre-switch build finds 163,
which is exactly what the page's own refusal and the midnight rebuild exist to cover.

## The founder-only preview

In **/admin** a founder sees *Founder preview: the site after 30 September* → **Turn the preview
on**. That browser then asks `/api/story` and `/api/series/stream` with `previewGate: true`. The
endpoints honour it only for a verified founder uid, and it can only ever lock. It applies the gate
at today's real date, so this week's stories stay free. A gold pill, *Founder preview · after
30 Sept · Turn off*, stays on screen while the preview is on. Nobody else is affected.

> **W4b (25 Sept) changed where the flag lives.** It is on the account now, and the story pages
> lock before paint. See *W4b* at the end of this file.

Verified live on 25 Sept, with @byokpara's account:
- **Preview on:** `trouble-shooting` (18 Sept) → preview / archive. `till-debt-do-us-part` (22 Sept) →
  full / free_week. Poetry → full. Series I2 → 403 `needs_platinum`. I1 → 403 `needs_gold` (his tier
  is free).
- **Preview off, or any other caller:** full / `gating_off`, as today.

## GATE-01, done

The backup comes first: `backups/gate-01/<stamp>/`, md5-verified and git-ignored. It was the only
copy of the deleted objects, since the RTDB backups don't cover Storage. **W5 (25 Sep) copied it off
the codespace** to `gs://calvary-scribblings-storage-backups/gate-01/` (private, MD5-verified; see
`scripts/backup/RESTORE.md`). Then:
- **18 legacy `epubs/` objects deleted.** None was used by a published story. Beta Princess I1 and
  I2 among them were byte-identical to the locked Series masters.
- **`extractedText` and `epubUrl` stripped from the 10 withdrawn books** in `cms_stories`.
  Scheduled and hidden prose records were not touched.
- **Signed out afterwards:** all 28 Storage URLs, plain and tokenised, answer **404**. The 10
  `extractedText` paths answer `null`.
- **Script:** `scripts/gate01-remove-legacy-copies.mjs`. A dry run now reports 0 objects and 0
  records.

## Ikenna's walk, on the live site, signed in as @byokpara

1. **/admin → Turn the preview on.** The gold pill appears.
2. **An older story** (for example `/stories/trouble-shooting`): the opening, then the locked
   panel.
3. **This week's story** (for example `/stories/till-debt-do-us-part`): opens in full.
4. **/series/beta-princess → Part Two:** locked (Platinum).
5. **Tap *Turn off* on the pill:** every story reads in full again, and the Series opens, as today.

## W4b — the preview didn't work on Ikenna's iPad

**The report:** on his iPad in Safari, Ikenna turned the preview on in /admin and walked
`trouble-shooting`, `till-debt-do-us-part` and Beta Princess Part Two. Nothing locked.

**His path, reproduced before the fix** (the live site, WebKit at 820×1180, signed in as
@byokpara with a warmed service worker, preview tapped on in /admin, each story opened through the
site's router): **it worked.**
- `trouble-shooting` sent `previewGate:true` with the ID token and got `preview / archive`. The
  locked panel drew (515 words shown, down from 1485).
- `till-debt-do-us-part` got `full / free_week`.
- The Series rows read *Part Two · The Series is a Platinum membership benefit* with a lock.

It also worked after pressing Back to a story opened earlier, in a second tab opened before the
toggle, and after a reload.

**The five causes, ruled on:**
- **The static page renders its built body before 30 Sept: IN, measured.** With the preview on and
  `/api/story` slowed, the first paint was the whole story (1485 words, no pill). It was taken back
  only when the endpoint answered. The page does ask `/api/story`, and `previewGate` does reach it.
- **The inline lock script reads only the clock: IN, by the code.** That is why the first paint
  was the whole story.
- **The flag is stored where the story pages can't read it: IN for a whole class of cases.** The
  flag was one browser's `localStorage`, and nothing else knew about it. On the same origin in
  the same browser it carried (probed). But the site's manifest is `display: standalone`, so a
  Home Screen copy of the site on iPadOS has its own storage, separate from Safari. The same goes
  for another browser or another device. In all of those, a toggle set in one place never reaches
  the story pages, and nothing says so.
- **The service worker serves a cached page: OUT.** No version of `sw.js` has ever cached a
  `/stories/` document (they are cached only for `isShelfPath`), and the documents are served
  `max-age=0, must-revalidate`.
- **The preview is tied to a session the story pages don't share: OUT on one origin.** The story
  pages, the Series and /admin share one Firebase session (the ID token was present, and the
  founder was honoured). `www` does not serve (523), and `*.pages.dev` is not an authorised sign-in
  domain.

Which of these Ikenna actually hit can't be recovered: Pages Functions keep no log history, and
the observability API refuses this token.

**The fix:**
- **The flag lives on the account:** `founder_preview/{uid} = true`. Only that founder can read or
  write it, and `true` is the only value it can hold (rules, emulator-tested). `/api/story` and
  `/api/series/stream` read it themselves, from the verified uid, whenever a founder asks. So a
  page locks even when its browser never heard of the flag. The request flag still works.
  `app/lib/gatePreviewPolicy.js` decides: founders only, before the switch only, and it can only
  lock.
- **The toggle waits for the account write**, and says *That didn't save* if it fails.
  `useGatePreview()` follows the account node and keeps the local copy in step with it.
- **Before paint:** each full page carries `previewLockAtMs`, the end of its own London week. The
  inline script and the first render lock from that instant when the local copy is set. The page
  therefore paints the opening, not the whole story.
- **The non-member view**, by ruling: under the preview the endpoints skip the membership read
  and judge at `free`, and the Series rows draw at `free`.

**Proof:**
- `tests/ci/w4b-preview.test.mjs` (28), including the real `/api/story` handler driven with a
  stubbed network: the account flag alone locks, a reader's flag is never read, and a Gold
  founder still sees the locked archive.
- `tests/rules/founder-preview.test.mjs` (5).
- Every protection was reverted once and its test went red.
- Live WebKit screenshots at 820 and 1180, preview on and off.

**Tabs:** Ikenna does not need to close his open Safari tabs. The documents are never cached, and
the next load of any page picks up the new code. A tab that has been sitting open since before
this deploy is still running the old code, so reload it once or open the story again.
