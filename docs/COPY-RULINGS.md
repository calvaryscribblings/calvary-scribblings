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
| public/reading-room.html:64 (rule 13, W17) | This book would not open. | This book wouldn’t open. |

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

## 27 Sep 2026 (Ikenna): a deleted Open Pages piece, and the deletion screen (W19)

- **Ruling 47.** A link to a deleted Open Pages piece shows exactly **"This piece was deleted."**,
  in the style of the site's empty-state notes, with no link and no byline. That covers the piece's
  own page, the site 404 its address reaches after a rebuild, and every Square surface that draws
  the announcement quoting it. Lists of pieces leave it out. The words live in
  `app/lib/deletedContent.js` (`DELETED_PIECE`) and are pinned in `tests/ci/w19-piece-deleted.test.mjs`.
- **Ruling 49.** The account-deletion screen keeps its wording: the modal, its two conditional
  lines, the settings danger zone and the page after deletion. Nothing changed. Every word is
  pinned verbatim in `tests/ci/w19-deletion-screen.test.mjs`, so a later copy sweep turns it red.

## 27 Sep 2026 (Ikenna): the Book Store's rooms — the canvas "Book Store rooms" (W22)

Rulings 74–81 and 88. Every line lives in `app/lib/bookstore/desiderata.js` (`DESIDERATA_COPY`,
`markLabel`, `titlesLabel`) or `app/lib/bookstore/readership.js` (`readershipShort`), and is
pinned in `tests/bookstore/desiderata.test.mjs` and `tests/bookstore/readership.test.mjs`.

### Ruled with the canvas, 27 Sept

- **The list's name (75):** "Desiderata".
- **The room's subline:** "Books you’ve marked to come back to."
- **The room's foot line:** "When a book comes into your library, it leaves this list."
- **The room's count:** "1 TITLE" / "N TITLES" — the hero's rule, uppercased by CSS.
- **The toast after an add:** "Added to Desiderata. You’ll find it under the ribbon at the top of the shop."
- **The search hint:** "Titles, authors and genres on these shelves."
- **The search field's hidden label, and the bar's Search circle:** "Search the shelves".
- **The shelf's readers line (88):** "ONE READER" / "N READERS" (`readershipShort`: "One reader",
  "2 readers", "1,204 readers", uppercased by CSS; nothing below one).
- **The +, as a screen reader hears it:** "Add {title} to Desiderata" / "Take {title} out of
  Desiderata". The bar's second circle: "Desiderata".
- **Breadcrumbs:** "BOOK STORE · DESIDERATA" and "BOOK STORE · SEARCH". Search's groups:
  "AUTHOR", "GENRE", "TITLES", and "ALL TITLES ›".

### Ruled 28 Sept (89), as written

These five shipped in W22 as drafts. Ruling 89 took all five as written.

- **The toast after a remove (with Undo):** "Removed from Desiderata"
- **A write that was refused (the + changes back):** "Couldn’t save that change. Try again."
- **The room, empty:** "Nothing marked yet. The + under any book on the shelves adds it here."
- **The room, signed out (with a SIGN IN button):** "Sign in to see your Desiderata."
- **Search, no results:** "Nothing on these shelves matches “{q}”."

## 28 Sep 2026 (Ikenna): the dictionary, printing and copying (W24)

Rulings 89–103, all yes. The words this round touched:

- **The credit under a house-dictionary answer (101):** "Open English WordNet · Princeton WordNet".
  In `app/lib/dictionary.js` (`DICT_SOURCE`); pinned in `tests/reader/dictionary.spec.mjs`. The
  glossary's "House glossary · Calvary Scribblings" and the miss's "No definition found for
  “{word}”." are unchanged.

### DRAFT — awaiting Ikenna's word

Two new lines, written in rule 13's house style. Both live in `app/lib/readerCopy.js`, and each
changes here first.

- **What the Reading Room prints instead of a book (93):** "Books in the Reading Room can’t be
  printed." (`PRINT_LINE`; repeated in `public/reading-room.html`'s print CSS, held equal by
  `tests/ci/w24-reader-print-copy.test.mjs`.)
- **The credit on a copy from the Reading Room (93):** "— from {Title} by {Author} · Calvary
  Scribblings" (`creditLine`; "— from {Title} · Calvary Scribblings" when a title has no author).

## 28 Sep 2026 (Ikenna): the membership page, founding copy retired, and the Reading Room's lines (W27)

- **108:** every reader-facing mention of a founding price is retired: the founding box on
  `/membership`, the clause in YOU’RE IN, and the Founding badge in Settings. YOU’RE IN now reads
  "Your {Tier} membership is active. Thank you for keeping this place going." Billing is
  unchanged (the founding generation, the portal pinned to it, the founding/foundingSince fields,
  every price). The deck's Founding box line is retired with a note.
- **109:** `/membership` is redrawn to the approved drawing. No words change apart from 108's
  removals; spaced dashes are bound to the word before them (U+00A0) so no line begins with one.
- **110:** the page takes the site's Navbar and TabBar, as `/bookstore` mounts them.
- **111:** Paystack's four plans are named "Calvary Gold — Monthly", "Calvary Gold — Annual",
  "Calvary Platinum — Monthly", "Calvary Platinum — Annual", with descriptions "Calvary
  Scribblings membership — {tier}, {interval}." (test and live).
- **112 and 116:** Halfway Around the Moon comes off the island, both parts, with every trace of
  Dead End that W26 left.
- **113:** `workers/stripe-webhook/` comes out of the repo.
- **114:** the print line "Books in the Reading Room can’t be printed." is ruled as written.
- **115:** the copy credit "— from {Title} by {Author} · Calvary Scribblings" is ruled as written
  (house-authored titles drop "by …", 104).

The W24 drafts section above is closed by 114 and 115; `app/lib/readerCopy.js` carries no DRAFT
mark, pinned by `tests/ci/w24-reader-print-copy.test.mjs`.

## 30 Sep 2026 (Ikenna): launch night (W30/W31)

- **51:** the Reading Room's dictionary miss reads `No definition found for “{word}”` with **no
  full stop**, as the app draws it (`app/reader/[slug]/ReadingRoom.js`; the reader frame draws no
  such line). Pinned by `tests/reader/app.spec.mjs` (exact text) and
  `tests/ci/w30-rulings.test.mjs`.
- **123:** the 49 `users/*/readStories` markers and 18 `user_comments` mirrors W27 held back for
  the three removed works **stay**. They carry live reader scores (badgeEngine); nothing deletes
  them.
- **124:** **no limit** on day or week passes at launch. Revisit with October's numbers.
- **130 (standing, W31):** the Book Store's head air is one value at every width; laptops
  confirmed. If Ikenna rules otherwise, wide screens go back to 80px (`SHOP_RHYTHM.headAir`).
- **131 (open):** the Book Store's `noindex` and its absence from the sitemap wait on this ruling.
  W31 left both alone.

## 11 Oct 2026 (Ikenna): the Series admin, the Book Store's indexing, /book-reader (W38)

- **130 (ruled):** the Book Store's head air stays **one value at every width**, laptops included.
  No change; the standing note above is now a ruling.
- **131 (ruled):** the Book Store **is visible to search engines**. The `noindex` is off
  `app/bookstore/layout.js`, and `app/sitemap.js` lists `/bookstore` and every published catalogue
  title (`app/lib/bookstore/sitemapTitles.js`). The rooms (Desiderata, Search) keep their own
  `noindex`.
- **137:** web library tiles stay **without BEGIN/CONTINUE**. No change.
- **140:** `/admin/series` is rebuilt to the approved seven-screen design, copy included, as
  carried by the W38 brief: the list, one series, the instalment editor, the publish progress,
  the writer picker, a new series, and a live instalment's panel. The words are in
  `app/admin/series/page.js` and `app/lib/series/publishing.js`.
- **141:** a **cover is required to publish** an instalment, like the EPUB
  (`validateInstalmentDetail`).
- **142:** "Who can read it" has **no default**. A new draft records it as not chosen
  (`choicesPending`, admin-only), and it cannot be published or scheduled until the editor chooses.
  Instalments from before W38 count as chosen.
- **143:** old `/book-reader` links go to **the Series page** (a 301 through
  `scripts/generate-redirects.mjs`); the empty page is removed.

## 13 Oct 2026 (Ikenna): the Book Store door's line, the removed works (W39)

- **132:** the Book Store door on the welcome page carries **"{n} titles"** under its title, in the
  Library door's own class (`cs-gw-door-meta`), so the two lines match in face, size, colour and
  distance below the title. {n} is the published catalogue only, counted at build time by the
  sitemap's rule (`app/lib/bookstore/sitemapTitles.js`, read in `app/lib/gateway-build.js`); it
  counts titles, never copies. An unreadable count hides the line. One title reads "1 title".
- **145:** the works W27 removed keep **one lasting copy outside the Codespace**, in the private
  backups bucket under `w27-removed-works/`, with every reader comment and reader identifier taken
  out. See `scripts/backup/RESTORE.md`.

## 13 Oct 2026 (Ikenna): free instalments on the web, the welcome-page doors (W40)

- **146:** "Free" means **anyone signed in**, free accounts included. Signed-out visitors are asked
  to sign in first. The public row carries `openToFree: true`, always with `freeForGold: true`, so
  an app that doesn't know the field still opens it to Gold. The rule is in
  `app/lib/series/access.js` (after the release check and the sign-in), and
  `functions/api/series/stream.js` runs it.
- **147:** the admin's "Who can read it" has a third choice: **"Free to read"**, with "Anyone signed
  in can read this one" beneath it. None is preselected (142 stands). The passes line shows only
  when nothing or a paid level is chosen. The live panel reads "Free to read. Anyone signed in can
  read it." A level change on a live instalment says who gains or loses it ("Everyone signed in
  gains it when you save, free accounts included." / "… who can read it now lose it when you
  save. Their saved place is kept.").
- **148:** readers see **"Free to read"** on that instalment's row on the series page and on its
  page. Signed out, the page's lock reads "Free to read" / "Sign in to read this instalment." /
  "Anyone signed in can read this one." with one button, "Sign in"; the reader route says the same.
- **149:** on iPad and laptop the two welcome-page doors are **one height**, their glyphs and
  count lines **level**, and each title sits **directly above its own count line**, with or
  without "The Square is open tonight ✦". Phone unchanged.

## 14 Oct 2026 (Ikenna): the Series in the membership copy, a corrected edition (W44)

- **151:** `/membership` and the Series page description **stay as they are**. The full Series
  is still a Platinum benefit, so the copy that says so is right. No change.
- **154:** when the app picks up a **corrected edition** of a book (a replaced master), the
  reader is **shown nothing**. The switch is silent: no notice, no banner, no "this book was
  updated" line. Their place is carried across by the carry-over (`docs/epub-replacement.md`).

## 14 Oct 2026 (Ikenna): Readers' Notes for the Series (W46)

The approved canvas and all of its copy. The words are in `NOTES_COPY` in
`app/lib/series/notes.js`, the contract is `docs/series-notes.md`, and
`tests/series-notes/contract.test.mjs` holds the copy exact. The brief cites the canvas as
rulings 157–166 but states 157 and 158 only as "the approved canvas"; the rest are:

- **159:** one question of each kind: Take a side (2–4 sides, no right answer), Sit with this
  (open, always spoiler-free), The line (a line the reader chose in the book). "Or tell us about
  anything else from {N} that stayed with you." is always offered as well.
- **160:** nobody sees an instalment's notes until they've finished it. **Enforced by the rules**,
  not only by the screens.
- **161:** the first answer opens the room, even one tap on a side.
- **162:** Sit with this is spoiler-free and sits on the door for everyone.
- **163:** the writer's answers are pinned, with a writer's mark.
- **164:** the admin drafts the three questions from the text; the editor edits and publishes.
- **165:** one reaction, Underline.
- **166:** notes are AI-checked as they're posted; flagged ones wait for review.

## 17 Oct 2026 (Ikenna): Readers' Notes, launch-morning fixes (W48)

- **175:** on The line, with no line chosen yet, the composer says how to choose one and offers
  the way to the book. Approved as written:
  - `NOTES_COPY.lineFirst`: Choose your line in the book first: press on it and tap “This is my line”.
  - `NOTES_COPY.chooseInBook`: Choose it in the book
  - `NOTES_COPY.backToNote`: Back to your note (carried by the notice after "This is my line"
    when the reader came from the composer)
- `NOTES_COPY.lineSaved`: Saved as your line. (the W46 notice, moved into `NOTES_COPY` so the
  app's parity test sees it; the words are unchanged)
- `NOTES_COPY.underlined(n)`: Underlined · {n}, as on the approved canvas (it was "Underlined").

## 17 Oct 2026 (Ikenna): reads, counted once (W49)

- **176:** an instalment read counts once per reader, the first time they open it, at the same
  moment a story counts its read (the first page shown, or 12 seconds on the page).
  `functions/api/series/read.js`; the count is `series_reads/{inst}`.
- **177:** shown as "1,204 reads". It sits under each numeral in the room's instalment strip
  (and in the rail), and first in the room's count line: "1,204 reads · 38 notes · 21 readers".
  - `NOTES_COPY.reads(n)`: "1 read" or "1,204 reads" (en-GB grouping).
  - `NOTES_COPY.roomCounts(r, n, m)`: "1,204 reads · 38 notes · 21 readers". The door keeps
    `heroCounts`: "38 notes · 21 readers".
- **178:** each instalment's count starts from the readers who already have a saved place in it
  (`scripts/series/seed-reads.mjs`, run once). Seeded reads credit nobody.
- **179:** from now on, an instalment read counts toward the reader's island badge exactly as a
  story read does: readCount, the every-tenth-read points, the streak and the badge checks.
  `app/lib/readCredit.js`, shared by all three readers.
- **180:** every story keeps its current read count. The double counting stops from now on, with
  no recount. `functions/api/hit.js` counts one read per reader (a verified uid, else the device
  id, else nothing). The `calvary-hit-counter` Worker, which counted every open, is now
  count-only (`workers-external/`, pasted into the dashboard by hand).

## 18 Oct 2026 (Ikenna): the build stamp (W52)

- **190:** No reader sees a build ID. The stamp shows only to founders, in the site footer;
  /build.json stays. The app's Profile build line goes founder-only in A42.

## 18 Oct 2026 (Ikenna): the town square (rulings 191–203, the town-square canvas)

- **191:** Tonight's question: one house question every weeknight, pinned at the top; answers live under it, not in the feed.
- **192:** Ikenna writes or approves each question; Claude drafts three a week from new stories; nothing goes out unapproved.
- **193:** Saturday Story: shortlist of three Monday 8pm, vote closes Wednesday 8pm, read together Saturday 8pm; readers don't see vote counts until it closes.
- **194:** On Saturday, timed table questions (8:00, 8:45, 9:30) replace Tonight's question; "Ask the writer" runs 8:30–10pm.
- **195:** Any post can be hidden as a spoiler until tapped; the Saturday table is spoiler-open.
- **196:** A selected line from any story can be shared to the Square, posting as a cream paper cutting with "Read from this line".
- **197:** Story pages get an "In the Square" block straight after the story's close, above About the author.
- **198:** "Here now" shows the faces of readers in the room; "Reading tonight" on a reader's card is opt-in, off by default.
- **199:** "Tell me when it opens": an opt-in 8pm notification, at most one a day, plus Wednesday's Saturday Story announcement.
- **200:** The feed shows night dividers (Tonight, Last night, the night before) and a one-line latest reply under each post.
- **201:** Earlier nights: the archive browsable by night and searchable by story, read-only.
- **202:** A reader's card offers Mute (they aren't told) and Block; in messages, a single message is reported.
- **203:** Identity is drawn by the live components (Avatar, UserBadge), everywhere in the Square.

## 18 Oct 2026 (Ikenna): Mute, Block, the failed post and the removed post (W53)

- **204:** Switching who you're replying to keeps what's typed; the "@handle " prefill is gone.
- **205:** A post that fails to send behaves like a failed reply: words kept, "Not sent.", Try again, Remove — web and app.
- **206:** A post a moderator removes reads "This post was removed."; one its author withdraws keeps "The author withdrew this post."
- **207:** A muted or blocked reader's posts leave your feed; where one of their replies holds up others in a thread, it shows as "A reply you've hidden."
- **208:** A blocked reader who tries to message you sees "You can't message this reader." and isn't told why; you see "You've blocked @handle." with Unblock.
- **209:** One block list everywhere: a block made in Open Pages comments applies to messages and the Square, and the reverse.
- The reader card (W53 brief): "Mute in the Square" — "Their posts stop showing for you. They won't know."; "Block @handle" — "They can't message you, and their posts leave your Square."; once set, "Unmute" and "Unblock @handle". Messages: "Report a message" — "Pick the message. A moderator sees only that one."; then "Reported. A moderator sees only this message."

## 18 Oct 2026 (Ikenna): the Square's server enforces the hours and the pace (W54)

- **210:** The server enforces the hours: no post or reply outside 20:00–00:00 London, with five minutes' grace after midnight; founders are exempt.
- **211:** Each reader may make at most 5 posts and 30 replies in any 10 minutes; past that: "Too much at once. Try again in a minute."
- The refusal outside the hours (W54 brief): "The Square opens at 8pm."
- **214:** Founders keep the pace limit in 211; only the hours in 210 are lifted for them. (The Function already works this way.)

## 19 Oct 2026 (Ikenna): the reply box, the menu and the moderator's wording (W55)

- **212:** The reply box grows to three lines as you write, on web and app.
- **213:** On a reply, the menu says "Withdraw reply" to its author and "Remove reply" to a moderator, matching the confirmation that follows. The web already does; the app catches up in A44.
- **215:** When a moderator removes someone else's post, the confirmation says "Remove this post?", plus "The N replies beneath it will stay." when it has replies.
- **216:** As the reply box grows, Send stays at the bottom, beside the last line.
- The rule tightening that W54 called W55 is now W56.

## 19 Oct 2026 (Ikenna): the conversation's menu, muting a conversation, the report step (W55.1)

- **217:** The ⋯ menu in a conversation follows the approved design on web and app: the reader's face and name, View profile, Mute this conversation, Report a message, Block @handle, and Cancel.
- **218:** Mute this conversation stops its new messages from raising the unread dot or any alert; they still arrive, and the other reader isn't told.
- **220:** When you report a message, the next step shows the message you picked under "THE MESSAGE A MODERATOR WILL SEE", on the website as in the app.
- (219 is the app's alone: its post menu drops Block.)
- Once set, the rows read "Unmute this conversation" and "Unblock @handle" (W55.1 brief).

## 19 Oct 2026 (Ikenna): messages, the keyboard and images (W55.2)

- **222:** Images in messages are sent through the server, and only readers granted image posting can send them.
- **223:** A message that fails to send stays in the conversation, faded, with "Not sent.", Try again and Remove, like a failed reply.
- The refusals a reader can act on carry their words after "Not sent.": "Images aren't on for your account.", "That file isn't an image we can send.", "That image is too large to send." (W55.2, app/lib/dmImages.js).
- **224:** An image in a message lasts 24 hours, then it's deleted and the message shows "This image has expired."; before sending, the preview says "Images disappear after 24 hours."
- **225:** A reported image is kept with the report, out of reach of the 24-hour clear-out, until a moderator closes the report.

## 19 Oct 2026 (Ikenna): where message images are kept, and the report that loses its image (W55.2)

- **226:** Message images stay in the main storage bucket, with its 30-day safety copy, rather than getting a separate bucket of their own.
- **227:** If a report goes through but its image couldn't be kept with it, the reader sees "Your report was sent, but the image didn’t go with it. Try again." (app/components/square/MessagesPanel.js).

## 27 Oct 2026 (Ikenna): where The Series sits

- **233:** On Home, The Series sits directly under Just Added, on web and in the app.
- **234:** On Home, the Series posters are 160×240: Just Added's card width at the poster's own 2:3, so the two rows line up card for card.
- **235:** The posters take Just Added's 12px corners but keep their own faint edge, with no purple border or glow, because they are artwork.
- **236:** On Home, Just Added, The Series, Top Readers, Top 10 and the genre rows all have 16px between their heading and their cards. Just Added and Top Readers move from 12px.
- **237:** The Series card's text sits like Just Added's, with no blank lines held in reserve. The row may move by up to a line when it loads.

## 29 Oct 2026 (Ikenna): owned books, free titles, the author photo (STORE-OWNED)

- **238:** Open Pages keeps its own heading gap, on web and app.
- **239:** Voices of the Island on the app's Home is at 16pt.
- **240:** A free title's button reads "Get · Free", mirroring "Buy · £1.99". It replaces "Add to My Library · Free".
- **241:** Every title a reader owns shows "In My Library" instead of Buy, and both checkouts refuse a reader who already owns it. Owned means the reader's copy is active: a sale, a complimentary copy or a free copy; a revoked copy isn't owned.
- The refusal's line is PROPOSED, awaiting Ikenna's word: "This title is already in your library." (`ALREADY_OWNED_ERROR`, functions/api/bookstore/_lib.js).
- **242:** Free is all-or-nothing: a price of 0 in one currency requires 0 in every currency the title is priced in. An empty price still means "not priced there".
- **243:** The app can add a free title to My Library.
- **245:** The author photo on a book's full details page has 12px corners, on web and app.
