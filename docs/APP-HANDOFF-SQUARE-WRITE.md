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

## W55.1 — also for A44: the conversation's menu, muting a conversation, the report step

Rulings 217, 218 and 220 are in `docs/COPY-RULINGS.md`; 219 (the post menu drops Block) is the
app's alone. Web: `app/components/square/MessagesPanel.js`; words and rules of thumb in
`app/lib/squareSafety.js`.

**1. The ⋯ sheet (217).** The web built it to the approved design, at the foot of the Messages
panel at every width: dim rgba(4,3,8,0.6) (tap closes), sheet #0e0b18 with a 1px top border at ink
0.1, 12px top corners, 24px sides, 34px foot, 36×5 grabber. Header: live Avatar 36, name 17/21 500,
"@handle" 14.5 in rgba(169,137,217,0.85). Rows under 1px ink-0.08 hairlines, 20px icon 14px from
16.5px/500 words:

| row | does | once set |
|---|---|---|
| View profile (52px) | opens their reader card | — |
| Mute this conversation (52px) | sets `dm_muted/{uid}/{convId}` | "Unmute this conversation" |
| Report a message + "Pick the message. A moderator sees only that one." | starts the picking | — |
| Block @handle (#e0868f) + "They can't message you, and their posts leave your Square." | the reader card's Block (`blocked_users`) | "Unblock @handle", no hint |

Cancel: 10px below, 50px, 1px ink-0.14 border, fully rounded, 16.5px. The app's sheet was the
design; the web's numbers are the web's measurements, so only check the app against the ruling.

**2. Mute this conversation (218) — a new node, in the rules from W55.1's deploy:**

| path | value | who |
|---|---|---|
| `dm_muted/{uid}/{convId}` | `true` only; `convId` must be one of `{uid}`'s conversations (`{uid}_…` or `…_{uid}`) | the owner only, read and write |

- While set: that conversation's unread count isn't shown **or counted** anywhere — its row, any
  total on the Messages button or tab, the app icon badge, and any push or local alert for a new
  message. The web has only the row count; the app has more surfaces, and every one must skip it.
- Its messages still arrive and show normally. Opening it still clears `unread` as before.
- The sender keeps writing `dm_conversations/{other}/{convId}.unread = 1` exactly as now. The
  mute is never sent to them and nothing the other reader can read changes.
- Unmute deletes the leaf. A node that can't be read counts as nothing muted.
- **Account deletion:** `dm_muted` is an owned node (the endpoint deletes `dm_muted/{uid}` whole;
  the scrub backstops it). Another reader's mute of a conversation with the deleted reader stays,
  like their half of the conversation (ruling 32). Nothing for the app to do beyond not writing it
  for a deleted account.
- **The push server (scripts/push):** sends no DM pushes today. If it ever does, it must read
  `dm_muted/{recipient}/{convId}` and skip.

**3. The report step (220).** After a message is picked, the step shows it under the heading
"THE MESSAGE A MODERATOR WILL SEE" (gold, letter-spaced caps with the gold rule, as the thread's
"REPLIES"), drawn as the bubble it was, then the reasons. What's filed is unchanged.

**4. "Reading since" on the reader card.** Read `users/{uid}/joinDate`, then `createdAt`; a
number of milliseconds or a string Date can read; leave the line out when neither is usable, and
never fail on a bad value. Live, 19 Oct 2026 (`scripts/square/reading-since-count.mjs`, read-only):
323 reader records — 165 with joinDate, 56 with createdAt, 12 with both, 114 with neither; all
numbers, none unusable. Reading createdAt alone showed the line for 56; joinDate-then-createdAt
shows it for 209. If the app's card reads only one of the two, it has the same gap.

## W55.2 — also for A44: the keyboard, images in messages, the failed message

Rulings 222–225 are in `docs/COPY-RULINGS.md`. Web: `app/components/square/MessagesPanel.js`,
`app/lib/dmImages.js` (the shared words, names and the 24-hour test), `functions/api/square/dm-image.js`,
`functions/api/square/report-image.js`.

**1. The keyboard.** The ruling: in a conversation the message box sits on top of the keyboard,
with the latest message in view above it, on iPhone and iPad. The web does it with the visual
viewport (`app/components/useKeyboard.js`); the app does it however its platform does. Check it
against the ruling, not the web's numbers.

**2. Images go through the server (222). 🚨 Direct uploads stop working at the W55.2 deploy.**
`storage.rules` now refuses every client write under `dm_images/` (founders included), and the
`dm_messages` rules accept `imageUrl` only from a reader with `users/{uid}/canPostImages === true`,
and only when it begins
`https://firebasestorage.googleapis.com/v0/b/calvary-scribblings.firebasestorage.app/o/dm_images%2F{convId}%2F{senderUid}_`.
An app that uploads to Storage itself and writes its own download URL is refused on both counts.

    POST /api/square/dm-image?conv={convId}
    Authorization: Bearer <ID token>          (the header only)
    Content-Type: image/jpeg | image/png | image/webp | image/gif
    body: the image's bytes
    → 200 { ok: true, url }    then write the message with imageUrl = url, exactly
    → 401 signed_out · 403 not_in_conversation · 403 no_grant · 403 blocked · 415 not_image · 413 too_large · 502 unavailable

- Show the image button only to a reader with the grant.
- Before upload, redraw the image at most **1600px on its long side, as a JPEG at quality 0.8**
  (a GIF goes as it is). This drops the EXIF, location included. The cap, **2 MiB**, is checked by
  the server on what arrives, so after the shrink. Measured on the web (Chromium) with three real
  4032×3024 photos: 3.19 → 0.46 MB, 5.30 → 0.48 MB, 9.78 → 0.27 MB. The app's encoder will give
  different bytes; re-measure on the phone, and keep 1600 / 0.8.
- `blocked` → "You can't message this reader." as now. `no_grant`, `not_image` and `too_large`
  carry their words after "Not sent." (the `error` field). Everything else is "Not sent." alone.

**3. A failed message (223).** It stays in the conversation at half opacity, with "Not sent."
(#d4537e), Try again (#a989d9) and Remove (ink 0.62), as the thread's failed reply. Remove writes
nothing. If the image was stored but the message write failed, Try again reuses the stored address
and doesn't upload it again.

**4. 24 hours (224).** Cloud Storage deletes everything under `dm_images/` once it is a day old
(`storage/lifecycle.json`). The app must stop asking for it at the same mark:
- `now - message.createdAt > 24 h` (strictly more; exactly 24 h still shows) → draw
  **"This image has expired."** in place of the image, and **never request the address**. A
  message with no usable `createdAt` counts as expired. The words in the message stay.
- If the image fails to load before the mark (the clear-out runs early by seconds), draw the same.
- The preview above the box, once an image is picked: **"Images disappear after 24 hours."**

**5. A reported image is held (225).** Report as now. If the message has an image that hasn't
expired, put its `imageUrl` in the report (the rules check it equals the message's), then:

    POST /api/square/report-image   { action: 'hold', contentKey: 'dm_{convId}' }
    → 200 { ok: true, held: true }   the server copied it to dm_reported/… and repointed the report
    → 410 gone                        it was already cleared out: the report stands as filed, say nothing
    → anything else                   DRAFT words: "Your report was sent, but the image didn't go with it. Try again."
                                      (Try again repeats only the hold; the report is write-once)

Releasing the copy is the moderator's, on the web (/admin/reports → Resolve). The app does nothing.

**6. Account deletion.** Neither the endpoint nor the scrub deletes the images a deleted reader
sent (their `dm_messages` records go; the files under `dm_images/` don't). The 24-hour clear-out
takes them. Nothing for the app to do.
