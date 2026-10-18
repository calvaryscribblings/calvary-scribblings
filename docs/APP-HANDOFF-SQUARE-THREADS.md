# App hand-off: the Square's threads (W52 → A42)

W52 rebuilt the Square's replies on the web to the threads canvas (25–26 Sept). This is what the
app must mirror in A42. The web is the reference for **systems**. For look, the canvas is the
reference, so re-measure at the app's own widths rather than copying the web's pixels.

**Every rules change is additive.** The app's current writes keep saving until A42 ships. A
pre-A42 reply has no `replyToId`, so it lands as a top-level reply in the thread. Nothing breaks
in the meantime.

## Data (`square_posts/{id}`)

| field | what | rule |
|---|---|---|
| `parentId` | **always the root**, at every depth. This is unchanged and is what the horizon moves threads by. | unchanged |
| `replyToId` *(new, optional)* | the reply being answered | a string of at most 64 characters. It must name a record in `square_posts` whose `parentId` equals this record's `parentId`, and it may not be the root or the record itself. Once written it is never re-judged, so editing a nested reply still saves after its target is removed. |
| `removedBy` *(new, optional)* | `'author'` or `'moderator'` | only alongside `withdrawn: true`. `'author'` requires `auth.uid === authorUid`. `'moderator'` requires `users/{uid}/canRemovePosts`. |

A top-level reply is a reply without `replyToId`.

## Never hard-delete a reply

Withdrawing or removing a reply writes a tombstone in one `update()`:
`{ text: null, attachedStory: null, attachedOpenPage: null, quotedPostId: null, withdrawn: true, withdrawnAt: <ms>, removedBy }`.
The author also removes their own `user_square_posts/{uid}/{id}` mirror.

A tombstone is **drawn only while replies hang beneath it**: a living reply whose `replyToId`
chain passes through it. It shows as a dashed 36px circle (28px when nested) and one of these
lines:

- `removedBy: 'moderator'` → **"This reply was removed."**
- `removedBy: 'author'`, or a legacy `withdrawn` with no `removedBy` → **"The author withdrew this reply."**
- ruling 30's deleted account (`deleted: true`) → **"This post was deleted."**

A tombstone has no face, no name, no reactions and no Reply. It never counts toward the replies
count.

## The thread (`/square/p?id={root}`, `&reply={id}` to open at a reply)

- **Interactive** only when the post is in `square_posts` (not the archive), the room is open
  (20:00–24:00 London) and the reader is signed in. Otherwise the thread is read-only.
- **Header:** a back arrow ("Back to the Square") and THE SQUARE centred in Cinzel.
- **Below the root post:** a "Replies" heading with a gold rule and the live count, then the
  replies oldest first.
- **Two levels, whatever the depth.**
  - A top-level reply has a 36px avatar.
  - A reply to a reply has a 28px avatar, a 48px indent and a gold connector at
    `rgba(201,168,76,0.32)`. It sits under its **top-level ancestor**: follow `replyToId` up
    until a reply has none.
  - A nested reply carries "Replying to @handle" (italic 14px at ink 0.55, the handle in
    `#a989d9`). The handle comes from the answered reply's author, so it stays even when that
    reply is a tombstone.
- **The fold:** each group shows its first **two** nested replies, then "View N more replies"
  ("View 1 more reply" for one). The reader's own reply, just sent, stays visible wherever it
  falls.
- Reply works on every reply except a removed one, and writes `replyToId`.
- **A reply that fails** appears in place at half opacity, with "Not sent." in `#d4537e`, "Try
  again" in `#a989d9` and "Remove" at ink 0.62. Nothing reached the server, so Remove only
  discards the words.
- **The bottom bar:**
  - `#0b0815` with a top hairline.
  - While answering someone, a row reads "Replying to @handle" with a 44px × to stop.
  - The field is 44px with radius 22. Its border is gold at 0.45 while replying, and the answered
    reply is tinted `rgba(107,47,173,0.10)` in the thread.
  - Send is a 44px `#6b2fad` circle.
  - The bar stays above the keyboard.
  - The draft is kept per thread.

## The feed

Replies leave the feed. Each post keeps its reaction row, now with the replies count, plus one
line under it showing the latest living reply:

- a 22px avatar, the name at weight 500, and the words at ink 0.68 with an ellipsis
- 36px tall

That line, the replies count and the post body all open the thread. The line opens it at that
reply.

## Notifications

| who | `type` | words |
|---|---|---|
| the root's author | `square_reply` | "replied to your post" |
| the answered reply's author | `square_reply_to_you` | "replied to you" |
| a mentioned reader | `mention` | (unchanged) |

- Never the same person twice: "replied to you" wins when the root's author and the answered
  reply's author are one person, and mentions skip anyone already told.
- Never yourself.
- Records carry `postId` (the new reply) **and `threadId` (the root)**.
- Every Square link opens `/square/p?id={threadId}&reply={postId}`.
- Older notifications carry only `postId`: `/square/p` resolves a reply's id to its root and
  opens at it.

The words and the logic are in `app/lib/squareThreads.js` (`replyNotifications`,
`NOTIFICATION_WORDS`, `threadHref`).

## Ruling 190

The app's Profile build line goes founder-only. On the web the site footer draws the stamp only
when `isFounder(uid)` is true (`app/lib/founders.js`, the same check /admin uses). The story page
draws none. `/build.json` stays.

## Not in this round

The town-square canvas (rulings 191–203: Tonight's question, Saturday Story, spoilers, line
cuttings, "In the Square" on story pages, Here now, the 8pm notification, night dividers, Earlier
nights, Mute and Block) is recorded in `docs/COPY-RULINGS.md` and built in later rounds.
