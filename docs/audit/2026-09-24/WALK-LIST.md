# Walk list for Ikenna: what only a real device or a dashboard can show

Each item says what to do and the reading we expect **today**. The expectation was fixed before the walk. If the
device disagrees, the ledger row named in brackets is wrong or already fixed, so say which.

## Operator: dashboards, TEST mode, a throwaway non-founder account (founders can't be deleted)

1. **Stripe API version.** Dashboard → Developers → API version. Record the account default and each webhook
   endpoint's version. If either is `2025-03-31.basil` or later, MON-06 is live: stop and fix it first.
2. **Membership webhook.** Create the test endpoint `…/api/membership/stripe-webhook` with the events
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`, `customer.subscription.updated`,
   `customer.subscription.deleted` and `invoice.payment_failed`. Set `STRIPE_MEMBERSHIP_WEBHOOK_SECRET` on
   Production and redeploy. Re-probe with a bad signature. Expect **400**, not today's 500 (MON-01).
3. **Rotate the Cloudflare Pages deploy hook** that sits in `workers-external/calvary-newsletter.worker.js`,
   then paste the new one into the live Worker as a secret (ADM-35).
4. **Stripe subscription (test)** on a preview with `MEMBERSHIPS_ON_SALE` true and test keys, never Production.
   Subscribe to Gold monthly in GBP with card 4242.
   - Expect `users/{uid}/membership="gold"`.
   - Expect `memberships/{uid}` to hold `rail stripe`, `status active`, the customer and subscription ids, and a number in `currentPeriodEnd` (null means MON-06).
   - Expect the banner to turn to "YOU'RE IN".
5. **Upgrade trap.** Press CHOOSE PLATINUM on the same account. Expected today: a second checkout opens (MON-02).
6. **Dunning.** Use card 4000 0000 0000 0341 plus a test clock past all retries.
   - Expect past_due, then free.
   - Re-check after 5 minutes. If the tier is gold again, MON-03 is confirmed.
7. **Portal.** Settings → Manage. Cancel at period end → `cancelAtPeriodEnd:true`, and the tier is kept.
8. **Deletion with an active subscription.** The subscription shows Canceled in Stripe within seconds, and
   `deletions/{uid}/steps/membership` is set.
9. **Deletion race.** Delete within 2 seconds of completing a checkout. Expected today: the subscription stays
   Active (MON-05). Cancel it by hand afterwards.
10. **Paystack subscription (test).** Card 4084 0840 8408 4081.
    - Expect `ms.` charge.success → tier set, and `paystack_membership_index` seeded.
    - Dashboard cancel → `not_renew`, then `disable` → free.
    - Delete a second account holding an active subscription → Paystack shows it disabled.
11. **Passes on both rails.**
    - Day pass: `memberships/{uid}/pass` with `expiresAt` now+24h, and the scalar unchanged.
    - A second pass extends it and sets `stacked:true`.
    - Expect the banner to show the old expiry first (MON-19).
12. **Refunds.**
    - Stripe pass refund: expect no change (MON-12).
    - A book on each rail: `status revoked`, and the readership counter −1. Paystack only acts on `refund.processed`, which can take days.
13. **Paystack return URL.** Record the exact return URL. `?purchase=success?trxref=` (two question marks)
    would break the banner.
14. **Clear the 8 test purchases** on your word (MON-08): the go-live doc, step 3.

## iPad Safari: 1180 landscape and 820 portrait

- **/admin** (the house):
  - Edit "Alive". Expect "Schedule for later" ticked and a Schedule Story button (ADM-07).
  - Tap the *label* of "Schedule for later". If only the 12px box toggles, ADM-17 is confirmed.
  - Author and Category selects: light boxes with white text means ADM-21 is confirmed; dark means close it.
  - Long-title scheduled row: no Scheduled badge visible (ADM-13).
  - /admin/newsletter at 820: compose column about 130px wide (ADM-18).
  - /admin/bookstore at 820: the Actions column is clipped and the page scrolls sideways (ADM-20).
  - Edge-swipe back while composing: the draft is lost with no prompt (ADM-15).
- **/bookstore (curtain up):** there is no way out except the browser's Back button (SPD-08).
- **Cold /bookstore on cellular** after 30 Sept: nav and hero in under 1s. A blank screen for more than 2s confirms BS-01.
- **Quick Look × and £/₦/$** with a fingertip: the first tap misses (BS-06, BS-07).
- **Settings › Accessibility › Reduce Motion on:**
  - a story's hero still zooms (STORY-07)
  - the Square lock rings still pulse (SQ-06)
  - sign-in still fades up (ACC-08)
- **Page Zoom 200% on /bookstore:** the genre tabs clip ("Historical", "Short Story Collections").
- **VoiceOver on the shelf:** books aren't reachable as links (BS-05), and genre tabs announce no selection (BS-08).
- **/series/read/beta-princess-i1** with Typeface set to Cormorant: if the letterforms look like Georgia, SER-02 is confirmed. Look for rivers on the justified 1180 spread.
- **Save a story for offline:** expect "✓ On your shelf". "Could not save that." confirms LIB-06 on real Safari.
- **Airplane mode, then My Library:**
  - Stories: the shelf shows with the offline banner (a pass).
  - Books: an endless skeleton (LIB-01).
- **The shelf nudge** says "iPhone" on an iPad (LIB-05).
- **Sign-in with a Magic Keyboard:** Tab escapes the modal, Esc does nothing, and there is no AutoFill (ACC-03).
- **/public-library Top Readers:** "@adam_sadiq_olamiposi" runs over its score (HOME-01).
- **Tab through Home → Search → Square → My Library:** watch for a dark frame between tabs (SPD-11, not verified in Safari).

## iPhone Safari

- **/square after 20:00, signed in, type "@":** no suggestions (SQ-01). Reply and quote miss under a thumb (SQ-08).
- **/square before 20:00:** "Last night in the Square" is almost invisible (SQ-07).
- **/bookstore:** tapping the bottom tabs does nothing (SPD-08).
- **Airplane mode on Home without ever opening My Library:** Safari's own offline page (SPD-09).
- **/stories/typo:** Next's default white 404 in Arial (BS-13).
- **/short on a 3× phone:** covers look soft (175px source at 171 CSS px).
- **Settings → Delete account at 390 with the keyboard up:** CANCEL and DELETE stay visible (not verified).
- **/membership?pass=success** as a pass-holder under a UK region: expect "25 Sept 2026". Under en-US you get US order (MEM-02).
- **Sign-in with no network:** "Firebase: Error (auth/network-request-failed)." (ACC-01).

## Android Chrome, mid-range

- **Cold /public-library on 4G:** the first cover appears after about 6–9s (SPD-02).
- **Load /square three times:** no "Aw, Snap". If one appears, SPD-12 is confirmed.
- **Offline reload of /square:** the dinosaur page (SPD-10).
- **Predictive back with Quick Look or the DM sheet open:** the sheet should close and the page stay. Not verified.
- **Browser zoom 200% on /square and /search:** no sideways scroll, but the cookie banner and tab bar take about 40% of the screen.
