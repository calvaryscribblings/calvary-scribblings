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

## 26 Sep 2026 (Ikenna): the responses section and the reactions (W13)

- The section under a story is **"Responses"**, its count **"3 responses"** ("1 response"), and
  the box **"Add a response…"**. They replace "Discussion", "3 comments" and "Share your
  thoughts on this story…", on `/stories/…` and on `/reader/…`.
- **"Reply"** is a word, Cormorant 500, 15px, #9062DA. It reads **"Cancel"** while its box is
  open. It replaces the grey capitals under story responses and in the Open Pages thread.
- A failed reaction says **"Couldn't save your reaction. Try again."** (`FAIL_COPY` in
  `app/components/conversation/Reaction.js`).

Pinned in `tests/ci/w13-reactions.test.mjs`.

**Not ruled: two lines W13 had to change so they still point at something.** The quiz named
"the Discussion", a section that no longer exists by that name:
- `QuizCard.js`: "The Discussion below is open." is now "Responses below are open."
- `QuizGuidelinesModal.js`: "though the Discussion remains open." is now "though Responses
  remain open."

They await a ruling. "Sign in to join the discussion", on the signed-out story page, names no
section and was left alone. It too is for Ikenna.

## 26 Sep 2026 (Ikenna): rule 13 across the open list, the Series fallback, responses (W15)

- **18.** Rule 13 applies to the lines in `docs/RULE-13-OPEN-LIST.md` §1 (reader interface), §2
  (headings), §3 (fragments), §6 (server errors readers see) and §8 (the offline heading in
  `public/sw.js`). Ikenna's own pages, the legal pages and every §5 judgement call stay as
  written.
- **20.** "One last thing." (`COMPLETION_COPY.title`) keeps its full stop. Nothing changes.
- **38.** The signed-out story page says **"Sign in to add a response."**, on `/stories/…` and
  on `/reader/…`. It replaces "Sign in to join the discussion". The two quiz lines W13 moved now
  stand as ruled: "Responses below are open." (`QuizCard.js`) and "though Responses remain
  open." (`QuizGuidelinesModal.js`).
- **The Series fallback.** `REFUSAL_COPY.unavailable` reads **"Couldn’t open this instalment
  just now. Please try again."** The reader's own fallback (`app/lib/series/stream.js`) carries
  the same words, and the endpoint (`functions/api/series/stream.js`) has none of its own: it
  answers with `refusalCopy()`. The rest of `REFUSAL_COPY` takes short forms too
  (`not_released`, the free-while-not-on-sale line). The three lines ruled in W10 and W11 are
  unchanged.

Pinned in `tests/ci/w15-copy-rulings.test.mjs`: every changed line word for word at its source,
the old long forms swept out of `app/`, `functions/` and `public/sw.js`, rulings 20 and 38, the
whole of `REFUSAL_COPY`, and rule 13 checked mechanically over every changed line.

**Apostrophes.** Each file keeps the kind it already used. Most take the curly ’. `AuthModal.js`,
`square/page.js`, `QuizGuidelinesModal.js`, `delete-account/page.js` and the story page already set
their copy with a straight ', so their changes do too. In JSX text it's written `&apos;`, as the
linter asks, so it renders the same. `REFUSAL_COPY` uses ’ like the W11 line
beside it.

### Every string that changed

Paths are under `app/` unless they start `functions/` or `public/`. Line numbers are as of W15.
Where one string recurs, every place is in the one row.

| File | Before | After |
|---|---|---|
| components/AuthModal.js:84 (§1) | Passwords do not match. | Passwords don't match. |
| components/AuthModal.js:128 (§1) | We could not finish creating your account, so nothing was saved. Please try again. | We couldn't finish creating your account, so nothing was saved. Please try again. |
| components/AuthModal.js:129 (§1) | We could not finish creating your account. Please contact us before trying again. | We couldn't finish creating your account. Please contact us before trying again. |
| components/AuthModal.js:138 (§1) | but we could not send the verification email | but we couldn't send the verification email |
| components/AuthModal.js:184 (§1) | Could not resend: ${err.message} | Couldn't resend: ${err.message} |
| age-verified/page.js:153 (§1) | We could not complete your verification. Please try again. | We couldn’t complete your verification. Please try again. |
| public-library/page.js:1620 (§1) | You are already subscribed. | You’re already subscribed. |
| bookstore/components/BuyButton.js:69 · lib/bookstore/checkout.js:69 · lib/membershipCheckout.js:29 · functions/api/bookstore/checkout.js:245, :249, :254 · functions/api/bookstore/paystack-checkout.js:190, :227, :231, :237 · functions/api/membership/checkout.js:210, :275, :279, :284 · functions/api/membership/pass-checkout.js:175, :179, :184 · functions/api/membership/paystack-checkout.js:133, :178, :182, :188 · functions/api/membership/paystack-pass-checkout.js:145, :149, :155 (§1, §6) | Checkout could not be opened. Please try again. | Checkout couldn’t be opened. Please try again. |
| lib/bookstore/checkout.js:38 (§1) | This title cannot be purchased yet. | This title can’t be purchased yet. |
| lib/bookstore/stream.js:24 (§1) | This book cannot be opened yet. | This book can’t be opened yet. |
| lib/bookstore/stream.js:49 · functions/api/bookstore/stream.js:224, :241, :272 (§1, §6) | Could not open your copy just now. Please try again. | Couldn’t open your copy just now. Please try again. |
| reader/[slug]/book-reader.js:214 (§1) | That is as far as the sample goes. | That’s as far as the sample goes. |
| reader/[slug]/book-reader.js:273 (§1) | This sample would not open. The book itself is still here — it is waiting on its own page. | This sample wouldn’t open. The book itself is still here — it’s waiting on its own page. |
| reader/[slug]/page-reader.js:627 (§1) | This copy would not open. The story itself is still here — it is waiting on its own page. | This copy wouldn’t open. The story itself is still here — it’s waiting on its own page. |
| components/SaveForOffline.js:110 (§1) | Could not save that. | Couldn’t save that. |
| lib/shelf.js:166 (§1) | Could not open the shelf database | Couldn’t open the shelf database. |
| components/MembershipSection.js:89 · functions/api/membership/portal.js:155, :159, :164 (§1, §6) | Could not open membership management. Please try again. | Couldn’t open membership management. Please try again. |
| components/MembershipSection.js:276 (§1) | A pass is a one-off — there is nothing to cancel and it will not renew. | A pass is a one-off — there’s nothing to cancel and it won’t renew. |
| lib/membershipCheckout.js:73 (§1) | Could not reach the checkout. Check your connection and try again. | Couldn’t reach the checkout. Check your connection and try again. |
| lib/membershipCheckout.js:94 (§1) | That is not available in this currency. | That isn’t available in this currency. |
| lib/membershipReturn.js:48 (§1) | That is on our side, and we have already been alerted. | That’s on our side, and we’ve already been alerted. |
| lib/membershipReturn.js:41 (§1) | so there is nothing to refresh. | so there’s nothing to refresh. |
| series/page.js:89 (§1) | When the first instalment has a date, it will appear here with it. | When the first instalment has a date, it’ll appear here with it. |
| series/instalment/[instalmentId]/page-instalment.js:309 · series/read/[instalmentId]/page-reader.js:169 · lib/series/access.js:280 (§1) | This instalment has not arrived yet. | This instalment hasn’t arrived yet. |
| series/read/[instalmentId]/page-reader.js:59, :91 · functions/api/series/stream.js:220 (§1, §6) | That instalment could not be found. | That instalment couldn’t be found. |
| series/read/[instalmentId]/page-reader.js:183 (§1) | Could not open this instalment. | Couldn’t open this instalment. |
| lib/series/access.js:283 (§1) | The Series is free to read while memberships are not yet on sale. | The Series is free to read while memberships aren’t yet on sale. |
| lib/series/access.js:288 · lib/series/stream.js:66 (fallback) | Could not open this instalment just now. Please try again. | Couldn’t open this instalment just now. Please try again. |
| lib/series/stream.js:32 (§1) | This instalment cannot be opened yet. | This instalment can’t be opened yet. |
| open-pages/new/page.js:219 (§1) | It is live | It’s live. |
| open-pages/new/page.js:221 (§1) | We cannot publish this one | We can’t publish this one. |
| open-pages/new/page.js:223 (§1) | That did not go through | That didn’t go through. |
| open-pages/new/page.js:460 (§1) | nothing has been lost, and you will see it on Open Pages once they have. | nothing has been lost, and you’ll see it on Open Pages once they have. |
| open-pages/drafts/page.js:76 (§1) | Delete this draft? This cannot be undone. | Delete this draft? This can’t be undone. |
| lib/openPagesDrafts.js:253 (§1) | characters, so it is saved on this device only until it is shorter. | characters, so it’s saved on this device only until it’s shorter. |
| lib/useOpenPagesDraft.js:24 (§1) | This browser is not storing anything | This browser isn’t storing anything |
| lib/openPagesCopy.js:28 (§1) | we come and ask — that is how most of our contributors were found. | we come and ask — that’s how most of our contributors were found. |
| square/page.js:400 (§1) | The author is not told who reported them. | The author isn't told who reported them. |
| square/page.js:1284 (§1) | beneath it will stay — they are not yours to delete. | beneath it will stay — they aren't yours to delete. |
| square/page.js:1285 (§1) | Withdraw this post? It will be removed from the Square. | Withdraw this post? It'll be removed from the Square. |
| square/p/page.js:145 (§1) | this one is not among them. | this one isn’t among them. |
| square/p/page.js:157 (§1) | nothing is deleted, so it is | nothing is deleted, so it’s |
| lib/squarePostBody.js:196 (§1) | The replies below are not theirs to remove. | The replies below aren’t theirs to remove. |
| components/SeasonBoard.js:375 (§1) | The board could not be loaded just now. | The board couldn’t be loaded just now. |
| voices/[slug]/page-client.js:370 (§1) | This voice has not been gathered yet. | This voice hasn’t been gathered yet. |
| components/QuizGuidelinesModal.js:102 (§1) | comprehension check — and it is strict. | comprehension check — and it's strict. |
| delete-account/page.js:35 (§1) | address and we will process your deletion request. | address and we'll process your deletion request. |
| age-verified/page.js:143 (§2) | Something Went Wrong | Something went wrong. |
| bookstore/not-found.js:8 (§2) | This book isn’t on the shelf | This book isn’t on the shelf. |
| my-library/read/page.js:215 · public/sw.js:331 (§2, §8) | This story isn’t on your shelf | This story isn’t on your shelf. |
| components/SaveForOffline.js:209 (§2) | More saved than your plan holds” / “Your shelf is full | More saved than your plan holds.” / “Your shelf is full. |
| square/p/page.js:142 (§2) | This post is gone | This post is gone. |
| user/page.js:429 (§2) | There’s no reader by that name | There’s no reader by that name. |
| open-pages/edit/[id]/page-client.js:530 (§2) | Couldn’t save these changes | Couldn’t save these changes. |
| open-pages/edit/[id]/page-client.js:531 (§2) | Hmm — that didn’t work | Hmm — that didn’t work. |
| stories/[slug]/page-client.js:112 (§2) | Dead End is a collector's read | Dead End is a collector's read. |
| components/AuthModal.js:181 (§3) | Verification email resent. | Verification email resent |
| age-verified/page.js:90 (§3) | Just a moment. | Just a moment |
| open-pages/new/page.js:44 · open-pages/edit/[id]/page-client.js:51 (§3) | No file selected. | No file selected |
| open-pages/new/page.js:645 · open-pages/edit/[id]/page-client.js:655 (§3) | Nothing to preview yet. | Nothing to preview yet |
| components/OpenPagesProfileSection.jsx:159 (§3) | No stories published yet. | No stories published yet |
| profile/page.js:297 · user/page.js:136 (§3) | No posts yet. | No posts yet |
| profile/page.js:335 · user/page.js:213 (§3) | No one here yet. | No one here yet |
| profile/page.js:387 · user/page.js:266 (§3) | No comments yet. | No comments yet |
| profile/page.js:1161 · square/page.js:825 (§3) | No notifications yet. | No notifications yet |
| quizzes/page.js:105 (§3) | No completed quizzes yet. | No completed quizzes yet |
| quizzes/page.js:106 (§3) | All quizzes attempted. | All quizzes attempted |
| quizzes/page.js:107 (§3) | No quizzes available. | No quizzes available |
| reader/[slug]/ReadingRoom.js:333 (§3) | No matches. | No matches |
| rewards/page.js:279 (§3) | No Scribbles history yet. | No Scribbles history yet |
| voices/[slug]/page-client.js:446 (§3) | No published work yet. | No published work yet |
| series/[slug]/page-detail.js:124 (§3) | No instalments listed yet. | No instalments listed yet |
| series/[slug]/page-detail.js:68 (§3) | No such series. | No such series |
| series/instalment/[instalmentId]/page-instalment.js:323 (§3) | No such instalment. | No such instalment |
| series/instalment/[instalmentId]/page-instalment.js:304 · series/read/[instalmentId]/page-reader.js:166 (§3) | Not yet. | Not yet |
| series/read/[instalmentId]/page-reader.js:178 (§3) | Locked. | Locked |
| functions/api/bookstore/checkout.js:64, :68 · functions/api/bookstore/paystack-checkout.js:83 (§6) | Purchasing is not configured yet. | Purchasing isn’t configured yet. |
| functions/api/bookstore/checkout.js:130 · functions/api/bookstore/paystack-checkout.js:126 (§6) | Could not reach the catalogue. | Couldn’t reach the catalogue. |
| functions/api/bookstore/checkout.js:133 · functions/api/bookstore/paystack-checkout.js:129 (§6) | That title is not in the catalogue. | That title isn’t in the catalogue. |
| functions/api/bookstore/checkout.js:134, :148 · functions/api/bookstore/paystack-checkout.js:130, :141 (§6) | That title is not on sale. | That title isn’t on sale. |
| functions/api/bookstore/paystack-checkout.js:65 (§6) | This book is not yet priced in naira. | This book isn’t yet priced in naira. |
| functions/api/bookstore/paystack-checkout.js:79 (§6) | Naira payments are not configured yet. | Naira payments aren’t configured yet. |
| functions/api/bookstore/paystack-checkout.js:180 (§6) | This title cannot be purchased in naira. | This title can’t be purchased in naira. |
| functions/api/bookstore/stream.js:179, :183 (§6) | Reading is not configured yet. | Reading isn’t configured yet. |
| functions/api/bookstore/stream.js:245 (§6) | You do not own this book yet. | You don’t own this book yet. |
| functions/api/membership/checkout.js:128, :132 (§6) | Memberships are not available yet. | Memberships aren’t available yet. |
| functions/api/membership/checkout.js:176 (§6) | That membership is not available in this currency. | That membership isn’t available in this currency. |
| functions/api/membership/checkout.js:221 (§6) | That membership is not available yet. | That membership isn’t available yet. |
| functions/api/membership/checkout.js:238 · functions/api/membership/paystack-checkout.js:148 (§6) | Your plan could not be changed just now. | Your plan couldn’t be changed just now. |
| functions/api/membership/pass-checkout.js:88 (§6) | That pass is not sold in this currency. | That pass isn’t sold in this currency. |
| functions/api/membership/pass-checkout.js:99 (§6) | Passes are not available yet. | Passes aren’t available yet. |
| functions/api/membership/paystack-checkout.js:75 (§6) | Naira memberships are not available yet. | Naira memberships aren’t available yet. |
| functions/api/membership/paystack-checkout.js:97 (§6) | That membership is not available in naira. | That membership isn’t available in naira. |
| functions/api/membership/paystack-checkout.js:116 (§6) | This account cannot pay in naira. | This account can’t pay in naira. |
| functions/api/membership/paystack-pass-checkout.js:63 (§6) | That pass is not sold in naira. | That pass isn’t sold in naira. |
| functions/api/membership/paystack-pass-checkout.js:74 (§6) | Naira passes are not available yet. | Naira passes aren’t available yet. |
| functions/api/membership/paystack-pass-checkout.js:117 (§6) | Passes could not be opened for this account. | Passes couldn’t be opened for this account. |
| functions/api/membership/paystack-cancel.js:75 (§6) | There is no naira membership to cancel. | There’s no naira membership to cancel. |
| functions/api/membership/portal.js:76 (§6) | We are still setting up your membership. | We’re still setting up your membership. |
| functions/api/membership/portal.js:77 (§6) | You do not have a membership to manage yet. | You don’t have a membership to manage yet. |
| functions/api/membership/portal.js:87, :108 (§6) | Membership management is not available yet. | Membership management isn’t available yet. |
| functions/api/membership/portal.js:124 (§6) | Could not reach your membership just now. | Couldn’t reach your membership just now. |
| functions/api/series/stream.js:174, :178 (§6) | The Series is not configured yet. | The Series isn’t configured yet. |
| functions/api/auth/send-verification.js:96 (§6) | Could not reach the mail service. | Couldn’t reach the mail service. |
| functions/api/auth/send-verification.js:102 (§6) | Verification email could not be sent. | Verification email couldn’t be sent. |
| functions/api/open-pages/moderate.js:446 (§6) | Could not load the post to edit. | Couldn’t load the post to edit. |
| stories/[slug]/page-client.js:806 · reader/[slug]/page-reader.js:395 (ruling 38) | Sign in to join the discussion | Sign in to add a response. |

Notes:
- **The shelf error** (`lib/shelf.js`) also gained a full stop. It's a sentence, and it can surface
  as the Save button's error line.
- **"Something Went Wrong"** was also title-cased. It's now a sentence heading.
- **"Locked"** is dead copy: since W9 the series reader draws `ArchiveLock` for that state. It
  changed anyway, so the file is consistent.
- **Tests that pinned the old words** now pin the new ones: `tests/openpages/distribution.test.mjs`,
  `tests/square/postbody.test.mjs`, `tests/bookstore/timeouts.test.mjs`,
  `tests/membership/stripe-rail.test.mjs`, `tests/ci/series-access.test.mjs`,
  `tests/reader/app.spec.mjs` and the mocked server answers in `tests/verify-email/resend.spec.mjs`.

### Left as written

- **Ikenna's own pages:** `/membership`, `/reading-program`, `/about`, `/ai-policy`, `/app` (§4).
  That includes the one §2 heading on his page, `reading-program/page.js:163` "The all-time board
  does not reset".
- **The legal pages** (§7): `/terms`, `/privacy`, the Summer 2026 terms.
- **Every §5 judgement call**, including `openPagesDrafts.js` "You have N drafts…" (possessive
  *have*), the imperative headings, and the caps banners.
- **`bookstore/components/CurrencySelector.js:86`** "Set from where you are — change it whenever
  you like." The list flagged it for "you're", but the *are* ends its clause, so it can't
  contract (§5f).
- **§9 and §10**, out of scope: `functions/api/story.js`, `app/lib/story.js`,
  `functions/api/account/delete.js`, `_deletion.js`, `functions/api/auth/welcome.js`, the quiz
  endpoints, admin-only and ops copy, and the API validation fragments.
