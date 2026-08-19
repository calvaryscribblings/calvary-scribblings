# R14 — readership counts: what was measured

Every image and every number here was taken against the **Firebase emulators**, never
production, with the four real published titles copied out of production by public read. No
purchase record and no readership count was written to the live database.

## The line, at 0, 1 and 12

`readership-0-1-12.png` — the same page, the same credits strip, three stored counts.

| count | rendered |
|---|---|
| 0 | *nothing.* No element, no zero, no dash. |
| 1 | `IN ONE READER'S LIBRARY` |
| 12 | `IN 12 READERS' LIBRARIES` |

Computed style, read off the DOM rather than described: **Cinzel, 8.32px, 1.9968px tracking
(.24em), `text-transform: uppercase`, `rgba(201,164,76,.55)`** — the credits strip's own label
face, verbatim, so the line reads as a sixth entry in the same block. The string itself is
sentence case (`In 12 readers' libraries`); the shouting is CSS's, as it is for every other
small-caps line in this shop.

## The ledger, driven end to end

`functions/api/bookstore/stripe-webhook.js` — the shipped handler, not a stub — delivered
against a real emulator RTDB. Only the OAuth mint is faked; the signature check, the
idempotency read and the multi-path write are production code.

```
start                                        count = null
reader A buys                             →  count = 1
SAME webhook delivered again (replay)     →  count = 1
and a third time                          →  count = 1
reader B buys                             →  count = 2
reader B refunds                          →  count = 1
the refund is delivered again             →  count = 1
reader B buys AGAIN (new session)         →  count = 2
reader C buys                             →  count = 3
```

## The reconciler, agreeing and then finding drift

`scripts/readership-source.mjs` recomputed from the emulator's purchase records:

```
  readerA    basil            active   cs_A1
  readerB    basil            active   cs_B2      ← the repurchase overwrote the refund
  readerC    basil            active   cs_C1

  title    stored    true   status
  -------  ------  ------   ------
  basil         3       3   ok

[readership] ✓ stored counts agree with the purchase records.
```

Then the node was corrupted by hand and the same code run again:

```
  title       stored    true   status
  ----------  ------  ------   ------
  basil            9       3   DRIFT
  the-rescue       4       0   DRIFT

[readership] ✗ 2 title(s) DRIFT. Nothing was written — this command never writes.
```
