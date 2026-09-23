# Live money: the Book Store go-live sequence

Written 23 Sep 2026 (live-money preflight). **Book Store rails only.** Memberships stay
closed until the launch; nothing here creates a live Price, a live Plan, or a live membership
webhook.

Nothing in this document is done by a Claude session. Every step below is Ikenna's hands,
in this order. Where a step says *verify*, the command and the expected output are given, so
the step either passes or stops the sequence.

---

## What is true before you start

**Memberships cannot be bought, on either rail, with a live key in.** Since commit
`60b0ed4c` all four membership checkouts (two subscription, two pass) open on one condition,
`functions/api/membership/_onSale.js`:

> `MEMBERSHIPS_ON_SALE` **and** `isConfigured(modeOf(key))`

`MEMBERSHIPS_ON_SALE` is `false` and no live Prices or Plans exist, so every one of them
answers **409 "Memberships open on 30 September."** before it touches Firebase, Stripe or
Paystack. Before that commit the day and week passes had no gate. A live key would have
sold them, and on Paystack granted them. The gate sits at checkout **creation** only. If a
membership payment ever did arrive, it would be honoured.

`modeOf()` now reads restricted keys by their mode (`rk_live_…` counts as live), so a
restricted live key is safe to use.

**Ruling 3: direct-API book sales before the doors open are ACCEPTED.** The access-key
curtain is **client-side by design** (`isCurtainUp()` in the browser). The two book checkout
endpoints do not check the access key. A signed-in reader who calls
`/api/bookstore/checkout` or `/api/bookstore/paystack-checkout` directly buys a real book at
the real catalogue price, and that is a real sale. The curtain is a shop window, not a wall,
and nothing in this sequence treats it as one.

The app side: Android hands checkout to the web, so it gets exactly the web's behaviour.
iOS has no buy path.

---

## Webhooks: what each rail needs

### Stripe (GBP / USD)

One **live** endpoint, created in the Stripe dashboard with the **live** toggle on:

- **URL:** `https://calvaryscribblings.co.uk/api/bookstore/stripe-webhook`
- **Events (exactly these five):**
  - `checkout.session.completed` (grant)
  - `checkout.session.async_payment_succeeded` (grant, for delayed methods)
  - `checkout.session.async_payment_failed` (revoke: payment-failed)
  - `charge.refunded` (revoke: refunded)
  - `charge.dispute.created` (revoke: disputed)
- Its signing secret (`whsec_…`, **the live one**) goes in `STRIPE_WEBHOOK_SECRET`.

The **membership** endpoint (`/api/membership/stripe-webhook`,
`STRIPE_MEMBERSHIP_WEBHOOK_SECRET`) is **not** created in live today. It belongs to the
membership launch.

### Paystack (NGN): one webhook URL per mode

Paystack has **one webhook URL per mode**: a Test Webhook URL and a Live Webhook URL, set
under *Settings → API Keys & Webhooks*. You cannot register a second URL in the same mode.
The code agrees: the signature is an HMAC keyed with the per-mode secret key, so one
endpoint can only ever verify one mode's deliveries.

- **Live Webhook URL:** `https://calvaryscribblings.co.uk/api/bookstore/paystack-webhook`
- Paystack has no per-event selection; it sends everything. The handler acts on:
  - `charge.success` (grant, after re-verifying the amount, currency and status with
    `GET /transaction/verify`)
  - `refund.processed` (revoke: refunded)
  - `charge.dispute.create` / `dispute.create` (revoke: disputed)
  - `charge.reversed` (revoke: reversed)
  - It deliberately **ignores** `refund.pending` and `refund.failed`. A pending refund is an
    intention, and a failed one means the money never went back, so the reader keeps the book.

**The same URL also carries the membership launch.** That single live URL must also receive
membership subscription events once memberships open, and it already routes them. The
bookstore webhook hands `subscription.*`, `invoice.*`, `ms.`/`mp.` references and
plan-bearing charges to `functions/api/membership/_paystack.js` (`isMembershipEvent()`).
When memberships open, the Paystack side needs **no new URL and no new code**. It needs
only the live Plan codes pasted into `paystack-plans.js`, which is the membership launch's
own step.

**Swapping the key does not register the URL.** Setting a live `PAYSTACK_SECRET_KEY` and
setting the Live Webhook URL are two separate actions. Miss the second, and live purchases
charge the reader but never grant the book.

### Cloudflare Pages: Production environment only

| Variable | Set to | Today |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` (or `rk_live_…`, see below) | test |
| `STRIPE_WEBHOOK_SECRET` | the **live** bookstore endpoint's `whsec_…` | test |
| `PAYSTACK_SECRET_KEY` | `sk_live_…` | test |
| `STRIPE_MEMBERSHIP_WEBHOOK_SECRET` | **leave as is**, not part of this | test |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `NEXT_PUBLIC_FIREBASE_API_KEY` | unchanged | — |

- Set them as **encrypted** variables on the **Production** environment. **Leave Preview on
  the test keys**, so no branch preview can ever take real money.
- **Encrypted Pages variables take effect only on the next deployment.** Changing them does
  nothing to the site that is already serving. Step 7 is the redeploy.
- If you use a restricted Stripe key, it needs **Checkout Sessions: Write**. It will need
  more for memberships later (Customers, Subscriptions, Billing Portal). A standard
  `sk_live_` is simpler for now.

---

## The sequence

### 1. Confirm the gate deploy is live (Rulings 1 and 2, commit `60b0ed4c`)

This must pass **before any live key goes anywhere**:

```sh
for p in 'pass-checkout {"kind":"day","currency":"gbp"}' \
         'paystack-pass-checkout {"kind":"day"}' \
         'checkout {"tier":"gold","interval":"monthly","currency":"gbp"}' \
         'paystack-checkout {"tier":"gold","interval":"monthly"}'; do
  set -- $p
  curl -s -X POST "https://calvaryscribblings.co.uk/api/membership/$1" \
    -H 'Content-Type: application/json' -H 'Authorization: Bearer probe' -d "$2"; echo
done
```

**Expected:** all four print `{"error":"Memberships open on 30 September.","code":"not_configured"}`.
A `401` or `Sign in…` from either pass endpoint means the gate is **not** deployed. Stop.
(Verified 23 Sep 2026 11:04 UTC, test keys in place: all four 409.)

### 2. Two-factor authentication, everywhere money or keys live

Stripe, Paystack, Cloudflare, GitHub, and the Google account that owns Firebase. Use an
authenticator app or a hardware key, not SMS where the dashboard offers better.

### 3. Back up and clear the test purchases — **on Ikenna's word only**

Census, 23 Sep 2026: **8 records, all test-mode, all on house accounts** (Ikenna's, and
Calvary Films'). Seven are Stripe `cs_test_…` sessions. One is Paystack (basil, ₦1,800,
4 Aug), and its reference carries no mode marker, so the script **refuses it unless
Paystack's test mode confirms it**. That is why the test key goes in here.

```sh
# dry run: reads, writes the backup file, prints the plan, changes nothing
FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json \
PAYSTACK_TEST_SECRET_KEY=sk_test_… \
  node scripts/clear-test-purchases.mjs
```

**Expected:** `WOULD REMOVE (8)`, `REFUSED (0)`. Every readership line ends in `(absent)`.
If anything is refused, or the count is not 8, **stop and look**. A refused record is not
test-mode-proven, and there is no override flag.

```sh
# apply: only with the number the dry run printed
FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json \
PAYSTACK_TEST_SECRET_KEY=sk_test_… \
  node scripts/clear-test-purchases.mjs --apply --confirm=8
```

**Expected:** `✓ removed 8, readership as planned, 0 refused record(s) untouched`, plus the
backup path under `backups/clear-test-purchases/`. Keep that file; it is not committed.

This also removes the one known anomaly
(`XaG6bTGqdDXh7VkBTw4y1H2d2s82/the-fire-in-the-flint`: status active with
`revokedReason: refunded`, and `revokedAt` earlier than `purchasedAt`). As ruled at R9.1,
the cleanup and the repair are the same act.

Then `FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json node scripts/readership.mjs report`
must print no DRIFT. (Today it reports three titles with drift: the counter shipped after
those test purchases. The clear resolves it.)

### 4. Stripe, live mode

1. Account activated for live payments (business details, payout bank).
2. *Settings → Customer emails*: **Successful payments** ON and **Refunds** ON. Stripe's
   receipt is the buyer's only receipt at launch; the checkout sends `customer_email`.
3. *Developers → Webhooks* (**live**): add the endpoint and the five events above. Copy the
   live `whsec_…`.
4. *Developers → API keys* (**live**): copy the secret key.

### 5. Paystack, live mode

1. Business activated for live transactions.
2. *Settings → API Keys & Webhooks*, **Live** section:
   - **Live Webhook URL** = `https://calvaryscribblings.co.uk/api/bookstore/paystack-webhook`
   - Copy the **Live Secret Key**.

### 6. Cloudflare Pages, Production environment

Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `PAYSTACK_SECRET_KEY` as in the table
above, encrypted. Leave Preview alone.

### 7. Redeploy, and prove the new deployment is the one serving

*Workers & Pages → the project → Deployments*: retry the latest **production** deployment
(or push a commit). Wait for it to finish, and check that its time is **after** step 6.

Then run **step 1's probe again**. All four must still answer 409. That proves the gate
holds **with the live keys in place**. If any pass endpoint now returns a URL, **remove the
live keys at once** and stop.

### 8. One real purchase per rail, on the cheapest classic

Use Ikenna's own account (`XaG6bTGqdDXh7VkBTw4y1H2d2s82`, signed in, with the access key).
Use **two different titles**, so each rail's record, count and refund stand on their own:

| Rail | Title | Price |
|---|---|---|
| Stripe (£) | `mrs-dalloway` | £1.99 (199) |
| Paystack (₦) | `the-awakening` | ₦1,800 (180000 kobo) |

Both are £1.99 / ₦1,800 classics. On the detail page, pick GBP for the first and NGN for
the second.

### 9. Verify each purchase

```sh
FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json \
  node scripts/verify-live-purchase.mjs XaG6bTGqdDXh7VkBTw4y1H2d2s82 mrs-dalloway

FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json PAYSTACK_SECRET_KEY=sk_live_… \
  node scripts/verify-live-purchase.mjs XaG6bTGqdDXh7VkBTw4y1H2d2s82 the-awakening
```

**Expected, each:**
- `status active`
- mode `LIVE` (Stripe from the `cs_live_` session id; Paystack from its own
  `domain=live`)
- the amount as above
- `stream ticket YES`
- `readership count stored 1 · true 1 ✓`
- exit 0

Also: open each book in the reader on the web, and check that the Stripe receipt email
arrived.

A Stripe grant lands within seconds. A Paystack grant lands after its `charge.success`
webhook, usually seconds and at most a few minutes. If the record is not there after
10 minutes, check *Paystack → Settings → Webhooks* (live) for failed deliveries before
anything else.

### 10. Refund each

- **Stripe:** *Payments → the £1.99 payment → Refund*, full amount. `charge.refunded` fires
  within seconds.
- **Paystack:** *Transactions → the ₦1,800 transaction → Refunds → New Refund*, full amount.
  - Do this **the same day**. On a Starter business, a refund is deducted from the
    **pending payout**, and Paystack refuses it if the pending payout cannot cover it.
    Paystack settles next day.

### 11. Verify revocation, and the counts back to 0

Run the two commands from step 9 again. **Expected, each:**
- `status revoked`
- `revokedReason refunded`
- `stream ticket NO — stream.js answers 403 revoked (refunded)`
- `readership count stored 0 · true 0 ✓` (the counter decrements to `0`, and `0` and
  absent read the same)
- exit 0

**Paystack refund latency: expect it to be slow, and do not revoke by hand.**
- The book is revoked on `refund.processed`, and Paystack sends that only when the refund
  has **been processed to the customer**. It goes Pending, then Processing, then Processed.
  `refund.pending` arrives first, within minutes, and is deliberately ignored.
- Paystack publishes no fixed time for Processing → Processed. Its own guidance to
  customers is **3 to 10 working days**.
- So the Paystack half of step 11 may take **days**, not minutes. Until it arrives the
  record stays `active` and the book stays readable. That is correct: the money hasn't gone
  back yet.
- Re-run the verify script daily until the record reads `revoked`.
- **Do not write to the record by hand.** If Paystack reports the refund **Failed**, the
  handler correctly leaves the book with the reader.

Stripe's half should read `revoked` within a minute of the refund.

Once both read revoked with counts at 0, the rails are proven end to end in live mode, and
the store stays live-keyed for the doors opening.

---

## Known, and deliberately not fixed here

- **Fees.** Card processing fees are generally not returned on a refund; the two test
  purchases cost a few pence/naira each.
- **🚨 Deleting a title can remove an owned master, whenever the readership counter
  under-counts.** Found 23 Sep 2026, and it explains `basil` and `the-fire-in-the-flint`.
  Both were **deleted** (not withdrawn) through R21's `deleteTitle` on 27 Aug 2026 09:15 UTC.
  Their tombstones in `bookstore_titles_deleted` record `ownersAtDeletion: 0`, yet 4 test
  purchases existed. `deleteTitle` counts owners from `bookstore_readership`, and that node
  was absent for both titles: they were bought before the counter shipped, and the backfill
  never ran. So `deletionPlan()` saw no owners and deleted the masters, the samples and the
  covers.
  - **Withdrawal is safe.** `withdrawTitle()` only patches `status` and a `withdrawal` block,
    and it never touches Storage.
  - **Deletion is safe only when the counter is right.** Today one live title is exposed:
    `the-rescue` has 2 active (test) owners and no counter.
  - **So until step 3 above has run, do not Delete any title.** Run
    `node scripts/readership.mjs report` first and delete only on a clean report. After the
    clear, every remaining count comes from the atomic counter.

- **CI.** `rules and hygiene` has been red on `main` since at least 10 Sep, for two reasons
  unrelated to payments: a Square browser test timing out, and `npm audit` blocking on a
  **critical advisory against `next`**. Neither touches the money path. The advisory needs
  its own round, and not one run in the week of a money launch without a decision.
