# Going live with money: Ikenna's walk

Books went live on 27 Sep 2026 (W20, steps 6a and 7a). Memberships go live on 30 Sep 2026
(steps 6b and 7b).

Rewritten in W3 (25 Sep 2026). **This is everything a person has to do by hand, in order.**
Anything a Claude session can do from the codespace is not in the steps. It is listed once, in
the box at step 6, so you know what happens between your steps.

Before this, everything below had been proven in **test mode** against the live site: both
subscriptions and both passes on both rails, Gold → Platinum, cancel on both rails, refunds
(full and partial, books and memberships), replayed and out-of-order webhooks, deletion with a
live subscription, and a forced failure that the providers retried. The record is
`docs/audit/2026-09-24/W3-PROOF.md`.

**How long it takes you:** about 45 minutes of dashboard work, plus the two real purchases.

---

## Before the day (any time from now)

### 1. Two-factor authentication on every account that holds money or keys

Turn it on for Stripe, Paystack, Cloudflare, GitHub, and the Google account that owns
Firebase. Use an authenticator app or a hardware key, not SMS, wherever the dashboard offers
one.

### 2. Check that the money alerts reach you

During W3 the system sent real test alerts to **ikennaworksfromhome@gmail.com**. Their subject
lines start **`[money]`** (for example `[money] RETRYING: handler_failed (stripe)`).

- Find them in Gmail. If any are in **Spam**, mark them *Not spam*.
- Create a filter: *Subject contains `[money]`* → **Never send to Spam**, **Always mark as
  important**.

After launch, a `[money]` email means a reader paid and something needs a human. **Every
money failure sends one.** Each email names its record, `ops/money_failures/…`. A Claude
session can read those records and resolve them.

To send alerts somewhere else, tell a session the address. It is one Pages secret.

---

## 30 September

### 3. Stripe, in the **live** account (toggle *Test mode* OFF, top right)

Your live account is **Calvary Media UK Ltd.** The test work used its sandbox. The live
account is a separate place, so nothing below has been done in it yet.

1. **Activate payments** if Stripe still asks: business details, then the payout bank account.
2. **Settings → Business → Public details.** Set these, because a buyer sees them on Checkout,
   on receipts, on their bank statement and in the billing portal:
   - Public business name: `Calvary Scribblings`
   - Support email: `contact@calvaryscribblings.co.uk`
   - Statement descriptor: `CALVARY SCRIB` (it can be at most 22 characters)
   - Website: `https://calvaryscribblings.co.uk`
   - Privacy policy and terms URLs, if you have them.
3. **Settings → Business → Branding:** add the icon and the brand colour.
4. ✅ **DONE** (Ikenna confirmed, 28 Sep). **Settings → Business → Customer emails**, then
   under **Payments** turn **ON** *Successful payments* and *Refunds*. Stripe's receipt is the
   buyer's only receipt at launch. *(W24, 28 Sep: Stripe's dashboard has moved; this path was
   checked against Stripe's own docs that day.)*
5. ✅ **DONE** (Ikenna confirmed, 28 Sep). **Subscriptions.** Three places now, not one
   *(paths checked against Stripe's own docs, 28 Sep)*:
   - **Billing → Revenue recovery → Retries:** Smart Retries **ON**; and when all retries
     for a payment fail, choose **Cancel the subscription**. ⚠ This one matters. Our code
     keeps a member's tier while Stripe is retrying a card. Only a *cancellation* takes the
     tier away. If Stripe is set to "mark as unpaid" instead, a member whose card is dead
     keeps their tier for ever.
   - **Billing → Revenue recovery → Emails:** turn **ON** *Send emails when card payments
     fail* and *Send emails about expiring cards*.
   - **Settings → Billing → Subscriptions and emails**, under **Email notifications and
     customer management:** turn **ON** *Send emails about upcoming renewals*.
6. **Developers → API keys:** click *Reveal live key*, copy the **Secret key** (`sk_live_…`),
   and go straight to step 5 below.
   - Don't create the webhook endpoints or the portal by hand. The session creates both from
     code, at the pinned API version (`2026-03-25.dahlia`, which is the account's own
     version).

7. ✅ **DONE 30 Sep, 00:03 London (W29).** All six were deactivated after the gate probe said OPEN;
   the report then read 0 of 7 active (a seventh £5 link was already inactive).
   **Wednesday, once memberships are open (ruling 107): take down the six donation links.**
   The six "Support Calvary Scribblings" links (£1, £2, £5, £10, £20, £50) are Stripe **Payment
   Links**, not pages on the site: the web stopped showing them on 29 Apr 2026, so there is
   nothing to hide in a deploy. After the 6b switch is live and the gate probe says OPEN:
   ```
   node scripts/money/donation-links.mjs                          # report: 6 ACTIVE
   node scripts/money/donation-links.mjs --apply --i-mean-live    # deactivates the six
   node scripts/money/donation-links.mjs                          # report: none active
   ```
   Deactivating is reversible, deletes nothing and moves no money; anyone holding an old link
   (in the app, a bio, an email) is told it is no longer available.

### 4. Paystack, in **Live** mode (the Test/Live switch, top of the dashboard)

1. **Activate the business** for live transactions if Paystack still asks.
2. **Settings → API Keys & Webhooks, in the *Live* section:**
   - **Live Webhook URL:** paste `https://calvaryscribblings.co.uk/api/bookstore/paystack-webhook`
     and **Save**. ⚠ Paystack has **no API for this** field. It is the one Paystack step
     nobody else can do. Without it, naira buyers are charged and receive nothing.
   - Copy the **Live Secret Key** (`sk_live_…`).
3. **Settings → Preferences:** if there is a setting that lets customers manage or cancel
   their subscriptions from Paystack's emails, leave it **ON**. The membership page tells
   naira members that link exists. (In test mode the link came by default; the setting's
   exact name was not checked from here.)

### 5. Give the codespace the two live keys

GitHub → the repo → **Settings → Secrets and variables → Codespaces → New repository secret**:

| Name | Value |
|---|---|
| `STRIPE_LIVE_SECRET_KEY` | the `sk_live_…` from step 3.6 |
| `PAYSTACK_LIVE_SECRET_KEY` | the `sk_live_…` from step 4.2 |

**Restart the codespace** afterwards (*Codespaces → … → Stop*, then open it again). A running
codespace does not see a changed secret. W3 lost a round to exactly that.

Don't paste either key anywhere else: not into Cloudflare, not into a chat, not into a file.

### 6. Tell a session: "go live"

> **Wednesday's branch, as re-cut in W27 (28 Sep):** `memberships-6b` = `3434d82b` (prep) +
> `ff03a0ca` (the switch), on main's `3d397964`. Wednesday's line is unchanged:
> `git merge --no-ff origin/memberships-6b`, followed by step 3.7 (see 6b below).

**Books went live early, on 27 Sep (W20).** Rulings 52–54: both book rails go live on the
27th, because three influencers publish the store access key on the 28th and test the
purchase flow with real money. Memberships stay closed until launch morning. So step 6 is now
two halves.

#### 6a. Books: done 27 Sep 2026 (W20)

Steps 1, 2, 4 and 5 were done by Ikenna before the round, and so were 3.1–3.4 and 3.6. *(W24
had marked 3.4 as not done, on a wrong assumption; W26 restores this line. Ikenna confirmed on 28
Sep that 3.4 and 3.5 are both done.)*

- **Keys.** Both are live keys. Stripe's belongs to `acct_…nEB3LO`, the live *Calvary Media UK
  Ltd.* account (charges and payouts enabled). Paystack's belongs to integration `1950328`,
  the same business as the test key the site has always used.
- **Found first: a third live Stripe webhook** that this doc didn't know about. It went to
  the old Dead End paywall worker (`calvary-stripe-webhook`, set up 21 May). It heard every
  `checkout.session.completed` on the account, with no check for what was bought, so every
  card book buyer would also have been given Dead End. Ikenna's ruling: Dead End's paywall
  goes. The endpoint is deleted, the Dead End Payment Link deactivated, the worker deleted
  (nothing else called it), and the price and button taken off the story page. Its one buyer
  kept it then. **W26 (28 Sep): Dead End is deleted from the platform by Ikenna's ruling.** The
  one purchase was his own, so its record went with it, and the story page's paywall code is
  gone. Backup in `~/calvary-backups/w26/`.
- **Webhooks.** `scripts/money/stripe-webhooks.mjs --i-mean-live` created **both** live
  endpoints, books and memberships, at `2026-03-25.dahlia`. The memberships endpoint is safe
  before the 30th, because the site can't open a live membership checkout (they all answer
  409), and it ignores book sessions and one-off invoices.
- **Production Pages secrets** set: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_MEMBERSHIP_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`. **Preview has no money secrets
  at all,** not test keys as this doc used to say. A preview deployment can't open a
  checkout on either rail, which is safe.
- **Deployed and proven.** Commit `5c9e7add` is deployment `0005c3ec`. On both the domain and
  the deployment's own address:
  - all three webhooks answer 400 to a bad signature;
  - an event signed with the new Stripe secrets is accepted, and so is one signed with the
    live Paystack key, while the test key's is refused (so production is on live keys);
  - both signed-out book checkouts answer 401;
  - all four membership checkouts answer 409 `not_configured`.
- **`ops/test_buyers`** was already empty.
- **Test-mode records cleared.** No test book purchases were left (W3 cleared them), and
  readership shows no drift and no stored counts. What was left: 10 membership records from
  W3's deleted throwaway accounts (8 cancelled subscriptions, 2 expired passes) and their 12
  `paystack_membership_index` entries. Each was proven test-mode by the providers' test APIs,
  none granted anything, and all were removed. The backup is in
  `~/calvary-backups/w20/` in the codespace, outside the repo. One record was left alone: a live
  account's plain "free" record with no provider reference, which is not a test purchase.

#### 6b. Memberships: prepared 28 Sep (W25), the switch on Wednesday 30 Sep

✅ **DONE (W29).** The merge `1414dd72` "Launch: memberships open (6b)" (`--no-ff`, no skip token)
was **pushed at 00:00:00 London on 30 Sept** and **live at 00:02:15**, Cloudflare deployment
**ba159b52** (github:push, created 00:00:04). The midnight deploy hook's own build (ff0c657f)
built the same commit. Gate probe: CLOSED at 22:56 on the 29th (build da2d6df1), OPEN at 00:02:36
(build 1414dd72); parity 15 of 15 before the merge. Rollback, if ever: `git revert -m 1 1414dd72`.

Ruling 98: the live prices and plans are made ahead, and only the switch is left for the
morning. Ikenna did step 3.4 and step 3.5 before W25.

**Done on 28 Sep (W25), in the live accounts.** Nothing can be bought yet: all four membership
checkouts answer 409.

- **Stripe** (live account, `acct_…nEB3LO`, at `2026-03-25.dahlia`): the gold and platinum
  products, the 8 founding prices (gold/platinum × monthly/annual × gbp/usd, e.g.
  `gold-monthly-gbp`), and the founding billing-portal configuration, restricted to exactly those
  8 prices (verified with `expand[]`).
- **Paystack** (live): the 4 founding plans, `gold-monthly-ngn` … `platinum-annual-ngn`.
- **Test against live:** `node scripts/money/membership-parity.mjs` compares all 15 objects with
  their test twins field by field. On 28 Sep: **15 of 15 match**.
- ⚠ **Found and fixed on the way:** `create-founding-prices.mjs` looked objects up with Stripe's
  *search*, which lags new objects. A re-run a minute after the first created a second pair of
  products. They had no prices, and both were deleted. The script (and the parity tool) now use
  the *list* endpoints, and two re-runs created nothing.
- **Webhooks** (report mode, nothing changed): both live Stripe endpoints are enabled at the
  pinned version. The membership endpoint subscribes to all 9 events its handler handles.
  Paystack has no per-event subscription.

**THE BRANCH: `memberships-6b`.** It holds two commits, both marked `[CF-Pages-Skip]` so Cloudflare
builds no preview of it:

1. the prep: the idempotence fix, the parity tool, the gate probe, and this section;
2. **the switch**, the one commit this step always described: the live ids in `prices.js` and
   `paystack-plans.js`, `MEMBERSHIPS_ON_SALE` and `MEMBERSHIP_LAUNCHED` flipped together, and the
   "ships no live ids" test deleted.

The branch's whole suite and the build passed on 28 Sep. It is **not merged and not deployed**.

**Wednesday's prompt is "merge the 6b branch". It means exactly this:**

1. **Check (read-only, about a minute).**
   ```
   node scripts/money/membership-parity.mjs                  # must say 15 of 15 match
   node scripts/money/membership-gate-probe.mjs --expect closed
   ```
2. **Merge, with a merge commit.**
   ```
   git fetch origin
   git checkout main && git pull --ff-only origin main
   git merge --no-ff origin/memberships-6b -m "6b: memberships open (merge memberships-6b)"
   npm run test:membership && npm run test:ci
   git push origin main
   ```
   ⚠ **`--no-ff` and that `-m` are required.** The branch's commits carry `[CF-Pages-Skip]`. A
   fast-forward would leave that token on main's head commit, and Cloudflare would skip the
   **production** build: the push would look done, and nothing would open. The merge commit's own
   message has no token, so production builds.
   If the merge conflicts in `prices.js`, `paystack-plans.js`, `membershipPrices.js`,
   `app/links/page.js` or `on-sale.test.mjs`, **stop**. Something changed those since W25, and
   the ids need a fresh look, not a hand-resolve.
3. **Wait for the deploy, then check.**
   ```
   until node scripts/money/membership-gate-probe.mjs --expect open; do sleep 20; done
   ```
   The probe prints the live build's commit. It must be the merge commit.
   Then **step 3.7**: take down the six donation links (`scripts/money/donation-links.mjs`).
4. **The check (the four checkouts).** Every checkout checks for a token *before* the sale gate.
   So **"401 signed out" is the answer in BOTH states**: it was measured with the store shut on
   28 Sep. It's what a signed-out reader gets, but it proves nothing about the switch. The probe
   asks each checkout twice:
   - **no token → 401 `signed_out`**, before and after (the signed-out reader's answer);
   - **a placeholder token → 409 `not_configured` before, 401 `signed_out` after.** After the
     switch the request is past the gate and stops at identity, because the placeholder is not a
     credential. Nothing reaches Stripe, Paystack or the database.

   Then the 08:05 launch check's **Memberships** row should read GREEN (every switch on).

**How long it takes.** Across 25 production deploys (26–28 Sep), a push was live in a **median of
104 s** (range 63–232 s). The trigger itself is immediate. With the tests in step 2, allow about
**6 minutes** from the start of step 1 to an open store. **Start by 07:45 London** to land well
before the 08:05 launch check. 07:30 leaves room for a failed build: start another with the
`deploy-hook-probe` workflow (tick *fire*), or push an empty commit without the skip token. The midnight rebuild (00:00 London) builds main as it is, still
shut, so it doesn't matter when the merge happens relative to it.

**Rollback: "close memberships".** Revert the switch commit alone. The branch tip is that commit,
so **keep the branch** until the week is out.
```
git checkout main && git pull --ff-only origin main
git revert --no-edit origin/memberships-6b      # the switch commit; message "Revert …", no skip token
npm run test:membership
git push origin main
until node scripts/money/membership-gate-probe.mjs --expect closed; do sleep 20; done
```
This puts back the null ids, both flags `false`, and the deleted test, so the interlock holds.
**Never delete the live prices or plans to close the store.** A Paystack plan can't be recreated,
and every founding member's renewals would fail. A checkout a reader opened before the rollback
still completes and is honoured: the grant sites never consult the gate.

### 7. One real purchase and one refund, per rail

#### 7a. Books: Ikenna's proof, 27 Sep (ruling 54)

Use **your own account**, signed in, in a normal browser (not the codespace). Buy one real
book on each rail, then refund it in full. Do both before the influencers buy.

**Which title.** The rule is the cheapest published title with a price in that currency. Nine
titles tie at **£1.99 / ₦1,800**. Use a different one on each rail, so each rail has its own
record:

| Rail | Title | Price |
|---|---|---|
| Card (Stripe) | *Beyond Good and Evil* | £1.99 |
| Naira (Paystack) | *Mrs Dalloway* | ₦1,800 |

⚠ **You already hold all nine as founder comps (W3b).** Buying one turns its comp into a sale.
The refund then withdraws it, so it stays on your shelf marked **ACCESS WITHDRAWN**, and the
comp script won't re-grant a title that has a record. My Library won't change visibly when you
buy, either, because the book is already there. **The alternative** is the only two published
titles you don't hold: *Iri and the Old Witch* and *The Tortoise Food Hunt* at **£2.50 /
₦2,500**. They appear on the shelf when bought, and cost you no comp. Your choice. Tell the
session which you used.

**Card (Stripe):**

1. Open the title in the Book Store, choose **£**, and buy it with your own card.
2. Stripe sends you back to the title's page, which reads *Thank you. This title is now in your
   Library.* The purchase record is written by Stripe's webhook, usually within a few
   seconds. Open **My Library** (refresh it if it was already open), and the book is there.
3. Tell the session **"bought"**. It checks the record, the readership count and the webhook
   delivery.
4. **Refund it:** Stripe (live) → *Payments* → the £ payment → **Refund** → the full amount.
   Stripe keeps its processing fee, so the proof costs a few pence.
5. Within about a minute, My Library shows the book **ACCESS WITHDRAWN** (a full book refund
   revokes it), and the public count goes back down. A *partial* refund would keep the book.

**Naira (Paystack):**

1. Open the title, choose **₦**, and pay with your own card on Paystack's page.
2. Paystack sends you back to the title's page, and the book is in My Library within a few
   seconds, as above.
3. Tell the session **"bought"**.
4. **Refund it the same day:** Paystack (live) → *Transactions* → the payment → **Refund** →
   the full amount. On a Starter business, Paystack takes the refund out of the **pending
   payout**, and refuses it if that payout can't cover it. Paystack settles the next working
   day, so refund before then.
5. ⚠ **A live Paystack refund takes 3 to 10 working days to settle.** The book is withdrawn only
   when Paystack says the refund is *processed*. Until then My Library still shows it, and
   that is correct, because the money hasn't gone back yet. **Don't change anything by hand.**

Tell the session **"refunded"** after each one. It checks the records and the webhook
deliveries again. The card rail is signed off when Stripe's refund has withdrawn the book. The
naira rail is signed off when Paystack's refund is processed and the book reads ACCESS WITHDRAWN.

#### 7b. Memberships: 30 Sep

⏳ **WAITING ON IKENNA** (as of 30 Sep, W30). The store is open; no session makes a purchase.

After 6b, the membership proofs, as originally written:

Use **your own account** in a normal browser (not the codespace), signed in, at
`https://calvaryscribblings.co.uk/membership`.

**Card (Stripe):**

1. Choose **GBP**, *Monthly*, **CHOOSE GOLD**. Pay £2.99 with your own card.
2. You land back on `/membership`. The banner reads **YOU'RE IN** within a few seconds.
   - If it says *PAID — BUT NOT SHOWING YET* after 90 seconds, stop here and tell the session.
     An alert will already be in your inbox.
3. Open **/settings**. Membership shows **Gold · Monthly · GBP**, *Renews on …*, and a
   **Manage** button.
4. **Refund it:** Stripe (live) → *Payments* → the £2.99 payment → **Refund** → full amount.
5. Refresh /settings within a minute. It must read **Free**. Ruling: a full refund ends a
   membership at once. In Stripe, the subscription now shows **Canceled**.

**Naira (Paystack):**

1. On the same page, switch the currency selector to **₦**. Choose *Monthly*, then
   **CHOOSE GOLD**, and pay ₦1,500 with your own card.
2. **YOU'RE IN** within a few seconds, then /settings shows **Gold · Monthly · NGN** with a
   **Cancel** button.
3. **Refund it the same day:** Paystack (live) → *Transactions* → the ₦1,500 payment →
   **Refund** → full amount. On a Starter business Paystack takes a refund from the pending
   payout and refuses it if the payout can't cover it. Paystack settles the next day.
4. ⚠ **A live Paystack refund can take days.** The membership ends when Paystack says the
   refund is *processed*, which is 3 to 10 working days in live mode. It took 30 seconds in
   test mode. Until then /settings still shows Gold, and that is correct: the money hasn't
   gone back yet. **Don't change anything by hand.** When it reads **Free**, the naira rail is
   proven.

Tell the session when both refunds are through. It checks the records and the webhook
deliveries, and signs the rails off.

---

## What the rulings mean, for anyone answering a reader

- **A full refund ends a membership or a pass immediately.** A partial refund on a book keeps
  the book; a full book refund revokes it. A partial refund on a membership or a pass changes
  nothing.
- **Deleting an account doesn't refund unused time.** The deletion confirmation says so.
  Every subscription the providers hold for that reader is cancelled at deletion, including
  one whose tier never arrived.
- **Naira members cancel from /settings.** That stops renewal, and they keep everything until
  the paid period ends. They can also use the "Manage subscription" link in Paystack's emails.
- **Card members change plan or cancel through /settings → Manage** (Stripe's portal). Gold →
  Platinum switches the *same* subscription, and Stripe shows the price difference before they
  confirm. Naira Gold → Platinum starts a new plan and stops the old one renewing. Paystack
  doesn't carry the unused Gold time over, and the page says so before they pay.

## If something goes wrong on the day

- **A `[money]` email:** forward it to a session. The record it names says what happened and
  what was, or wasn't, written.
- **Buyers charged and nothing granted on naira:** check step 4.2 first, the Live Webhook URL.
- **Take the store down fast:** tell a session "close memberships". It flips
  `MEMBERSHIPS_ON_SALE` back and deploys, and all four membership checkouts answer 409 again.
  Anyone already paid keeps what they paid for. Books have no switch (Ruling 3).
