# Owed: the react-hooks 7.1 findings

NEXT-UPGRADE (29 Oct 2026) moved `eslint-config-next` to 16.4.3, which asks for
`eslint-plugin-react-hooks ^7.1.0`. Version 7.1.1 reports **65 new errors** and clears **1**
(net **+64**: the lint ratchet went 220 → 284). `package.json` holds the plugin at 7.0.1
through `overrides` (see its `"//overrides"` note), and the ratchet stays at 220.

**The round that lifts the override starts here.** Fix these, remove the override and its note,
re-run `npm run lint:ratchet`, and lower the baseline by whatever else the fixes clear.

Measured on the same source (`c7cab060` + the upgrade), `npx eslint .` with 7.0.1 against 7.1.1,
matched by file and rule. Line numbers are 7.1.1’s report at that commit; they will drift.

## By rule

| rule | new errors |
|---|---|
| `react-hooks/set-state-in-effect` | 44 |
| `react-hooks/purity` | 14 |
| `react-hooks/refs` | 5 |
| `react-hooks/immutability` | 2 |
| **total** | **65** |

Cleared by 7.1.1: `app/components/SeasonBoard.js` · `react-hooks/set-state-in-effect` (1).

## By file

| file | rule | count | lines |
|---|---|---|---|
| `app/admin/exercises/page.js` | `purity` | 2 | 77, 83 |
| `app/admin/forum/page.jsx` | `purity` | 1 | 167 |
| `app/admin/quizzes/page.js` | `set-state-in-effect` | 1 | 179 |
| `app/admin/submissions/page.js` | `purity` | 2 | 77, 83 |
| `app/components/AboutTheAuthor.js` | `set-state-in-effect` | 1 | 161 |
| `app/components/DobCheck.js` | `set-state-in-effect` | 1 | 47 |
| `app/components/Navbar.js` | `set-state-in-effect` | 2 | 53, 65 |
| `app/components/ProfileCompletion.js` | `set-state-in-effect` | 1 | 32 |
| `app/components/QuizCard.js` | `set-state-in-effect` | 2 | 597, 639 |
| `app/components/SaveForOffline.js` | `set-state-in-effect` | 1 | 77 |
| `app/components/seriesNotes/Composer.js` | `set-state-in-effect` | 3 | 108, 116, 123 |
| `app/components/square/MessagesPanel.js` | `purity` | 3 | 218, 235, 236 |
| `app/lib/MembershipContext.js` | `purity` | 1 | 152 |
| `app/lib/MembershipContext.js` | `set-state-in-effect` | 1 | 111 |
| `app/lib/useOpenPagesDraft.js` | `refs` | 2 | 42, 43 |
| `app/lib/useOpenPagesDraft.js` | `set-state-in-effect` | 1 | 50 |
| `app/my-library/page.js` | `set-state-in-effect` | 3 | 320, 348, 392 |
| `app/open-pages/[id]/page-client.js` | `purity` | 1 | 301 |
| `app/open-pages/[id]/page-client.js` | `set-state-in-effect` | 1 | 248 |
| `app/open-pages/drafts/page.js` | `set-state-in-effect` | 1 | 54 |
| `app/profile/page.js` | `set-state-in-effect` | 1 | 317 |
| `app/public-library/page.js` | `purity` | 1 | 1641 |
| `app/public-library/page.js` | `set-state-in-effect` | 4 | 274, 312, 1590, 1662 |
| `app/reader/[slug]/book-reader.js` | `set-state-in-effect` | 1 | 150 |
| `app/reader/[slug]/ReadingRoom.js` | `immutability` | 1 | 1106 |
| `app/reader/[slug]/ReadingRoom.js` | `refs` | 3 | 760, 761, 1388 |
| `app/reader/[slug]/ReadingRoom.js` | `set-state-in-effect` | 7 | 850, 868, 902, 949, 1091, 1368, 1395 |
| `app/rewards/page.js` | `immutability` | 1 | 97 |
| `app/series/[slug]/notes/RoomClient.js` | `purity` | 2 | 451, 452 |
| `app/series/[slug]/notes/RoomClient.js` | `set-state-in-effect` | 2 | 324, 361 |
| `app/square/p/page.js` | `set-state-in-effect` | 3 | 174, 329, 345 |
| `app/square/page.js` | `purity` | 1 | 254 |
| `app/square/page.js` | `set-state-in-effect` | 3 | 202, 240, 587 |
| `app/stories/[slug]/page-client.js` | `set-state-in-effect` | 1 | 1023 |
| `app/user/page.js` | `set-state-in-effect` | 1 | 195 |
| `app/voices/[slug]/page-client.js` | `set-state-in-effect` | 1 | 155 |
| `app/voices/voices-client.js` | `set-state-in-effect` | 1 | 78 |
