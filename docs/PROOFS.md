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

## Tests

| command | what |
|---|---|
| `npm run test:proofs` | the pure rules: what a proof is, who sees it, London time, report limits, the email |
| `npm run test:proofs:emulator` | the Functions against the RTDB emulator (port 9410), and the rules both ways round |
| (same) `tests/proofs/cms.emulator.mjs` | **the CMS under the new rules**: every `/admin` write to `cms_stories` (save in each state, hide, unhide, delete, Extract Text, quizzes), cut from the source of origin/main AND this branch and run as a stand-in founder; the Worker's go-live PATCH and `retire.mjs` replayed under the rules; the forbidden shape still refused |
| `npm run test:proofs:browser` | two real builds (live-page parity by hash) and a browser: list, proof, report, closed switch, alignment at 390 and 1280 |

No founder account is used anywhere, even in the emulator. The Functions take an injectable
founder check (a stand-in uid). The rules test loads `database.rules.json` with the two founder uids
replaced by same-length stand-ins, and proves the swap touched nothing else. The emulators run on
their own ports (`firebase.proofs-test.json`: auth 9099, database 9410, storage 9411).
