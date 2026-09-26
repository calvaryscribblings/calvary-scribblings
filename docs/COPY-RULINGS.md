# Copy rulings

Every ruling on reader-facing words, dated, newest last. A ruled line changes only with a new
ruling. The tests that pin each set are named under it.

## 26 Sep 2026, 00:36 (Ikenna): both locks (W10)

- **Archive lock:** the "this week" sentence stays exactly as W9 left it.
- **Series lock:** "FROM THE SERIES" / "This instalment is closed." / the instalment's own refusal
  line stays as it is.

Recorded in `docs/W9-LOCK-AND-BAR.md` and pinned in `tests/ci/w9-lock-bar.test.mjs`.

## 26 Sep 2026, 01:53 (Ikenna): the W2/W5 drafts and house style (W11)

- **9 and 10.** Approved as they stand, apart from the style changes in 13: `NotFoundPage.js`,
  `age.js`, `profileCompletion.js`, `handle.js` (its format errors included), `dobCheck.js` and
  `saveToast.js`.
- **11.** In `unavailableCopy.js`, keep "Anything you saved for offline reading is still in My
  Library." only if the website really keeps saved stories readable offline.
  **Verdict: it does, so the sentence stays.** On the live site (`tests/offline/offline-shelf-probe.mjs`,
  26 Sep), a signed-in reader saved "Alive", visited My Library, and then went offline. Opening
  `/stories/alive` redirected to `/my-library/read?slug=alive`, which showed the full text. The shelf
  listed the story, and an unsaved page (`/search`) showed the house "No signal" page. The save lives
  in IndexedDB (`app/lib/shelf.js`), and the service worker (`public/sw.js`) caches the shelf shell.
  The probe dropped 1 client write at the database socket, and 0 account records changed.
- **12.** On the Series lock, a signed-out reader on the instalment page sees "The Series comes
  with a Gold or Platinum membership.", the same line as in the reader, instead of "Sign in to
  read this instalment." Both surfaces now read `SERIES_LOCK_COPY.signedOutBody`.
- **13.** House style for this copy and both locks:
  - Use short forms throughout (can't, couldn't, don't, won't, we'll, you're, it'll).
  - Every heading that's a full sentence ends with a full stop.
  - Eyebrows, labels, buttons, field names and short status fragments such as "Saved to My
    Library" don't take one.
- **14.** Summarise `scripts/account/scrub-plan.mjs` in plain English. See
  `docs/ACCOUNT-SCRUB-PLAN.md`. The plan is unchanged; Ikenna signs it off next.
- **15.** Paragraphs are indented with no extra space between them, as the web already does.
  Nothing changes. Measured in W11 (below).

Pinned in `tests/ci/w11-copy-rulings.test.mjs`, which covers every approved line word for word,
rule 13 checked mechanically, and a DRAFT mark in any of the eight files failing the suite. The
lock changes are pinned in `tests/ci/w9-lock-bar.test.mjs`.

### Every string that changed

| File | Before | After |
|---|---|---|
| NotFoundPage.js · title | There’s nothing at this address | There’s nothing at this address. |
| age.js · under | …so we cannot open an account for you. | …so we can’t open an account for you. |
| age.js · underSignedIn | …so we cannot finish setting up your account. We will sign you out now. | …so we can’t finish setting up your account. We’ll sign you out now. |
| handle.js · format error | Letters, numbers and underscores only. | Letters, numbers and underscores only |
| handle.js · format error | At least 3 characters. | At least 3 characters |
| handle.js · format error | No more than 20 characters. | No more than 20 characters |
| handle.js · unknown | We could not check that handle just now. It will be checked again when you continue. | We couldn’t check that handle just now. It’ll be checked again when you continue. |
| profileCompletion.js · failed | We could not save your details, so nothing was changed. Please try again. | We couldn’t save your details, so nothing was changed. Please try again. |
| dobCheck.js · title | Please confirm your date of birth | Please confirm your date of birth. |
| dobCheck.js · underTitle | Story Island is for readers aged 18 and over | Story Island is for readers aged 18 and over. |
| dobCheck.js · underBody | …so it will be deleted now, with everything in it… | …so it’ll be deleted now, with everything in it… |
| dobCheck.js · reauthTitle | Sign in again to continue | Sign in again to continue. |
| unavailableCopy.js · offline title | You’re offline | You’re offline. |
| unavailableCopy.js · slow title | The island is slow to answer | The island is slow to answer. |
| unavailableCopy.js · ours title | This part didn’t load | This part didn’t load. |
| Story lock, degraded · headline | We could not check your membership just now. | We couldn’t check your membership just now. |
| Story lock, degraded · body | You are reading the opening. If you are a member, a refresh should bring the rest. | You’re reading the opening. If you’re a member, a refresh should bring the rest. |
| Series lock, signed out, instalment page · body | Sign in to read this instalment. | The Series comes with a Gold or Platinum membership. |
| Series lock, pass holder · body (`REFUSAL_COPY.pass_excluded`) | Day and week passes do not include the Series — it comes with a Gold or Platinum membership. | Day and week passes don’t include the Series — it comes with a Gold or Platinum membership. |

Notes:
- **`saveToast.js`** needed no change. It only loses its DRAFT mark.
- **"Choose a handle."** keeps its full stop because it's a sentence. The other three format
  errors are fragments.
- **The pass-holder line** is shared by design: `REFUSAL_COPY` feeds the lock, the series page's
  instalment rows and the stream endpoint, so the same words change in all three places.
- **`Unavailable.js`** used to add a full stop when it ran the title into the body ("We couldn’t
  reach your books. You’re offline. Check…"). The titles carry their own now, so it adds only a
  space. What readers see there is the same.
- **Left as it stands, for a ruling:** `COMPLETION_COPY.title`, "One last thing.", is a heading but
  not a full sentence. Rule 13 doesn't say whether a fragment heading drops its stop, so it's
  unchanged.

### Both locks, word for word, as drawn

Measured on the build at 390 with the clock after the switch (`tests/typography/lock-words.mjs`).
`innerText` honours the CSS capitals, so this is what a reader sees.

**Archive lock (story page):**
FROM THE ARCHIVE / This story is in the archive. / Every story published this week is free to
read, Monday to Sunday. Earlier stories are open to members. / SEE MEMBERSHIP / Already a
member? Sign in

**Archive lock, degraded (the membership read failed):**
FROM THE ARCHIVE / We couldn’t check your membership just now. / You’re reading the opening. If
you’re a member, a refresh should bring the rest. / TRY AGAIN

**Series lock, signed out (instalment page and reader, now identical):**
FROM THE SERIES / This instalment is closed. / The Series comes with a Gold or Platinum
membership. / SEE MEMBERSHIP / Already a member? Sign in

**Series lock, signed in without the tier:** the same, except that the body is the instalment's
refusal line and there's no sign-in line. The refusal line is one of:
- "The Series is a Platinum membership benefit."
- "This instalment is open to Gold and Platinum members."
- "Day and week passes don’t include the Series — it comes with a Gold or Platinum membership."

The eyebrow "FROM THE SERIES" is drawn. It's stored as "From the Series" and set in capitals by
the component. W10's quote of the Series lock left it out.

### Ruling 15, measured

`tests/typography/paragraph-census.mjs` measured every story page on the build at 390, and all
four Series instalments rendered from their real EPUBs in `public/reading-room.html`. The rule
holds on every surface: the space between adjacent paragraphs is 0px, and a paragraph that
follows another is indented. Nothing was changed.

| Surface | Pages | Paragraph pairs | 0px gap | Indent |
|---|---|---|---|---|
| Short stories | 71 | 4,229 | 4,221 | 1.5em (4,226) |
| Flash fiction | 22 | 345 | 334 | 1.5em (322) |
| Inspiring | 13 | 198 | 183 | 1.5em (192) |
| News | 64 | 958 | 951 | 1.5em (958) |
| Poetry | 17 | 1,197 | 1,161 | none: verse, one line per block, by design (1,191) |
| Series (4 instalments) | 4 | 744 | 744 | 0.5cm ≈ 1.05em, from the EPUBs' own CSS |

The CSS is `app/lib/proseCSS.js`: `.prose p { margin-bottom: 0 }` and
`.prose:not(.is-verse) p + p { text-indent: 1.5em }`. The drop-cap opener is not indented.

**Every exception is deliberate**, checked one by one:
- **Section breaks** (`— ✦ —`, `***`, `* * *`), content notes and front matter, with space either
  side.
- **Poem numerals** (I, II, Coda…).
- **Pictures in news articles.**
- **A verse passage inside "Purple Rain".**
- **Inline styles authored in individual story bodies.** "real-heartbreak" sets
  `style="text-indent:0; margin-top:1.5em"` on one paragraph as a pause, and "the-pill" unindents
  the first paragraph after each break. "you-will-love-it" doesn't, so after a break the
  first-line indent varies from story to story. That's in the stories' own text, not the site's
  CSS.
- **In the Series:** scene breaks, letters, end marks and diary timestamps.

**For Ikenna, if he wants it ruled:**
1. The Series indent (0.5cm, set by the EPUB files) is narrower than the stories' 1.5em.
2. Whether a paragraph after a section break should be indented is currently decided story by
   story.
