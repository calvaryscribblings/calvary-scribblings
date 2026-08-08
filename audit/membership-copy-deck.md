# /membership — full copy deck
**Calvary Scribblings · 8 August 2026 · replaces the R11.7 page copy in full**

Every string on the page, in order. House style: British English, single quotes, em dashes with spaces, no Oxford comma, titles italicised. Sentence-case headings. No exclamation marks anywhere.

The page makes **one argument**: *the week is free, the archive is what membership opens.* Any line that does not serve that argument has been cut.

---

## 1 · Hero

**Headline**
> Every story is free the week it is published.

**Sub-headline**
> Membership opens everything before that.

**Standfirst** (one paragraph, centred, ~40ch measure)
> The island publishes new stories several times a week, and those stories are free to everyone — no account, no card, no membership. After seven days they join the archive, where more than a hundred and sixty stories are waiting. That is what a membership opens.

*(Amended 8 Aug 2026 — ruling 1. The first draft read 'three times a week'. Measured over the eight weeks to 8 Aug the island published 6, 6, 13, 10, 11, 12, 9, 11 stories a week — mean 9.88, never below 6 — across 3 to 7 distinct days. Neither reading of 'three times a week' was true, and it understated the island by about 3×. 'Several' is true at ten a week and still true at four. **The schedule is not the volume, and no number goes next to a promise that does not change.**)*

---

## 2 · What stays free

Sits directly under the hero, **before** the cards. It is the argument, not a footnote — a reader has to believe this before a price means anything.

**Section heading**
> What stays free

**Body**
> Seven days from publication, every story is free to read, in full, to anyone who finds it.
>
> The five most recent stories are always free, however quiet a week has been.
>
> All poetry is free. Always, and to everyone.
>
> The Square is free — every conversation and every competition in it.
>
> Every quiz on every free story is free to take.

**Closing line for the section**
> None of that is a trial, and none of it expires.

---

## 3 · The cards

Three cards. Currency and monthly/yearly toggles above them, unchanged in function.

**Strings that must stay computed, not literal.** The shelf line on each card is generated from `capFor('story', tier)` so the marketing figure and the enforced save limit cannot drift apart. That guarantee is worth more than the wording. Where the lists below give a shelf line, treat it as the *template* for the computed string, not a literal to hardcode.

Also unchanged, because they are already right: `Always. No card, no trial.` (Free price subtitle), the interval subtitles, and `A year for the price of ten months.`

### Free

**Price** — `Free` (the literal word in all three currencies, never ₦0)

**Card line**
> Read the island as it is published.

**List**
> Every new story, free for seven days
> The five newest stories, always free
> All poetry, always
> Every quiz on every free story
> The Square, and every competition in it
> Two stories saved for offline reading *(computed)*

**CTA** — `You already have this.` is cut; it reads as condescension. The Free card takes **no CTA at all**. If the card layout needs the slot filled for alignment, use `Start reading` pointing at the island, never a disabled button.

### Gold — £2.99 / $3.99 / ₦1,500 a month · £29.99 / $39.99 / ₦15,000 a year

**Card line**
> The archive opens.

**Bridge line** (italic, above the list — replaces 'Everything in Free')
> Everything on the free island, and —

**List**
> More than a hundred and sixty stories, all of them, all the way back
> Twenty stories saved for offline reading
> Island Games in full, from November
> A Gold mark on your profile, from October

*(Amended 8 Aug 2026 — rulings 2 and 3. 'Island Games in full' moved from October to **November**: October already carries the Series and both profile marks, in the month straight after launch, and Gold's real differentiator is the archive, so Games can afford the later date. The internal board is not the page; the page is a contract. 'The Book Reader Collection, to the halfway mark' is **cut** — see the note under Platinum.)*

### Platinum — £4.99 / $6.49 / ₦2,500 a month · £49.99 / $64.99 / ₦25,000 a year

**Card line**
> Nothing held back.

**Bridge line**
> Everything in Gold, and —

**List**
> As many stories saved as your device will hold
> The *Calvary Scribblings Series*, from October
> A Platinum mark on your profile, from October
> First word on what we publish next, from November

*(Amended 8 Aug 2026 — ruling 3. **Both Book Reader Collection lines are cut**, Gold's 'to the halfway mark' and Platinum's 'whole'.*
*They were the worst lines in the deck and worth recording why. They carried **no date**, so unlike the dated perks they read as claims about what a membership gives you today — and they were false on day one. There is no halfway mechanic anywhere in the codebase (`grep halfway` finds nothing) and the collection has no tier gating at all: `app/lib/readerCollection.js` defines membership by the `readerMode`/`bookReader` flag and says nothing about tiers. Worse, `app/lib/storyAccess.js` **declines to gate these by design** — reader-mode returns `access:'reader'` because the body is an EPUB behind a public URL and the endpoint "does not serve it and does not pretend to gate it". All 10 collection stories are free to everyone today, signed out included.*
*It is boarded as a **DESIGN question, not a copy one**: 'half the Collection' must mean half the TITLES — five of ten, trivially implementable and honest — never half of each book. Stopping a reader at the midpoint of a novel is the harshest gate on the platform and the likeliest source of refund requests. When that split is decided the lines come back, dated, with the five titles named.*
*Platinum still holds without them: the Series, unlimited saves, the mark, first word.)*

**Treatment for the dated lines** — the date is set as a quiet italic clause on the same line, not a badge. 'from October' reads as confidence; 'COMING SOON' reads as a placeholder, and a placeholder on a pricing page reads as a page that is not finished.

---

## 4 · Passes

**Section heading**
> A pass, if a subscription is not what you want

**Body**
> Some readers want the archive for an afternoon, or for one long journey with no signal at the end of it. A pass opens the Gold shelf for a day — or, in naira, for a week — once. There is nothing to cancel and nothing to remember.

**Prices**
> A day — £1 / $1.49 / ₦300
> A week — ₦500 *(naira only; omit the row entirely in GBP and USD)*

**Line beneath**
> A pass is a one-off. It ends on its own.

**Overlap to resolve.** The live passes paragraph already contains 'we do not take saved stories back', and the pass card carries 'What you save is yours to keep afterwards'. §5 now states the ruling properly, so: **strip the sentence from the passes paragraph** (the same sentence twice on one page weakens both), and **keep the pass-card perk line** — it belongs there, in the context of a thing that expires.

---

## 5 · What you keep

New section. States the confiscation ruling to the customer, which is a real differentiator and costs nothing to promise because it is already how the code behaves.

**Heading**
> What you keep

**Body**
> Anything you have saved is yours. If a pass runs out, or a membership ends, or you simply stop — the stories already on your device stay there, and stay readable.
>
> We do not take saved stories back.

---

## 6 · Pre-launch and founding

Two boxes, in this order. Both keep the shape of the current copy, which was the strongest writing on the old page.

**Pre-launch box**
> Memberships open on 30 September. Everything on this page is the real price — nothing here changes on the day. We wanted you to be able to read it first.

**Founding box**
> Join before we open and your price never goes up — not at renewal, and not if you move to a higher tier later. You keep the founding rate for as long as you stay a member.

*(Heading note: neither box needs a heading. The first sentence of each does the work.)*

*(Corrected 8 Aug 2026. The first draft of this note read "both old headings were negatives — 'NOT YET ON SALE' and 'NOT READY TO SUBSCRIBE?'". It named the wrong pair. The two BOX headings being deleted are `NOT YET ON SALE` (pre-launch) and `FOUNDING MEMBERS` (founding) — the latter went unmentioned. `NOT READY TO SUBSCRIBE?` is the **passes section** heading, and it is not deleted at all: §4 replaces it with 'A pass, if a subscription is not what you want'. Three headings change, in two different ways, and the note previously described neither correctly.)*

---

## 7 · Short answers

Three ship. A fourth is drafted below but held back — see the note.

**Can I cancel?**
> Any time, and you keep everything until the period you have paid for runs out. Card memberships cancel from your settings. Naira memberships, for now, cancel by email — we are building the self-service version.

**What happens to the archive if I stop?**
> New stories stay free to you, as they are to everyone. The archive closes. Anything you had saved stays saved.

**Why is poetry free?**
> Poetry is always free on the island. It is short, it is meant to be come across rather than sought out, and putting it behind anything felt wrong.

**Does this change what writers are paid?**
> *[HELD BACK — do not ship. Ikenna supplies this line.]*

---

## 8 · Footer

**Final line, centred**
> New stories every week, free to everyone. That does not change.

*(Replaces 'Stories stay free for everyone, members or not.', which stops being true on 30 September and would read as a broken promise beside a gate.)*

*(Amended 8 Aug 2026 — ruling 1, same reason as the standfirst. This is a standing promise and it has to survive a quiet month. 'Three new stories a week' put a number beside 'that does not change' and would have been a broken commitment the first week the island published two.)*

---

## 9 · The dated promises, and what each one commits you to

**Four** perks have no implementation behind them today. They stay on the page with a month attached. A month on a pricing page is a commitment a paying member can hold you to.

*(Amended 8 Aug 2026 — ruling 2. This section said 'three' and enumerated the Series, the profile marks and first word. **Island Games was missing**, while §3 shipped it on the Gold card as a dated line — so the page carried a dated promise this section did not account for. That is exactly the gap this section exists to close, and it is now the fourth entry below.)*

**The *Calvary Scribblings Series* — October.** Needs a series schema (parent record, ordered episodes), a browsing surface, and episodes that exist. Already on the October board beside Island Games. It is the line that earns Platinum its price.

**The profile marks — October.** A decision blocks the date, not a build. Gold and Platinum already mean quiz-score tiers, and the profile already renders those earned badges. Nothing can be built until the paid mark is given a different name, shape or place.

**First word on what we publish next — November.** No channel exists: newsletter subscribers are keyed by email, membership by uid, no join between them, and the send path takes no segment. Needs a data join, a Worker change, and a standing editorial commitment.

**Island Games in full — November.** *(Added 8 Aug 2026, ruling 2.)* `grep -rn "Island Games"` across the whole repo returns only this deck: no route, no component, no flag, no record. It is the only one of the four with **nothing at all** behind it — the other three have at least a surface or a schema to extend. It sits on the Gold card, and Gold's real differentiator is the archive, which ships on day one; Games is the perk Gold can most afford to wait for. November rather than October because October already carries the Series and both profile marks in the month straight after launch.

**Standing rule:** if a date is going to slip, the page is edited *before* 30 September, not after. Review mid-September, before the live prices are created.

---

## 10 · /links wiring

The membership entry joins the existing link list at `/links`, behind a flag mirroring `BOOKSTORE_LAUNCHED`.

**Flag** — `MEMBERSHIP_LAUNCHED`, false until 30 September, flipped in the same change as the live prices.

**Pre-launch entry**
> **Membership** — opens 30 September. Read the tiers →

**Post-launch entry**
> **Membership** — open the archive →

Both point at `/membership`. Order in the list: below the Book Store entry, above the socials.
