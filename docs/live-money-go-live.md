# Going live with money, 30 September 2026: Ikenna's walk

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
4. **Settings → Customer emails:** turn **ON** *Successful payments* and *Refunds*. Stripe's
   receipt is the buyer's only receipt at launch.
5. **Settings → Billing → Subscriptions and emails**:
   - **Manage failed payments:** Smart Retries **ON**.
   - **If all retries for a payment fail:** choose **Cancel the subscription**. ⚠ This one
     matters. Our code keeps a member's tier while Stripe is retrying a card. Only a
     *cancellation* takes the tier away. If Stripe is set to "mark as unpaid" instead, a
     member whose card is dead keeps their tier for ever.
   - **Customer emails:** turn **ON** *Send emails about upcoming renewals*, *Send emails
     when card payments fail* and *Send emails about expiring cards*.
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

That is the whole instruction. What the session then does, with no dashboard involved:

> Checks both keys really are live, and which account each belongs to. Creates the 8 live
> founding Stripe Prices and the live portal configuration, and the 4 live Paystack Plans.
> Pastes their ids into `prices.js` / `paystack-plans.js`. Flips `MEMBERSHIPS_ON_SALE` and
> `MEMBERSHIP_LAUNCHED` in the same commit, which the interlock test enforces. Deletes the
> one "ships no live ids" test. Creates both live Stripe webhook endpoints (books and
> memberships) with `scripts/money/stripe-webhooks.mjs --i-mean-live`. Sets the four
> **Production** Pages secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
> `STRIPE_MEMBERSHIP_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`. **Preview keeps its test
> keys.** Then it deploys, and proves the deployment is the one serving: both webhooks
> answer 400 to a bad signature, and a signed-out checkout answers 401. It clears
> `ops/test_buyers` (inert on live keys, and removed anyway).
>
> It stops and tells you if anything doesn't match. It reports the commit and the deployment
> id when it is done.

Wait for that report before step 7.

### 7. One real purchase and one refund, per rail

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
