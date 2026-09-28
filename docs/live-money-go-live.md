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
4. **DUE NOW — books have been live since 27 Sep.** **Settings → Business → Customer emails**,
   then under **Payments** turn **ON** *Successful payments* and *Refunds*. Stripe's receipt
   is the buyer's only receipt at launch. *(W24, 28 Sep: Stripe's dashboard has moved; this
   path was checked against Stripe's own docs that day. The path this step used to give no
   longer exists.)*
5. **Subscriptions — before memberships open on the 30th.** Three places now, not one
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

**Books went live early, on 27 Sep (W20).** Rulings 52–54: both book rails go live on the
27th, because three influencers publish the store access key on the 28th and test the
purchase flow with real money. Memberships stay closed until launch morning. So step 6 is now
two halves.

#### 6a. Books: done 27 Sep 2026 (W20)

Steps 1, 2, 4 and 5 were done by Ikenna before the round, and so were 3.1–3.3 and 3.6. Step
3.4 (the buyer's receipt emails) is **due now**: this doc sent Ikenna to a path Stripe has since
moved, and W24 (28 Sep) gives the new one. Step 3.5 (subscription settings) waits for the 30th,
and now lives in three places.

- **Keys.** Both are live keys. Stripe's belongs to `acct_…nEB3LO`, the live *Calvary Media UK
  Ltd.* account (charges and payouts enabled). Paystack's belongs to integration `1950328`,
  the same business as the test key the site has always used.
- **Found first: a third live Stripe webhook** that this doc didn't know about. It went to
  the old Dead End paywall worker (`calvary-stripe-webhook`, set up 21 May). It heard every
  `checkout.session.completed` on the account, with no check for what was bought, so every
  card book buyer would also have been given Dead End. Ikenna's ruling: Dead End's paywall
  goes. The endpoint is deleted, the Dead End Payment Link deactivated, the worker deleted
  (nothing else called it), and the price and button taken off the story page. Its one buyer
  keeps it: their record under `purchases/` is untouched, and the page still reads it. Dead
  End itself is unpublished (`published: false`), so its page is currently a 404 for
  everyone. That predates W20 and is Ikenna's call.
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

#### 6b. Memberships: 30 Sep, still to do

Ikenna first does step 3.5 (subscription settings, in the three places it now lives: Smart
Retries and *Cancel the subscription*, the two revenue-recovery emails, and the renewal email). Then a session:

> Creates the 8 live founding Stripe Prices and the live portal configuration, and the 4 live
> Paystack Plans. Pastes their ids into `prices.js` / `paystack-plans.js`. Flips
> `MEMBERSHIPS_ON_SALE` and `MEMBERSHIP_LAUNCHED` in the same commit, which the interlock test
> enforces. Deletes the one "ships no live ids" test. Checks both live webhook endpoints with
> `scripts/money/stripe-webhooks.mjs` (report only; they already exist, so nothing is created
> and no secret changes). Deploys, and proves that the four membership checkouts now answer
> 401 signed out, not 409.

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
