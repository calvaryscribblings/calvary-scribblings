# App hand-off: the Square's write Function (W54 → A44)

W54 moved the web's Square posts, replies and edits onto a server Function. In A44 the app must
move onto it too. The web is the reference for **systems**. Once both clients use the Function,
**W55 tightens the rules** so that `square_posts` can only be written through it. **The app's direct
writes stop working at W55**, so A44 has to ship first.

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
  client. W55 decides whether any of them move.

## The numbers, and the ground they were measured on

- **The hours:** 20:00:00 to 00:05:00 London inclusive, from the `Europe/London` zone. On 25 Oct
  the opening moves from 19:00 UTC to 20:00 UTC. The unit tests pin both sides
  (`tests/square/write.test.mjs`).
- **The pace:** a sliding 10-minute window per reader, posts and replies counted separately. A
  refused request (hours, shape, pace) spends no slot. A request that passed and then failed to
  write has spent one.
- **The edit window:** 5 minutes from the server's `createdAt`, the same window the menu already
  uses to show Edit.
