# W3: the money proof (test mode, against the live site's endpoints)

Run 25 Sep 2026, 00:49–02:40 UTC. The Stripe sandbox is `acct_…0BtuEAyw2t`, the one holding
the August test purchases. Its API version is `2026-03-25.dahlia`. Paystack was in test
mode. Nothing ran against a local server. Every checkout was opened by
`calvaryscribblings.co.uk/api/…`, paid on the provider's own hosted page, and granted by the
provider's own webhook delivery to the live endpoints.

The live checkouts are closed by `MEMBERSHIPS_ON_SALE`. Throwaway readers were let through by
`ops/test_buyers/{uid}`, which is read only on test keys (`functions/api/_money.js`). The
forced failure used `ops/money_fault/{uid}`, under the same rule. Readers are named by tag
here. All of them are throwaway `w3proof+…` accounts, deleted at the end of the round.

| # | What | Rail | Outcome |
|---|---|---|---|
| 1 | Gold monthly subscription | Stripe (S1) | tier `gold`, founding price, `currentPeriodEnd` set. **Before W3 it was always null on dahlia.** |
| 2 | Gold monthly subscription | Paystack (P1, P4) | tier `gold`, subscription code, period end |
| 3 | Platinum, bought directly | Stripe (S3), Paystack (P3) | tier `platinum`, but only after the forced failure (row 14) |
| 4 | Day pass | Stripe (S2) | pass live 24h; the tier scalar untouched |
| 5 | Day pass, then week pass (stacked) | Paystack (P2) | day, then week stacked on it (expiry 26 Sep → 3 Oct); the scalar untouched |
| 6 | Book, **full** refund | Stripe (S2, `beyond-good-and-evil`) | `revoked`, `refunded`; readership back to 0 |
| 7 | Book, **partial** refund (£1 of £4.99) | Stripe (S2, `after-the-fact`) | still `active`; readership 1 |
| 8 | Gold → Platinum | Stripe (S1) | live checkout answered `switch: true` and a portal *confirm* page. Afterwards: **one** subscription (`sub_1UJNW5…`) on the founding Platinum price, `foundingSince` kept, and the proration on the next invoice. Asking for Gold again answered 409 `already_member`. |
| 9 | Gold → Platinum | Paystack (P4) | new plan `active` (`SUB_7jko…`), old plan `non-renewing` and tombstoned `replaced`, upgrade sanction spent. **One billing subscription.** |
| 10 | Cancel | Stripe (S1, via `/api/membership/portal` and Stripe's cancel page) | `cancelAtPeriodEnd: true`, Platinum kept until 25 Oct |
| 11 | Cancel | Paystack (P4, via `/api/membership/paystack-cancel`) | Paystack `non-renewing` until 25 Oct; record `cancelAtPeriodEnd`, Platinum kept; a second press answers `already: true` |
| 12 | Membership, **full** refund | Stripe (S1) | tier `free` at once, subscription `canceled` at Stripe (ruling) |
| 13 | Pass, **full** refund | Stripe (S2), Paystack (P2) | both passes ended on the refund. Paystack's `refund.processed` came about 30s after the refund in test mode. |
| 14 | **Forced handler failure** | Stripe (S3), Paystack (P3) | every grant answered **500**; `ops/money_failures/*` written, `retryable: true`, each emailed once through Resend (message ids on the records); the providers redelivered — see the retry note below |
| 15 | **Replay** of a real delivered event | Stripe (S1: original `checkout.session.completed`), Paystack (P4: first Platinum charge) | `stale` / `skipped`; record byte-identical before and after; no alert |
| 16 | **Out-of-order** event | Stripe (S1: the `subscription.updated` from the upgrade, saying *active Platinum*, after the refund had ended it), Paystack (P4: `subscription.create` for the *replaced* Gold plan) | `stale`, no re-grant, record byte-identical |
| 17 | Deletion, subscription **never granted** | Stripe (S4), Paystack (P5) | our record empty (fault armed), account deleted through `/api/account/delete`; Stripe `canceled`, Paystack `non-renewing`; no `users/` node |
| 18 | Deletion, **active** subscription | Stripe (S3), Paystack (P3) | see below |

Every Stripe event in the window reached both endpoints: `pending_webhooks` was 0 for each
event checked, apart from the forced-failure events, which were deliberately refused.

## Found by the proof, and fixed in the same round

The unit suite could not have seen any of these. Each fix has a test that goes red when the fix
is reverted.

1. **Paystack's `charge.success` and `subscription.create` arrive at the same moment.** Both
   read the record before either writes, so the charge's write erased the subscription code
   the other had just stored, then the replay key. P1 went live on Platinum with no
   subscription code, which the Cancel button needs. Fixed: an event never writes a field it
   doesn't know. (`939c193f`, `09be7d81`)
2. **The Stripe portal's Cancel on dahlia sets `cancel_at`, not `cancel_at_period_end`.** A
   member who had cancelled was told "Renews on …". (`22d183e8`)
3. **A refund's reason was overwritten by the provider's own deletion event**, which our cancel
   causes. (`a34042b6`)
4. **"Already inactive" from Paystack threw.** Two of our own paths race to disable the old
   plan in an upgrade. It raised one false `[money]` alert during the proof, which the retry
   healed. (`a34042b6`)
5. **The replay key remembered only the last payment.** A redelivered older payment would have
   looked like new money. Every granted payment is now remembered. (`abdc34fb`)
6. **A replayed old payment on an ended subscription** alarmed like new money. It is now
   history if it was paid before the end. (`1edb1735`)

## The alerts Ikenna received during the proof

All of them are real sends to `MONEY_ALERT_EMAIL` through Resend, and they are what an alert
looks like:

- 5 × `[money] RETRYING: handler_failed` for S3/P3, the forced failure. One per refused event:
  three Stripe, two Paystack.
- 1 × `[money] RETRYING: handler_failed (paystack)`, the false alarm in finding 4.
- `[money] NEEDS A HUMAN: paid_after_deletion` for S4/P5 when their redeliveries land after the
  fault expires (02:32–02:34 UTC). Those readers paid, never received a tier, and deleted their
  accounts, so a human does decide whether to refund. In a test that is correct, and nothing
  needs refunding.
