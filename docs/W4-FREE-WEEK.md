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

Verified live on 25 Sept, with @byokpara's account:
- **Preview on:** `trouble-shooting` (18 Sept) → preview / archive. `till-debt-do-us-part` (22 Sept) →
  full / free_week. Poetry → full. Series I2 → 403 `needs_platinum`. I1 → 403 `needs_gold` (his tier
  is free).
- **Preview off, or any other caller:** full / `gating_off`, as today.

## GATE-01, done

The backup comes first: `backups/gate-01/<stamp>/`, md5-verified and git-ignored. It is the only
copy of the deleted objects, since the RTDB backups don't cover Storage. Then:
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
