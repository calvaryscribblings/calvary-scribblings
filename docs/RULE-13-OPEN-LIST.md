# Rule 13: reader-facing copy that breaks it, for a ruling

Swept 26 Sep 2026 (W11), read-only. Rule 13: short forms throughout; a full-sentence heading ends with a full stop; eyebrows, labels, buttons, field names and short status fragments don't.

## Before you read

- **For a separate ruling (W11, item 2).** None of these was changed. Some of this copy Ikenna wrote himself, the membership page included. Line numbers are as of the W11 commit. The strings ruled in W11 are in `docs/COPY-RULINGS.md` and aren't repeated here.
- **Method.** Every `.js/.jsx/.mjs` file under `app/` (except `app/admin/**` and `app/api/**`), `functions/`, `emails/` and `public/sw.js` was parsed with `@babel/parser`. That extracts the string literals, template literals and JSX text and drops every comment, so the hundreds of long forms inside code comments and CSS comments aren't counted here. Long forms were matched with a broad regex. Headings were pulled from `h1`–`h6`, from `*-h`, `*-t`, `*title*`, `*head*` and `*eyebrow*` class names, and from `title`, `head` and `headline` keys. A short-string pass then caught sentence-shaped lines with no stop, and labels or fragments that end in one. After that, each hit was checked by hand for context and for whether it's actually rendered.
- **Excluded files.** The eight excluded files weren't checked. Their consumers were: `ProfileCompletion`, `DobCheck`, `HandleField`, `SaveToast`, `Unavailable`, `StoryGate`, `ArchiveLock`, `app/not-found.js` and `app/bookstore/not-found.js`. The only adjacent copy found was in `app/bookstore/not-found.js`, which is listed in §2.
- **Rule key.** **SF** = short form (a long form is used). **H.** = a full-sentence heading with no full stop. **F.** = an eyebrow, label, button or short fragment that ends in a full stop. **?** = a judgement call, listed in §5 and not counted as a definite breach.

---

## 1. Reader UI: short-form breaches (app components and pages)

### Sign-in / sign-up modal (`AuthModal`)
| file:line | string | rule | where readers see it |
|---|---|---|---|
| app/components/AuthModal.js:84 | `Passwords do not match.` | SF | register form error |
| app/components/AuthModal.js:128 | `We could not finish creating your account, so nothing was saved. Please try again.` | SF | register failure |
| app/components/AuthModal.js:129 | `We could not finish creating your account. Please contact us before trying again.` | SF | register failure |
| app/components/AuthModal.js:138 | `Your account was created, but we could not send the verification email (${…}) — tap Resend below.` | SF | post-register error |
| app/components/AuthModal.js:184 | `Could not resend: ${err.message}` | SF | verify step, resend failure (the appended message comes from `/api/auth/send-verification`, see §6) |

### Age verification (`/age-verified`)
| app/age-verified/page.js:153 | `We could not complete your verification. Please try again.` | SF | failure state body |
|---|---|---|---|

### Public Library (home)
| file:line | string | rule | where |
|---|---|---|---|
| app/public-library/page.js:1620 | `You are already subscribed.` | SF | newsletter signup status line |

### Book Store / reading a book
| file:line | string | rule | where |
|---|---|---|---|
| app/bookstore/components/BuyButton.js:69 | `Checkout could not be opened. Please try again.` | SF | buy-button error (fallback) |
| app/lib/bookstore/checkout.js:38 | `This title cannot be purchased yet.` | SF | thrown, then rendered by BuyButton via `e.message` |
| app/lib/bookstore/checkout.js:69 | `Checkout could not be opened. Please try again.` | SF | thrown, then rendered by BuyButton |
| app/bookstore/components/CurrencySelector.js:86 | `Set from where you are — change it whenever you like.` | SF (you're) | currency line under the shop |
| app/lib/bookstore/stream.js:24 | `This book cannot be opened yet.` | SF | thrown, then shown as the book reader's gate message |
| app/lib/bookstore/stream.js:49 | `Could not open your copy just now. Please try again.` | SF | book reader gate message |
| app/reader/[slug]/book-reader.js:214 | `That is as far as the sample goes. The rest is waiting in the Book Store.` | SF | end of sample |
| app/reader/[slug]/book-reader.js:272 | `This sample would not open. The book itself is still here — it is waiting on its own page.` | SF ×2 | sample fail panel |

### Story reader (Reading Room)
| app/reader/[slug]/page-reader.js:618 | `This copy would not open. The story itself is still here — it is waiting on its own page.` | SF ×2 | reader fail panel |
|---|---|---|---|

### My Library / Save for offline
| file:line | string | rule | where |
|---|---|---|---|
| app/components/SaveForOffline.js:110 | `Could not save that.` | SF | save-button error (fallback) |
| app/lib/shelf.js:166 | `Could not open the shelf database` | SF (and no stop) | IndexedDB reject; can surface through SaveForOffline's `e?.message` |

### Membership (settings panel, checkout plumbing)
| file:line | string | rule | where |
|---|---|---|---|
| app/components/MembershipSection.js:89 | `Could not open membership management. Please try again.` | SF | Settings → Membership, portal error |
| app/components/MembershipSection.js:276 | `A pass is a one-off — there is nothing to cancel and it will not renew.` | SF ×2 (there's, won't) | Settings → Membership, pass holder |
| app/lib/membershipCheckout.js:29 | `Checkout could not be opened. Please try again.` | SF | membership page / settings error |
| app/lib/membershipCheckout.js:73 | `Could not reach the checkout. Check your connection and try again.` | SF | membership page error |
| app/lib/membershipCheckout.js:94 | `That is not available in this currency.` | SF (that's / isn't) | membership page error |
| app/lib/membershipReturn.js:48 | `…hasn’t appeared yet. That is on our side, and we have already been alerted. It usually sorts itself out…` | SF ×2 (That's, we've) | /membership return banner, "PAID — BUT NOT SHOWING YET" |
| app/lib/membershipReturn.js:41 | `Checking with the payment provider. This page updates on its own, so there is nothing to refresh.` | SF (there's) | /membership return banner |

### Series (listing, instalment, reader)
| file:line | string | rule | where |
|---|---|---|---|
| app/series/page.js:88 | `Nothing is listed yet. When the first instalment has a date, it will appear here with it.` | SF (it'll) | /series empty state |
| app/series/instalment/[instalmentId]/page-instalment.js:309 | `This instalment has not arrived yet.` | SF | instalment page, not-yet state |
| app/series/read/[instalmentId]/page-reader.js:59 | `That instalment could not be found.` | SF | series reader gate |
| app/series/read/[instalmentId]/page-reader.js:91 | `That instalment could not be found.` | SF | series reader gate |
| app/series/read/[instalmentId]/page-reader.js:169 | `This instalment has not arrived yet.` | SF | series reader "Not yet." body |
| app/series/read/[instalmentId]/page-reader.js:183 | `Could not open this instalment.` (the `failed` **head**) | SF | series reader failure heading |
| app/lib/series/access.js:280 | `This instalment has not arrived yet.` | SF | REFUSAL_COPY.not_released; also returned by `/api/series/stream` |
| app/lib/series/access.js:283 | `The Series is free to read while memberships are not yet on sale.` | SF | REFUSAL_COPY. The comment says it's "never shown as a refusal", so exposure is low |
| app/lib/series/access.js:288 | `Could not open this instalment just now. Please try again.` | SF | REFUSAL_COPY.unavailable |
| app/lib/series/stream.js:32 | `This instalment cannot be opened yet.` | SF | thrown, then shown as the series reader gate message |
| app/lib/series/stream.js:66 | `Could not open this instalment just now. Please try again.` | SF | series reader gate message |

### Open Pages (composer, editor, drafts)
| file:line | string | rule | where |
|---|---|---|---|
| app/open-pages/new/page.js:219 | `It is live` (OUTCOME_TITLES.published) | SF **and** H. | outcome panel title after publish |
| app/open-pages/new/page.js:221 | `We cannot publish this one` (OUTCOME_TITLES.rejected) | SF **and** H. | outcome panel title |
| app/open-pages/new/page.js:223 | `That did not go through` (OUTCOME_TITLES.error) | SF **and** H. | outcome panel title |
| app/open-pages/new/page.js:460 | `An editor will read this before it goes up. Your piece is safe — nothing has been lost, and you will see it on Open Pages once they have.` | SF (you'll) | held-for-review message |
| app/open-pages/drafts/page.js:76 | `Delete this draft? This cannot be undone.` | SF | `window.confirm` on /open-pages/drafts |
| app/lib/openPagesDrafts.js:248 | `You have ${MAX_DRAFTS} drafts, which is the limit. Publish or delete one…` | ? (possessive *have*, see §5) | draft-cap notice |
| app/lib/openPagesDrafts.js:253 | `This draft is longer than ${…} characters, so it is saved on this device only until it is shorter. Nothing has been cut.` | SF ×2 (it's) | oversize notice in composer |
| app/lib/useOpenPagesDraft.js:24 | `This browser is not storing anything, so your work is only in this tab. Copy it somewhere before you close it.` | SF (isn't) | composer notice when storage is blocked |
| app/lib/openPagesCopy.js:28 | `When a piece belongs in the house, we come and ask — that is how most of our contributors were found.` | SF (that's) | Open Pages invitation line (index, piece page, composer) |

### The Square
| file:line | string | rule | where |
|---|---|---|---|
| app/square/page.js:401 | `Only moderators see reports. The author is not told who reported them.` | SF | Report-post dialog |
| app/square/page.js:1270 | `Withdraw this post? The ${n} ${replies} beneath it will stay — they are not yours to delete.` | SF (they're not / aren't) | `confirm` on withdraw, with replies |
| app/square/page.js:1271 | `Withdraw this post? It will be removed from the Square.` | SF (It'll) | `confirm` on withdraw |
| app/square/p/page.js:143 | `…Posts that simply pass the 48-hour horizon are kept and still open here — this one is not among them.` | SF | /square/p, post gone |
| app/square/p/page.js:156 | `This thread has left the Square. The room holds 48 hours; nothing is deleted, so it is still readable here — just no longer in the room.` | SF (it's) | /square/p, "Past the horizon" note |
| app/lib/squarePostBody.js:196 | `The author withdrew this post. The replies below are not theirs to remove.` | SF (aren't) | withdrawn-post note (all post surfaces) |

### Seasonal Reading Program board, Voices, quizzes
| file:line | string | rule | where |
|---|---|---|---|
| app/components/SeasonBoard.js:375 | `The board could not be loaded just now. Refresh in a moment.` | SF | leaderboard / edition board error notice |
| app/voices/[slug]/page-client.js:370 | `This voice has not been gathered yet.` | SF | /voices/[slug] empty state |
| app/components/QuizGuidelinesModal.js:101 | `The first question is a close-reading comprehension check — and it is strict. … You have two attempts. …` | SF (it's); "You have two attempts" is ? (possessive) | quiz guidelines modal |

### Account deletion (public help page)
| app/delete-account/page.js:35 | `…from your registered email address and we will process your deletion request.` | SF (we'll) | /delete-account |
|---|---|---|---|

---

## 2. Reader UI: heading full-stop breaches

These are full-sentence headings that end without a full stop.

| file:line | string | rule | where |
|---|---|---|---|
| app/age-verified/page.js:143 | `Something Went Wrong` (h1, error branch) | H. | /age-verified failure heading. It's also title-cased. |
| app/bookstore/not-found.js:8 | `This book isn’t on the shelf` (COPY.title → NotFoundPage) | H. | Book Store 404 heading |
| app/my-library/read/page.js:215 | `This story isn’t on your shelf` (`.sr-gate-h`) | H. | /my-library/read, story not saved |
| app/components/SaveForOffline.js:209 | `Your shelf is full` / `More saved than your plan holds` | H. | shelf-full panel title under the Save button. Note that /my-library:942 prints "Your shelf is full." **with** a stop. |
| app/square/p/page.js:142 | `This post is gone` (h1) | H. | /square/p |
| app/user/page.js:429 | `There’s no reader by that name` (h1) | H. | /user not-found |
| app/reading-program/page.js:163 | `The all-time board does not reset` (h2) | H. **and** SF | /reading-program |
| app/open-pages/new/page.js:219/221/223 | `It is live` · `We cannot publish this one` · `That did not go through` | H. (+SF, already listed in §1) | composer outcome titles |
| app/open-pages/edit/[id]/page-client.js:531 | `Couldn’t save these changes` | H. | editor outcome title (rejected) |
| app/open-pages/edit/[id]/page-client.js:532 | `Hmm — that didn’t work` | H. | editor outcome title (error) |
| app/stories/[slug]/page-client.js:113 | `Dead End is a collector's read` | H. | paywall panel heading on the paid story |

---

## 3. Reader UI: fragments, labels and empty-state lines that end in a full stop

These are verbless status or empty-state fragments. By the rule's own example ("Saved to My Library") they don't take a stop.

| file:line | string | rule | where |
|---|---|---|---|
| app/components/AuthModal.js:181 | `Verification email resent.` | F. | success line in the verify step |
| app/age-verified/page.js:89 | `Just a moment.` | F. | /age-verified waiting line. The composer and editor use "Just a moment" without a stop. |
| app/open-pages/new/page.js:44 | `No file selected.` | F. | cover-image validation |
| app/open-pages/edit/[id]/page-client.js:51 | `No file selected.` | F. | editor cover-image validation |
| app/open-pages/new/page.js:645 | `Nothing to preview yet.` | F. | composer preview empty state |
| app/open-pages/edit/[id]/page-client.js:655 | `Nothing to preview yet.` | F. | editor preview empty state |
| app/components/OpenPagesProfileSection.jsx:158 | `No stories published yet.` | F. | profile → Open Pages, empty |
| app/profile/page.js:297 | `No posts yet.` | F. | profile, My Square Posts modal |
| app/profile/page.js:335 | `No one here yet.` | F. | profile, followers/following modal |
| app/profile/page.js:387 | `No comments yet.` | F. | profile, My Comments modal |
| app/profile/page.js:1161 | `No notifications yet.` | F. | profile, notifications panel |
| app/user/page.js:136 | `No posts yet.` | F. | /user, Square posts modal |
| app/user/page.js:213 | `No one here yet.` | F. | /user, followers modal |
| app/user/page.js:266 | `No comments yet.` | F. | /user, comments modal |
| app/square/page.js:826 | `No notifications yet.` | F. | Square notifications panel |
| app/quizzes/page.js:105 | `No completed quizzes yet.` | F. | /quizzes empty filter |
| app/quizzes/page.js:106 | `All quizzes attempted.` | F. | /quizzes empty filter |
| app/quizzes/page.js:107 | `No quizzes available.` | F. | /quizzes empty filter |
| app/reader/[slug]/ReadingRoom.js:333 | `No matches.` | F. | Reading Room search sheet |
| app/rewards/page.js:278 | `No Scribbles history yet.` | F. | /rewards history, empty |
| app/voices/[slug]/page-client.js:446 | `No published work yet.` | F. | /voices/[slug] works, empty |
| app/series/[slug]/page-detail.js:124 | `No instalments listed yet.` | F. | series detail, empty list |
| app/series/[slug]/page-detail.js:68 | `No such series.` (h1) | F. | series not-found heading |
| app/series/instalment/[instalmentId]/page-instalment.js:323 | `No such instalment.` (h1) | F. | instalment not-found heading |
| app/series/instalment/[instalmentId]/page-instalment.js:304 | `Not yet.` (h1) | F. | instalment not-yet heading |
| app/series/read/[instalmentId]/page-reader.js:166 | `Not yet.` (head) | F. | series reader not-yet heading |
| app/series/read/[instalmentId]/page-reader.js:178 | `Locked.` (head) | F. | **Dead copy.** Since W9 the `locked`/`signedout` gates render `ArchiveLock` and never read `copy.head` |

---

## 4. Authored prose pages

Tagged by page so they can be ruled on separately.

### /about
| app/about/page.js:15 | `We are a Calvary Media UK publication, committed to the art of storytelling…` | SF (We're) |
|---|---|---|

### /ai-policy
| file:line | string | rule |
|---|---|---|
| app/ai-policy/page.js:64 | `…or anywhere else. That is permanent.` | SF (That's) |
| app/ai-policy/page.js:70 | `…typeset by the house. They are not artwork and not generated images — …` | SF (They're not / aren't) |
| app/ai-policy/page.js:75 | `Where artwork is used — …the posters that carry a Series — it is chosen deliberately, title by title…` | SF (it's) |

### /app (Story Island app page)
| file:line | string | rule |
|---|---|---|
| app/app/page.js:87 | `The app is not in the stores yet. When it is, it will be here.` | SF (isn't, it'll). "When it is" is clause-final and can't contract. |
| app/app/page.js:95 | `…on a signal that has given up entirely — and it does not spend your data twice.` | SF (doesn't) |
| app/app/page.js:108 | `If you are reading this on a computer, the link opens the store page…` | SF (you're) |

### /membership
| file:line | string | rule |
|---|---|---|
| app/membership/page.js:133 | `Read the island as it is published.` (CARD_LINE.free) | SF (it's) |
| app/membership/page.js:468 | `Every story is free the week it is published.` (**h1**) | SF (it's) |
| app/membership/page.js:470 | `…where more than a hundred and sixty stories are waiting. That is what a membership opens.` | SF (That's) |
| app/membership/page.js:497 | `None of that is a trial, and none of it expires.` | SF (that's) |
| app/membership/page.js:622 | `A pass, if a subscription is not what you want` (section heading `.mb-sec-h`) | SF (isn't) |
| app/membership/page.js:623 | `…A pass opens the Gold shelf for a day — or, in naira, for a week — once. There is nothing to cancel and nothing to remember.` | SF (There's) |
| app/membership/page.js:678 | `Anything you have saved is yours. If a pass runs out…` | SF (you've) |
| app/membership/page.js:682 | `We do not take saved stories back.` | SF (don't) |
| app/membership/page.js:725 | `Any time, and you keep everything until the period you have paid for runs out.…` | SF (you've) |
| app/membership/page.js:731 | `New stories stay free to you, as they are to everyone. The archive closes. Anything you had saved stays saved.` | "you had saved" is SF (you'd). "as they are to everyone" is clause-final and can't contract. |
| app/membership/page.js:736 | `Poetry is always free on the island. It is short, it is better stumbled upon than sought out…` | SF ×2 (It's) |
| app/membership/page.js:750 | `New stories every week, free to everyone. That does not change.` | SF (doesn't) |

### /reading-program
| file:line | string | rule |
|---|---|---|
| app/reading-program/page.js:87 | `Taking part is simply reading. There is nothing to enter and nothing to sign: …` | SF (There's) |
| app/reading-program/page.js:95 | `What is fixed` (h2) | SF (What's) |
| app/reading-program/page.js:97 | `Two things, and they are the whole of it.` | SF (they're) |
| app/reading-program/page.js:102 | `It is seasonal.` (bold lead-in) and `There is an edition in the spring, one in the summer…` | SF ×2 |
| app/reading-program/page.js:109 | `…on the table. How it is divided — how many places pay… — is set for each edition…` | SF (it's) |
| app/reading-program/page.js:115 | `What is not` (h2) | SF (What isn't). The "is" can't simply contract here. |
| app/reading-program/page.js:117 | `…We set the window when we set the edition, and we would rather say so here than print a calendar…` | SF (we'd) |
| app/reading-program/page.js:123 | `…it carries its dates, its window, its prize table and its terms, and it is the only page that can be right about them. When one is coming, it is announced…` | SF ×2 (it's) |
| app/reading-program/page.js:141 | `…the standings move as readers read, and they are marked provisional throughout — because they are a display of a running total, not a result.` | SF ×2 (they're) |
| app/reading-program/page.js:148 | `…Points that cannot be traced to real reading come off.…` | SF (can't) |
| app/reading-program/page.js:157 | `A closed edition is not taken down.…` | SF (isn't) |
| app/reading-program/page.js:163 | `The all-time board does not reset` (h2) | SF + H. (also in §2) |
| app/reading-program/page.js:173 | `That is deliberate, … A fortnight in autumn cannot be compared with a month of summer … which is why it is the one that never starts again.` | SF ×3 (That's, can't, it's) |

---

## 5. Judgement calls

These are listed for a ruling and aren't counted as breaches.

**a. Imperative headings with no stop.** Is an imperative a "full sentence"? The house already treats some as sentences: AuthModal's titles are `Join the island.`, `Reset password.` and `Check your inbox.`, and the Series head is `Sign in to read.`. Others go without a stop:
- app/lib/accountDeletion.js:14 `Delete your account` (modal title) · :29 `Sign in again to continue` (re-auth title)
- app/open-pages/edit/[id]/page-client.js:508 `Edit your story` (h1) · :433 `Sign in to edit` (display heading)
- app/open-pages/new/page.js:503 `Tell your story` (display heading)
- app/my-library/page.js:849 `Save stories to read offline` (`.ml-gate-h`) · :952 `Keep your shelf longer` (`.ml-nudge-t`)
- app/my-library/read/page.js:210 `Sign in to open your shelf` (`.sr-gate-h`)
- app/settings/page.js:301 `Reset password` (modal title). This one is inconsistent with AuthModal:191 `Reset password.`

**b. Full-sentence banner titles set in caps like eyebrows, no stop:**
- app/lib/membershipReturn.js:32 `THE PAYMENT DIDN’T GO THROUGH` · :60 `WE CAN’T CONFIRM IT YET` · :24 `SIGN IN TO SEE IT`
- app/membership/page.js:439 `YOU’RE IN` · :447 `YOUR PLAN HAS CHANGED` · :453 `YOUR PASS IS LIVE` · :461 `NOTHING WAS CHARGED`
- app/my-library/page.js:898 and app/my-library/read/page.js:181 `OFFLINE — YOUR SHELF IS HERE`

**c. Greetings and one-word fragments used as headings, with a stop:** app/components/AuthModal.js:189 `Welcome back.` (title) · app/bookstore/components/LaunchGate.js:408 `Welcome back.` · app/lib/verifyEmail.js:40 `Sent. Check your inbox.` · app/membership/page.js:135 `Nothing held back.` (platinum card line) · app/components/AuthModal.js:147 `Incorrect password.` / :151 `Incorrect email or password.` (error fragments). Also app/components/Gateway.js:741 `Welcome to the Story Island` (h1, no stop).

**d. Sentence-shaped lines that aren't headings but have no stop:** app/components/AuthModal.js:583 `Return here — your account will activate automatically` (step 3) · app/components/MembershipSection.js:236 `You keep everything until the end of the period you’ve paid for` (row hint) · app/open-pages/new/page.js:832 `Deploy queued — your story will appear shortly` (status) · app/components/Gateway.js:772 `The Square is open tonight ✦` · app/square/page.js:1581 `Sign in to join the conversation`. The last one sits against app/user/page.js:576 `Sign in to follow {firstName}.`, which has a stop.

**e. Possessive *have*, where "you've" would be unidiomatic in British English:** app/components/MembershipSection.js:267 `Cancelled. You have everything until ${date}, and nothing more will be charged.` · app/components/QuizGuidelinesModal.js:101 `You have two attempts.` · app/lib/openPagesDrafts.js:248 `You have ${n} drafts, which is the limit.` · app/components/SaveForOffline.js:213 `Your plan holds {cap}, and you have {n} —` · privacy/terms `You have the right…` and `confirm you have the rights…`.

**f. Clause-final "is"/"are", which can't contract (not breaches):** app/open-pages/edit/[id]/page-client.js:390 `Your published story stays as it is until they clear.` · membership:731 `as they are to everyone` · app/app/page.js:87 `When it is`.

---

## 6. Server error strings that reach the reader's UI (`functions/api/*`)

Checked against the client code that renders each one:
- `/api/bookstore/*` goes through `lib/bookstore/checkout.js` and `stream.js`, then BuyButton and the book-reader gate.
- `/api/membership/*` goes through `MembershipCheckoutError`, then /membership and Settings.
- `/api/series/stream` goes to the series reader gate.
- `/api/auth/send-verification` goes to AuthModal "Could not resend: …".
- `/api/open-pages/moderate` goes to composer and editor `data.error`.

| file:line | string | rule | where |
|---|---|---|---|
| functions/api/bookstore/checkout.js:64, :68 | `Purchasing is not configured yet. Please try again later.` | SF | Buy button error |
| functions/api/bookstore/checkout.js:130 | `Could not reach the catalogue. Please try again.` | SF | Buy button |
| functions/api/bookstore/checkout.js:133 | `That title is not in the catalogue.` | SF | Buy button |
| functions/api/bookstore/checkout.js:134, :148 | `That title is not on sale.` | SF | Buy button |
| functions/api/bookstore/checkout.js:245, :249, :254 | `Checkout could not be opened. Please try again.` | SF | Buy button |
| functions/api/bookstore/paystack-checkout.js:65 | `This book is not yet priced in naira. Please buy it in pounds instead.` | SF | Buy button (NGN) |
| functions/api/bookstore/paystack-checkout.js:79 | `Naira payments are not configured yet. Please try again later.` | SF | Buy button (NGN) |
| functions/api/bookstore/paystack-checkout.js:83 | `Purchasing is not configured yet. Please try again later.` | SF | Buy button (NGN) |
| functions/api/bookstore/paystack-checkout.js:126 | `Could not reach the catalogue. Please try again.` | SF | Buy button (NGN) |
| functions/api/bookstore/paystack-checkout.js:129 | `That title is not in the catalogue.` | SF | Buy button (NGN) |
| functions/api/bookstore/paystack-checkout.js:130, :141 | `That title is not on sale.` | SF | Buy button (NGN) |
| functions/api/bookstore/paystack-checkout.js:180 | `This title cannot be purchased in naira.` | SF | Buy button (NGN) |
| functions/api/bookstore/paystack-checkout.js:190, :227, :231, :237 | `Checkout could not be opened. Please try again.` | SF | Buy button (NGN) |
| functions/api/bookstore/stream.js:179, :183 | `Reading is not configured yet. Please try again later.` | SF | book reader gate |
| functions/api/bookstore/stream.js:224, :241, :272 | `Could not open your copy just now. Please try again.` | SF | book reader gate |
| functions/api/bookstore/stream.js:245 | `You do not own this book yet.` | SF | book reader gate |
| functions/api/membership/checkout.js:128, :132 | `Memberships are not available yet. Please try again later.` | SF | /membership |
| functions/api/membership/checkout.js:176 | `That membership is not available in this currency.` | SF | /membership |
| functions/api/membership/checkout.js:221 | `That membership is not available yet.` | SF | /membership |
| functions/api/membership/checkout.js:238 | `Your plan could not be changed just now. Please try again.` | SF | /membership (switch) |
| functions/api/membership/checkout.js:210, :275, :279, :284 | `Checkout could not be opened. Please try again.` | SF | /membership |
| functions/api/membership/pass-checkout.js:88 | `That pass is not sold in this currency.` | SF | /membership passes |
| functions/api/membership/pass-checkout.js:99 | `Passes are not available yet. Please try again later.` | SF | /membership passes |
| functions/api/membership/pass-checkout.js:175, :179, :184 | `Checkout could not be opened. Please try again.` | SF | /membership passes |
| functions/api/membership/paystack-checkout.js:75 | `Naira memberships are not available yet.` | SF | /membership (NGN) |
| functions/api/membership/paystack-checkout.js:97 | `That membership is not available in naira.` | SF | /membership (NGN) |
| functions/api/membership/paystack-checkout.js:116 | `This account cannot pay in naira.` | SF | /membership (NGN) |
| functions/api/membership/paystack-checkout.js:148 | `Your plan could not be changed just now. Please try again.` | SF | /membership (NGN switch) |
| functions/api/membership/paystack-checkout.js:133, :178, :182, :188 | `Checkout could not be opened. Please try again.` | SF | /membership (NGN) |
| functions/api/membership/paystack-pass-checkout.js:63 | `That pass is not sold in naira.` | SF | /membership passes (NGN) |
| functions/api/membership/paystack-pass-checkout.js:74 | `Naira passes are not available yet.` | SF | /membership passes (NGN) |
| functions/api/membership/paystack-pass-checkout.js:117 | `Passes could not be opened for this account.` | SF | /membership passes (NGN) |
| functions/api/membership/paystack-pass-checkout.js:145, :149, :155 | `Checkout could not be opened. Please try again.` | SF | /membership passes (NGN) |
| functions/api/membership/paystack-cancel.js:75 | `There is no naira membership to cancel.` | SF | Settings → Membership (NGN cancel) |
| functions/api/membership/portal.js:76 | `We are still setting up your membership. Try again in a moment.` | SF | Settings → Manage |
| functions/api/membership/portal.js:77 | `You do not have a membership to manage yet.` | SF | Settings → Manage |
| functions/api/membership/portal.js:87, :108 | `Membership management is not available yet.` | SF | Settings → Manage |
| functions/api/membership/portal.js:124 | `Could not reach your membership just now. Please try again.` | SF | Settings → Manage |
| functions/api/membership/portal.js:155, :159, :164 | `Could not open membership management. Please try again.` | SF | Settings → Manage |
| functions/api/series/stream.js:174, :178 | `The Series is not configured yet. Please try again later.` | SF | series reader gate |
| functions/api/series/stream.js:220 | `That instalment could not be found.` | SF | series reader gate |
| functions/api/auth/send-verification.js:96 | `Could not reach the mail service.` | SF | AuthModal "Could not resend: …" |
| functions/api/auth/send-verification.js:102 | `Verification email could not be sent.` | SF | AuthModal "Could not resend: …" |
| functions/api/open-pages/moderate.js:446 | `Could not load the post to edit.` | SF | Open Pages editor error |

---

## 7. Legal pages (grouped separately)

### /terms
| file:line | string | rule |
|---|---|---|
| app/terms/page.js:39 | `…By using Story Island you confirm that you are at least 18.` | SF (you're) |
| app/terms/page.js:44 | `You are responsible for keeping your login credentials secure…` | SF |
| app/terms/page.js:45 | `…(including a date of birth that confirms you are 18+)…` | SF |
| app/terms/page.js:56 | `You are solely responsible for your user content and confirm you have the rights necessary to share it.` | SF ("You are"). "you have the rights" is possessive, see §5e. |
| app/terms/page.js:62 | `post or share content that is unlawful, harassing, …` | SF (that's), weak: a relative clause in a legal list |
| app/terms/page.js:96 | `…Calvary will not be liable for any indirect… Nothing in these Terms excludes or limits liability that cannot be excluded…` | SF ×2 (won't, can't) |
| app/terms/page.js:106 | `We may update these Terms from time to time. We will update the "Last updated" date above…` | SF (We'll) |
| app/terms/page.js:55 | `Licence to us.` (bold lead-in) | F. |
| app/terms/page.js:56 | `Your responsibility.` (bold lead-in) | F. |

### /privacy
| file:line | string | rule |
|---|---|---|
| app/privacy/page.js:42 | `…and you must confirm you are 18 or older. The Service is not directed to children, and we do not knowingly collect personal data… please contact us and we will delete it.` | SF ×4 |
| app/privacy/page.js:49 | `collected at email sign-up to confirm you are 18 or older.` | SF |
| app/privacy/page.js:66 | `We do <strong>not</strong> use third-party advertising or analytics/tracking SDKs in the app.` | SF, but the *not* is deliberately bold (emphatic) |
| app/privacy/page.js:74 | `(confirm you are 18+)` | SF |
| app/privacy/page.js:87 | `We do <strong>not</strong> sell your personal data, and we do not share it with advertisers.` | SF ×2 (first is emphatic) |
| app/privacy/page.js:89 | `The Story Island mobile app does <strong>not</strong> include any analytics or tracking SDKs.` | SF (emphatic) |
| app/privacy/page.js:113 | `…if you are unhappy with how we handle your data.` | SF (you're) |
| app/privacy/page.js:122 | `We will update the "Last updated" date above…` | SF (We'll) |
| app/privacy/page.js:89 | `Analytics.` (bold lead-in) | F. |

The legal h2s (`1. Eligibility`, `2. Information we collect`, `7. Your rights and choices`…) are noun-phrase section labels, which is correct.

### Summer 2026 contest terms (/leaderboard/summer-2026/terms)
| app/leaderboard/summer-2026/terms/page.js:55 | `…Points that cannot be traced to real activity are removed…` | SF (can't) |
|---|---|---|

---

## 8. Emails and the offline page

| file:line | string | rule | where |
|---|---|---|---|
| public/sw.js:331 | `This story isn&rsquo;t on your shelf` (offline page `<h1>`) | H. | service-worker offline page, story variant |

- `public/sw.js` is otherwise clean. `No signal` is a fragment, `TRY AGAIN` and `GO TO MY LIBRARY` are buttons, and the bodies already use short forms.
- `emails/WeeklyDigest.jsx` is clean. It already uses "You're receiving this…".
- `app/lib/newsletterRender.js`: reader-facing chrome is clean. Its only prose strings are admin validation.
- **No reader email bodies live in `functions/`.** Verification and welcome mail are rendered by the external mail Worker, which isn't in this repo. `functions/api/_money.js:70-71` (`…you will not get another email…`, `A retry cannot fix this one.`) and `functions/api/ops/launch-email.js` are founder/ops alerts, not reader mail.

## 9. Metadata and aria

- **Metadata titles and descriptions: no breaches.** Titles are name-style (`… — Calvary Scribblings`). Descriptions contain no long forms, and none is a heading.
- **aria-label, alt, title and placeholder attributes: no breaches.** None contains a long form and none ends in a full stop.

---

## 10. Checked and set aside (not counted)

- **`functions/api/story.js` errors** (`Reading is not configured yet…`, `Could not open that story just now…` ×4, `That story could not be found.`, `This story could not be prepared for preview.`, `We could not check your membership just now.`) and `app/lib/story.js:50/87/92`. The web story page only `console.error`s these (`page-client.js:988`) and shows its own copy instead. **The app may render them**, so they're worth fixing alongside the others.
- **`functions/api/account/delete.js:102`** (`We could not finish deleting your account… it will pick up…`) and **`_deletion.js:113`** (`This account cannot be deleted here.`). The web modal shows `COPY.failed` instead, and only passes server text through on a 429 or 503. The app may show them.
- **`functions/api/auth/welcome.js`** (`Account is not verified.`, `Could not reach the mail service.`, `Welcome email could not be sent.`). Fire-and-forget, logged only.
- **`functions/api/evaluate-quiz.js:231` and `generate-quiz.js:275`** (`Could not read the story just now…`). The quiz UI throws its own `Evaluator ${status}` and never renders these. generate-quiz is admin-only.
- **`functions/api/hit.js:170`, `holders.js`, `rebuild.js`, `ops/launch-email.js`, the webhooks' `why:` strings, and `_money.js`**: telemetry, admin or ops only.
- **API validation fragments ending in a stop** (`Invalid request body.`, `Unauthorised.`, `Unsupported currency.`, `titleId required.`, `Server misconfigured.`, `Choose Gold or Platinum.`, … about 45 strings). These only reach a reader on a malformed request.
- **`app/components/GatePreview.js:31`** (`…as they will be after the switch… every device you are signed in on.`). Founder-only.
- **Admin-only lib copy** reached from `/admin` only: `newsletterOutcome`, `voicesOutcome`, `rebuild`, `rebuildWatch`, `coverDescriptor`, `bookstore/{admin-writes,schema,sections,withdrawal,territory}`, `series/{admin-writes,schema}`, `build-read.mjs`, `grain.js`, `bookTransition.js`.
- **LLM system prompts** (`evaluate-quiz`, `generate-quiz`, `open-pages/moderate`, `lib/voiceScreening`) aren't copy. One caveat: the moderation model's free-text `reason` **is shown to writers** (`open-pages/new:471`, `edit:395` via `data.reason`). The prompt (`moderate.js:133`) asks for "one concise reason sentence" and doesn't ask for short forms.

---

## Counts

Each file:line row counts once. Where a row lists several line numbers for the same string (e.g. `:245, :249, :254`), each line number counts separately.

| section | definite breaches |
|---|---|
| §1 Reader UI, short form | **54** (openPagesDrafts:248 is excluded as a §5e judgement) |
| §2 Reader UI, heading without full stop | **14** strings. The 3 composer outcome titles are also in §1, and reading-program:163 is also in §4. |
| §3 Reader UI, fragment or label with full stop | **27** (1 of them, `Locked.`, is dead copy) |
| §4 Authored prose: /about 1 · /ai-policy 3 · /app 3 · /membership 12 · /reading-program 13 | **32** |
| §6 Server errors rendered in UI (by line number): bookstore 27 · membership 37 · series 3 · auth 2 · open-pages 1 | **70** |
| §7 Legal: /terms 9 · /privacy 9 · summer terms 1 | **19**. This includes 3 bold lead-ins with a stop; 3 of the privacy hits are the emphatic bold *not*. |
| §8 Emails and offline page | **1** (the sw.js offline h1) |
| §9 Metadata and aria | **0** |
| **Total definite** | **217 locations, 213 distinct** after the 4 overlaps |
| §5 Judgement calls (not counted) | about 40 strings across 6 kinds |
| §10 Set aside (not rendered on web, admin, ops) | about 20 strings, plus about 45 API validation fragments |

Hotspots:
- `functions/api/membership/*` (37 lines) and `functions/api/bookstore/*` (27 lines) carry most of the short-form debt.
- `Checkout could not be opened. Please try again.` alone appears 24 times: 21 lines across 6 endpoints, plus 3 client fallbacks (BuyButton.js:69, lib/bookstore/checkout.js:69, lib/membershipCheckout.js:29).
- `/membership` and `/reading-program` are the densest authored prose.
