# App hand-off: the Square's write Function (W54 → A44)

W54 moved the web's Square posts, replies and edits onto a server Function. In A44 the app must
move onto it too. The web is the reference for **systems**. Once both clients use the Function,
**W56 tightens the rules** so that `square_posts` can only be written through it. **The app's direct
writes stop working at W56**, so A44 has to ship first.

## The endpoint

`POST https://calvaryscribblings.co.uk/api/square/write`

- **Credential:** `Authorization: Bearer <Firebase ID token>`, in the header only. Identity is never
  read from the body.
- **Body:** one of these.

| action | body | notes |
|---|---|---|
| `post` | `{ action: 'post', text, attachedStory?, quotedPostId?, poll? }` | `poll` only for `canPin` / `canRemovePosts` readers (and founders) |
| `reply` | `{ action: 'reply', text, parentId, replyToId? }` | `parentId` is the **root**, always. `replyToId` is another reply in the same thread |
| `edit` | `{ action: 'edit', id, text }` | your own post or reply, within 5 minutes of its `createdAt`, text only |

- **Success:** `200 { ok: true, id, record }`. `record` is exactly what was written to
  `square_posts/{id}`.
- **Refusal:** `4xx/5xx { ok: false, code, error }`.

## What the server decides (and the app must stop sending)

- **The author snapshot.** It is built from the verified account and `users/{uid}`: `authorUid`,
  `authorName`, `authorInitials`, `authorHandle`, `authorAvatarUrl`, `authorReadCount`, `isAuthor`.
  Any author field in the body is ignored. Stop sending them.
- **`createdAt`.** The server's clock.
- **No counts.** The record has no `likeCount`, `fireCount` or `clapCount` (see Reactions below).
- **`pinned: false`** on every new record.

## Refusals

| code | status | `error` (show it) | when |
|---|---|---|---|
| `closed` | 403 | **The Square opens at 8pm.** | a post or reply outside 20:00–00:05 London (ruling 210). Founders exempt. Edits are not checked |
| `rate` | 429 | **Too much at once. Try again in a minute.** | over 5 posts or 30 replies in any 10 minutes (ruling 211) |
| `invalid` | 400 | e.g. "12 characters over. The Square holds 500." | caps (500 post / 300 reply), attachment or poll shape |
| `poll` | 403 | — | a poll from a reader without the switch |
| `missing` | 404 | — | the post or root is not in the room (archived, deleted) |
| `not_yours`, `withdrawn`, `edit_window` | 403 / 409 | — | edit refusals |
| `signed_out` | 401 | — | no token, or one Google refuses |
| `unavailable` | 502 / 503 | — | anything else |

**Showing a refusal.** The failure states stay as they are (ruling 205): the words are kept, with
"Not sent.", Try again and Remove. **For `closed` and `rate` only**, put the Function's `error`
after "Not sent." (the web draws "Not sent. Too much at once. Try again in a minute."). Every other
code shows "Not sent." alone. Remove writes nothing.

## After a save: the same as now

The Function writes `square_posts/{id}` and nothing else. The app still:

1. **writes the mirror** `user_square_posts/{uid}/{id}` from the returned `record`. For a post,
   the record as returned. For a reply, `{ text, authorUid, parentId, createdAt, replyToId? }`,
   with `createdAt` taken from the record;
2. **sends the notifications** (mentions, followers, quote, reply), each on its own with its
   refusal caught (W53).

A save is finished when the Function answers 200 (W51). Nothing after that can undo it.

## Reactions (W54 §3)

- **Counts are who reacted.** Count the `true` leaves under `square_reactions/{postId}/{type}`
  (`square_archive_reactions/{postId}/{type}` for an archived thread). Do this on the feed, the
  thread, the archive and profiles.
- **Stop reading and writing** `likeCount`, `fireCount` and `clapCount` on `square_posts`. The
  stored values have drifted from the lists, and the web no longer reads them.
- **Reactions stay direct writes:** `square_reactions/{postId}/{type}/{uid} = true`, removed to
  un-react. The rules are unchanged.

## What did not change in W54

- **The rules.** The only addition is `square_rate` (`.read: false`, `.write: false`), the
  server-only pace counter. Direct client writes to `square_posts` still pass, which is why the app
  keeps working until A44.
- **Withdraw, moderator removal, pin, poll votes, reports.** These are still direct writes from the
  client. W56 decides whether any of them move.

## The numbers, and the ground they were measured on

- **The hours:** 20:00:00 to 00:05:00 London inclusive, from the `Europe/London` zone. On 25 Oct
  the opening moves from 19:00 UTC to 20:00 UTC. The unit tests pin both sides
  (`tests/square/write.test.mjs`).
- **The pace:** a sliding 10-minute window per reader, posts and replies counted separately. A
  refused request (hours, shape, pace) spends no slot. A request that passed and then failed to
  write has spent one.
- **The edit window:** 5 minutes from the server's `createdAt`, the same window the menu already
  uses to show Edit.

## W55 — also for A44: the reply box, Quote in the thread, a moderator's wording

W55 built three small things on the web's thread (W52). A44 ships them with the Function. Rulings
212, 213, 215 and 216 are in `docs/COPY-RULINGS.md`. The web is in `app/square/p/page.js` and
`app/square/page.js`. The wording is in `app/lib/squareThreads.js`.

**1. The reply box grows (212, 216).**

- On the web: 16px type, 20px line, 11px padding top and bottom, 1px border. That measures 44px
  at one line, 64 at two and 84 at three. At four lines it stays 84 and scrolls inside. The radius
  stays 22.
- **Re-measure on the app's own type.** Don't copy the web's pixels. What carries over: one line
  matches the Send button's height, the box grows one line at a time, and it stops at three lines.
- The row aligns to the bottom, so Send sits beside the last line. At one line nothing moves.
- The "Replying to" row, the mention list and the counter keep their places relative to the box.
- The space at the foot of the thread grows by exactly what the box grew, so the last reply never
  sits under the bar.
- After a send (a 200 from the Function), the box goes back to one line.

**2. Quote on the thread's opening post.**

- A "quote" control after "reply", styled like it. It shows exactly when "reply" does: the room
  is open, the reader is signed in, the thread is in the room, and the post isn't withdrawn.
- It opens the feed's composer with the post quoted and the cursor in it, the same as Quote in
  the feed. If the post has left the room by then (gone from `square_posts`, withdrawn, or a
  reply), the composer opens without it. The web passes this as `/square?quote={id}` and reads
  it once.
- Replies have no Quote. No quote counts yet: they come with the card redesign, on the feed and
  the thread together.

**3. A moderator's wording (213, 215).**

- **Menu (213).** On a reply, the item says "Withdraw reply" to its author and "Remove reply" to
  a moderator. The web already does this. The app catches up here.
- **Confirmation (215).** A moderator removing someone else's opening post is asked "Remove this
  post?". If the post has replies, the confirmation adds "The N replies beneath it will stay."
  (with one reply: "The 1 reply beneath it will stay."). The author's words don't change:
  "Withdraw this post?" plus "The N replies beneath it will stay — they aren't yours to delete.",
  or "Withdraw this post? It'll be removed from the Square."
- The same words on the feed and the thread.
- What it writes doesn't change: `withdrawn` + `removedBy: 'moderator'` when there are replies,
  a hard remove when there are none. A moderator can't remove another reader's
  `user_square_posts` mirror. The rules refuse it, so catch that refusal. The web's feed left it
  unhandled until W55.
