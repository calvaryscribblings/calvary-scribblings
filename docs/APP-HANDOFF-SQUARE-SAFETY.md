# App hand-off: Mute, Block, Report a message (W53 → A43)

W53 shipped the Square's safety controls on the web. This is what the app must mirror in A43.
The web is the reference for **systems** (the rules and the data). For look, re-measure at the
app's own widths.

## The lists

| node | shape | who reads and writes |
|---|---|---|
| `muted_users/{uid}/{otherUid}` *(new)* | `true`, never yourself | the owner only |
| `blocked_users/{uid}/{otherUid}` *(existing)* | `true` | the owner only |

There is **one block list everywhere** (ruling 209). A block made in Open Pages comments applies
to messages and the Square, and the reverse. There is **no public index of who blocked whom**,
so the app must never write one.

## What the rules now refuse (live since the W53 deploy)

- **A message either way between two readers when either has blocked the other.** Both
  `dm_messages/{convId}/{msgId}` and the *other* reader's `dm_conversations/{otherUid}/{convId}`
  are refused. Your own `dm_conversations/{you}/{convId}` entry stays writable.
- **A notification** (`notifications/{uid}`) **from a reader the recipient has blocked.**
  `library_notifications` is unchanged.

**What to do with a refusal:** send each notification on its own and catch its refusal, so one
refusal never stops the next reader hearing and never undoes the save it follows. The web had one
place where it did undo the save, Open Pages replies, and it is fixed.

## What each list does, for the reader who set it

| | Mute | Block |
|---|---|---|
| their posts leave your feed | yes | yes |
| their replies in a thread (ruling 207) | hidden; drawn as **"A reply you've hidden."** only where it holds up replies you can see, and never counted | same |
| their notifications | not shown, not counted | not shown, and refused by the rules |
| messages | **never stopped** | stopped both ways |
| they're told | no | no |

## The reader card

Tapping a reader's name or face anywhere in the Square (feed, thread, messages, notifications)
opens the card: a bottom sheet on phones, a dialog at wider widths.

- A 72px face, the name at 24px, their UserBadge, and "@handle". " · reading since {Month Year}"
  follows the handle only when `users/{uid}/createdAt` exists.
- Two 44px buttons: **Message** (filled `#6b2fad`) and **Profile** (outlined, to
  `/user?id=`).
- Two rows with 20px icons:
  - **Mute in the Square**, with the line "Their posts stop showing for you. They won't know."
  - **Block @handle** in `#e0868f`, with the line "They can't message you, and their posts leave
    your Square."
  - Once set, they read **Unmute** and **Unblock @handle**.
- Your own card shows only Profile.

## Messages

- **Identity:** the live Avatar and UserBadge in the list and the conversation header (ruling
  203).
- **The blocker's side:** the box is replaced by "You've blocked @handle." with **Unblock**.
- **The blocked reader's side:** they cannot read your list, so they find out only when a send is
  refused with `PERMISSION_DENIED`. Then the box is replaced by "You can't message this reader."
  They are never told why.
- **Report a message:** the conversation's ⋯ menu offers "Report a message", with the line "Pick
  the message. A moderator sees only that one."
  - The reader taps one of the other reader's messages and picks a reason; a note is optional.
  - The report files as `content_reports/dm_{convId}/{reporterUid}` with kind `'dm'` (see
    `app/lib/contentReports.js`: `buildReport`, `snapshotOf`).
  - Then show "Reported. A moderator sees only this message."
  - One report per conversation per reader (write-once).

## Rulings 204–206

- **204:** switching who you're replying to keeps what's typed. There is no "@handle " prefill.
- **205:** a post that fails to send waits at the top of tonight's feed at half opacity, with
  "Not sent." in `#d4537e`, "Try again" in `#a989d9` and "Remove" at ink 0.62. Remove writes
  nothing. The box clears only once a save is written.
- **206:** a withdrawn root post with `removedBy: 'moderator'` reads **"This post was removed."**
  Every other case, older records included, reads "The author withdrew this post."

## The cookie notice (web only, for reference)

The web's cookie notice publishes the height it takes as `--cs-cookie-space`. The thread's reply
bar sits above it, and the messages sheet, the notifications sheet and the reader card pad by it.
If the app has an equivalent consent banner, nothing a reader needs may sit under it.
