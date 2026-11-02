# Proofs (PROOFS-R2, rulings 249–258 and 276–280)

A writer signs in at `/proofs` and sees their own scheduled stories, each exactly as it will
publish, with the London date and time it goes live. From any proof they can report a
discrepancy to the editors. A story leaves Proofs the moment it goes live. Web only; writer
emails are R3.

**Founders first (ruling 258).** Proofs is open to the two founder accounts only until Ikenna
flips the switch in `/admin/proofs`. The server reads the switch on every call. Founders see
every writer's scheduled stories, grouped by writer.

## The pieces

| piece | where |
|---|---|
| what a proof is, who sees it, the words | `app/lib/proofs.js` (pure; shared by all of the below) |
| the list and one proof | `functions/api/proofs/index.js`, POST `{ action: 'list' \| 'proof', slug }` |
| a report | `functions/api/proofs/report.js`, POST `{ slug, message }` |
| the page | `app/proofs/` — a static shell, noindex (metadata and `_headers`) |
| the proof itself | `app/stories/[slug]/page-client.js` with `proof` set: the published page's own component |
| the switch and the queue | `app/admin/proofs/page.js` |
| rules | `database.rules.json`: `story_proof_reports`, `proofs_access`, and `cms_stories` (below) |

**A proof** is `storyStatus(rec) === 'scheduled'`: `published === false`, no `hiddenAt`, and a
`publishAt` still in the future. A retired slug is excluded twice (it carries `hiddenAt`, and its
`cms_stories_retired` marker is checked). Its text comes from `story_bodies` only (ruling 255),
never from a copy on the record.

**Who sees what** is decided on the server, from the verified ID token:

- a writer sees the proofs whose `authorUid` is their uid. Another writer's proof answers 404,
  exactly like a slug that never existed;
- a founder (`isFounder(uid)`) sees all of them;
- anyone else, and every non-founder while the switch is closed (or unreadable), gets the same
  nothing: an empty list, and 404 for any proof or report.

**A proof counts nothing**: no `/api/hit`, no read credit, no `/api/story`, and no comments,
reactions, quiz, shelf or invitations. Every difference is guarded on `proof`, which the live page
never passes. `tests/proofs/browser.e2e.mjs` builds the site with and without this change and
compares every live story page's HTML by hash.

**A report** is validated (10–2000 characters), rate-limited through the shared limiter (3 a
minute and 20 a day per writer, 300 a day in all; it fails closed; ruling 278 — each cap has its own line, ruling 276), checked against the same
visibility as the proof, written server-side to `story_proof_reports/{id}`, and mailed to the
editors through `_alerts.js` once per report. The email carries the slug, the go-live time and the
report id, never the writer's words, which may quote unreleased text. A report never touches the
story or its schedule.

## The rules

- `story_proof_reports`: founders read the queue; a report's own writer reads that report. No
  client creates one. Founders may write `status` (received, fixed or left), `statusAt` and
  `statusBy` (themselves), and only on a report that exists. Indexed on `reporterUid`.
- `proofs_access`: founders only, exactly `{ open: boolean, changedAt, changedBy: self }`.
- `cms_stories`: indexed on `published` as well (the founders' list is one indexed query).
- **No text unless live.** A client write can't leave `content` or `extractedText` (other than
  `''`) on a `cms_stories` record whose `published` is `false`: writing text into a story that
  isn't live is refused, and so is taking a story down while its text stays on the record.

**Who the "no text unless live" rule actually constrains.** `cms_stories` is writable by the two
founder accounts only, so the rule binds **the founders' browser CMS (`/admin`)** and nothing else.
Everything below writes with admin credentials and bypasses rules entirely. They keep ruling 255
because they all place text through `placementPaths`, and their tests prove it:

- the scheduled-publish Worker (`calvary-newsletter`, legacy `FIREBASE_SECRET`);
- the covers reconciler, `retire.mjs`, `unreleased-text-out.mjs`, `backfill-story-bodies.mjs` and
  every other admin-key script;
- Pages Functions using an admin token.

## Writer emails (PROOFS-R3, rulings 254, 290–292)

| piece | where |
|---|---|
| what is due, the ledger shape, the words, the samples | `app/lib/proofMail.js` (pure) |
| the engine: open, close, "Email them", the tick, the samples | `functions/api/proofs/_mail.js` |
| the founders' endpoint | `functions/api/proofs/writers.js`, POST `{ action: 'list' \| 'open' \| 'close' \| 'include' \| 'sample' }` |
| the tick endpoint | `functions/api/proofs/mail-tick.js` (ops service token, or a founder) |
| the clock | `.github/workflows/proofs-mail.yml` → `scripts/proofs/mail-tick.mjs`, every 15 minutes |
| rules | `proofs_mail` server-only; `proofs_access` server-written; `users` indexed on `isAuthor` |

**Opening.** "Open Proofs to writers" shows every account with the writer badge (`users/{uid}/isAuthor`),
each with its number of scheduled stories, ticked. Confirming marks the unticked writers `excluded`,
claims each ticked writer's opening and seeds their scheduled stories as told, opens the switch, and
then sends. A writer already emailed is shown "Already emailed" and is never sent the opening again.

**Afterwards** the tick compares what is scheduled now against the ledger, so a change made by any
path is caught: a story first scheduled ("scheduled"), a go-live time that isn't the one the writer
was last told ("changed"), and 48 hours before ("reminder", skipped if the writer was told that time
inside the 48 hours). While Proofs is closed the tick does nothing.

**Once.** Every ledger change is a create-only or compare-and-swap PUT made before the email. A failed
send is recorded with its reason and not retried. The ledger:
`proofs_mail/writers/{uid}/{opening | excluded | stories/{slug}}`, each story record carrying the
go-live time last told, and a log (`e1`, `e2`, …) of every email and its outcome.

**Edge cases.** No email address (or not verified, or the account disabled): nothing is claimed;
once they have one, the next tick sends what is due (the opening email, if they never had it). A
writer unticked at opening gets nothing until a founder presses "Email them". A writer badged after
opening gets the opening email at their first scheduled story. A story unscheduled or hidden after
its email: nothing is sent; if it comes back at a new time, "changed".

**Samples.** "Send me a sample" mails all five emails, filled with invented stories, to the
signed-in founder's own verified Auth address, and writes nothing.

## Tests

| command | what |
|---|---|
| `npm run test:proofs` | the pure rules: what a proof is, who sees it, London time, report limits, the email; and (mail.test.mjs) what is due, the writer-email words, the tick's log line |
| (emulator) `tests/proofs/mail.emulator.mjs` | the writer emails end to end: the opening list and unticking, once only (toggle, rerun, concurrent ticks), the seeding, scheduled / changed / 48 hours, every edge case, the samples |
| `npm run test:proofs:emulator` | the Functions against the RTDB emulator (port 9410), and the rules both ways round |
| (same) `tests/proofs/cms.emulator.mjs` | **the CMS under the new rules**: every `/admin` write to `cms_stories` (save in each state, hide, unhide, delete, Extract Text, quizzes), cut from the source of origin/main AND this branch and run as a stand-in founder; the Worker's go-live PATCH and `retire.mjs` replayed under the rules; the forbidden shape still refused |
| `npm run test:proofs:browser` | two real builds (live-page parity by hash) and a browser: list, proof, report, closed switch, alignment at 390 and 1280 |

No founder account is used anywhere, even in the emulator. The Functions take an injectable
founder check (a stand-in uid). The rules test loads `database.rules.json` with the two founder uids
replaced by same-length stand-ins, and proves the swap touched nothing else. The emulators run on
their own ports (`firebase.proofs-test.json`: auth 9099, database 9410, storage 9411).
