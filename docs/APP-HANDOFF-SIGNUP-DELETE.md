# Hand-off to the app repo: signup and account deletion (23 Sep 2026)

This answers app commit `1c08954`. The rules are **live** (deployed 23 Sep 2026 ~21:04 London,
`rules:check` shows repo = live). Tests: `tests/rules/database.test.mjs`, block "SIGNUP R1".

## 1. The rule as deployed: `users/$uid/.write`

```
auth != null && auth.uid === $uid && (
  (!data.exists() && newData.exists()
    && !newData.hasChild('membership') && !newData.hasChild('isAuthor')
    && !newData.hasChild('canPostImages') && !newData.hasChild('canPin')
    && !newData.hasChild('canRemovePosts'))
  || (data.exists() && !newData.exists())
)
```

It also adds `users/$uid/$other: { ".validate": false }`: a child the rules don't name is refused,
even inside a create.

What this means for the app:

| write | result |
|---|---|
| `set(users/{uid}, {…})`, node **absent**, only named owner fields | **allowed** (the build 32 / vc16 signup and `ensureUserNode`) |
| the same, node **already exists** (even with one leaf in it) | **refused** (this would overwrite the node) |
| any create that carries `membership`, `isAuthor`, `canPostImages`, `canPin`, `canRemovePosts` | refused |
| any create with an unknown child, or `storyNotifications`/`mentionNotifications` not boolean | refused |
| `remove(users/{uid})` by the owner | **allowed**, whatever the node holds |
| `remove(users/{uid})` by anyone else, founders included | refused |
| removing one protected child on its own | refused, **unless it is the node's only child** (RTDB can't tell that apart from deleting the whole node; it can only ever drop a privilege) |
| leaf writes, `update()` multi-path | unchanged, still judged per field |

**Verify this ordering on the device.** The one-object create only works if it is the **first**
write under `users/{uid}`. If the old binary writes any leaf first (`ageConfirmed` from the age
gate, `storyNotifications`, `readStories`), the node exists and the object write is refused. Live
data suggests this happens: one Apple account from 13 Sep holds `[ageConfirmed, readCount,
readStories]` and no profile.

Proven on production with a throwaway account through the client SDK: create ALLOWED, overwrite
DENIED, create-with-membership DENIED, create-with-unknown DENIED, whole-node delete ALLOWED. The
node and the Auth account were deleted afterwards and checked.

## 2. Census: Auth accounts created since 1 Jul 2026 (99)

**No `users/{uid}` at all: 28**

| provider | count | dates |
|---|---|---|
| google.com | 26 | 1 Jul; then 4 Aug – 24 Aug (25) |
| apple.com | 1 | 13 Aug |
| no provider (anonymous) | 1 | 16 Aug |
| password | **0** | none |

**A node but no profile (no `displayName`): 18.** These readers have reading data but their
profile write failed.

| provider | count | dates |
|---|---|---|
| google.com | 16 | Jul 6, 11, 22; Aug 2, 5, 6×3, 10×3, 11×2, 14; Sep 8, 10 |
| apple.com | 1 | 13 Sep |
| password | 1 | 3 Sep (`[readerScore, scoreUpdatedAt]` only) |

Most of the 18 hold only `[readCount, readStories, readerScore, scoreUpdatedAt]`. Because their
node exists, **the new rule does not help them**. The old binary's `ensureUserNode` object write
is still refused for these accounts. Only the OTA leaf-path fix reaches them. Consider a repair
on the next launch: fill in the profile leaves when the node exists but has no `displayName`.

**Password signups.** The last password signup with the app's 8-field shape (`ageConfirmed,
createdAt, displayName, dob, handle, handleLowercased, uid, username`) is **1 Aug 08:58**. The
next is **23 Sep 20:42**, before the rule deploy, so it came through the OTA leaf writes. There
are **zero** password orphans. Either the app rolls back the Auth account when the profile write
fails, or failed readers never got that far. Check which: rolled-back readers leave no trace
here.

## 3. What `deleteAccount` must clear outside `users/{uid}`

Tested as the owner deleting `node/{uid}` on the emulator with the live rules.

**Owner may delete:**

- `usernames/{handle}` (only while it points at their uid)
- `user_search/{uid}`
- `push_tokens/{uid}`
- `leaderboard/{uid}`
- `blocked_users/{uid}`
- `readerBookmarks/{uid}`, `bookmarks/{uid}`, `userBookmarks/{uid}`
- `userBadges/{uid}`, `userStreaks/{uid}`, `userProgress/{uid}`, `userStoryTiers/{uid}`, `points/{uid}`
- `user_open_pages/{uid}` (only the index; the pieces live at `open_pages/*`), `open_pages_drafts/{uid}`
- `bookstore_reading_progress/{uid}`, `series_reading_progress/{uid}`
- `square_presence/{uid}`

**Owner may NOT delete at `{uid}` level:**

- `followers/{uid}`, `following/{uid}`
- `user_comments/{uid}`, `user_square_posts/{uid}`
- `notifications/{uid}`, `library_notifications/{uid}`
- `dm_conversations/{uid}`
- `quizAttemptCounted/{uid}`
- `wallet/{uid}`, `payout_requests/{uid}`

Some of these may allow deletes at a child level. Test before you rely on it.

**Server-only by design. Never clear from the client:**

- `memberships/{uid}`
- `bookstore_purchases/{uid}` and `purchases/{uid}` (a purchase is permanent)
- `rate_limits/{uid}`, `open_pages_rate/{uid}`
- `bookstore_waitlist`, `subscribers`

**Storage:**

| path | owner delete |
|---|---|
| `avatars/{uid}` | allowed |
| `headers/{uid}` | allowed |
| `open_pages/{uid}/*` | **denied**: combined `allow write` guards `request.resource`, which is null on a delete |
| `dm_images/*` | no rule, so denied for everything |

Removing any of these server-side is a separate round.

**Order.** Clear the other nodes first, then `users/{uid}`, then `auth.currentUser.delete()`
last. Every rule above needs the reader signed in. Auth deletion may throw
`auth/requires-recent-login`; handle it before you touch any data.

## 4. Paid memberships when a reader deletes their account (report only, nothing changed)

- The world-readable scalar `users/{uid}/membership` is erased with the node. That only
  downgrades the reader, and a re-create can't bring it back.
- `memberships/{uid}` (the billing record) stays. No client can write it.
- **The Stripe or Paystack subscription is not cancelled. It keeps charging.** The next webhook
  event (renewal, `subscription.updated`) writes `users/{uid}/membership` again through the Admin
  SDK. That recreates a stub node `{membership: 'gold'}` for a deleted account.
- If the Auth account is deleted too, the reader pays for an account nobody can sign into. An
  Apple or Google re-sign-in gets a new uid.
- Today only one `memberships` record exists, so exposure is small. Cancelling at deletion needs
  a server endpoint; decide that before launch.

## 5. Enforcement state

No ban, mute or strike state exists anywhere. The only enforcement-like counters are
`rate_limits/*` and `open_pages_rate/*`, both at the top level, `.write: false`, Admin SDK only. A
delete-and-recreate of `users/{uid}` can't shed them. The five protected children are all
privileges where absent means no, so deleting them only removes privileges.

**Any future enforcement state must live beside `rate_limits`, never under `users/{uid}`.**
Under `users/{uid}` this delete grant would make it ban evasion.

## 6. The web's own deletion, for comparison

`app/components/DeleteAccountModal.js` does a **soft** delete. It is a multi-path leaf update of
`isDeleted` and `pendingDeletion/*`, so it was never refused. Nothing in this repo hard-deletes
afterwards: the "cron worker" that `AuthContext.js` names as the backstop does not exist here.
One live node is sitting in `pendingDeletion`.
