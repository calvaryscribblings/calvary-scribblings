# Hand-off to the app repo: `POST /api/account/delete` (23 Sep 2026)

This replaces the app's client-side `deleteAccount`. **Switch by OTA.** The endpoint works for
every build that can reach the network, because the change is one `fetch`.

The server does everything the app's client delete could not: follows, comments, Square, Open
Pages, DMs, reactions, purchases, memberships and Storage. It cancels an active membership, and
it deletes the Firebase Auth account last. **The app must not delete anything itself any more**,
Auth included. A client-side `user.delete()` before the call would leave the server unable to
authenticate the request.

## Request

```
POST https://calvaryscribblings.co.uk/api/account/delete
Authorization: Bearer <Firebase ID token>
(no body needed; { idToken } in a JSON body is also accepted)
```

The token must come from a sign-in in the last **300 seconds**, measured by the token's
`auth_time` claim. A silently refreshed token keeps its old `auth_time`, so
`getIdToken(true)` alone is **not** enough. Reauthenticate first:

- password: `reauthenticateWithCredential(user, EmailAuthProvider.credential(email, pw))`
- Apple / Google: `reauthenticateWithCredential(user, <provider credential from a fresh sign-in>)`

Then `await user.getIdToken(true)` and call the endpoint straight away.

## Responses

| status | body `code` | what the app does |
|---|---|---|
| **200** | `{ deleted: true, uid, scrub: 'queued' }` | Sign out locally (`signOut`, clear caches). The account is gone. |
| 200 | `{ deleted: true, already: true }` | The same: an earlier call finished but its answer was lost. |
| **401** | `requires_recent_login` (`maxAgeSeconds: 300`) | Reauthenticate (above), then call again. |
| 401 | `signed_out` | The token is missing or rejected. Sign in again, then call again. |
| 403 | `house_account` | A founder account. Never deleted from the app. |
| 429 | (limiter) | Show `error`; honour `Retry-After`. Caps: 5/min, 20/day per account. |
| 503 | `limiter_unavailable` | Show `error`; retry shortly. |
| **500** | `delete_failed`, `step` | **Nothing is claimed.** Show `error` and offer "Try again". A retry resumes from `step`. |

Every non-200 body carries `error`, a sentence you can show the reader as it stands.

**Order on the server:**
1. Write the record `deletions/{uid}`.
2. Cancel an active Stripe subscription or Paystack plan. There's **no refund**, pending
   Ikenna's ruling; day and week passes need nothing.
3. Delete every node keyed by the reader, both halves of their follows, their handle, and rows
   keyed by their email.
4. Delete their Storage files: `avatars/`, `headers/`, `open_pages/{uid}/`.
5. **Delete the Auth account.**

Comments, Square, Open Pages, reactions, notifications they caused and the DMs they sent are
removed within about 15 minutes, by a server job working from the record.

**Kept, by design:** `memberships/{uid}`, `bookstore_purchases/{uid}`, `purchases/{uid}`
(accounting), and abuse reports (safety). They stay under a uid that no longer maps to any
account, profile, handle or email.

## What the app's Settings copy may say

It must not promise a grace period or a restore. The server deletes immediately and nothing
can restore it. The web modal still promises seven days, and that is held for Ikenna's ruling;
see the web round report. If the app's copy lists what is deleted, the accurate list is: the
account, profile and @handle; comments and replies; Square posts; Open Pages pieces; reactions;
reading history, badges, points and board positions; followers and following; messages the
reader sent.

## Two things the app should stop doing

1. **Client-side deletes of `users/{uid}`, the handle, the search row and `push_tokens`.** They
   are harmless but redundant, and a partial client delete before a failed server call leaves
   the reader half-deleted with nothing recording it. Call the endpoint only.
2. **`user.delete()`.** The server does it last. Doing it first makes the call unauthenticatable.
