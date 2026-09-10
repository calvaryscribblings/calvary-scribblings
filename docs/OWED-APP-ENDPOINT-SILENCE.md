# OWED — the app calls neither `/api/hit` nor `/api/story`, and the counters say so

**Status:** measured, unexplained, on the board. Raised APP-DL1, 10 Sep 2026.
**Blocked on:** one answer from the `calvary-app` repo. Nothing here can be fixed from this side.
**Blocks:** T2 (adoption) and T3 (the `content` tombstone) in `STORY-SERVING-CONTRACT.md` §7.

> Ikenna's ruling, APP-DL1: *"it is the question the app round must answer, it blocks T2 and T3,
> and if the app is not calling the endpoint then the story-serving contract has no observable
> uptake at all. Do not let it sit inside a deep-links report."*

---

## The numbers

`node scripts/adoption-report.mjs`, read-only, run 10 Sep 2026 against production:

```
story_clients — last 14 day(s) with data

date          hits   attributed   unknown   migrated share
2026-08-28       1           1         0   100.0%
2026-08-29       3           3         0   100.0%
2026-08-30       1           1         0   100.0%
2026-08-31      68          68         0   100.0%
2026-09-01       0           0         0        —
2026-09-02       2           2         0   100.0%
2026-09-03       3           3         0   100.0%
2026-09-04       0           0         0        —
2026-09-05       3           3         0   100.0%
2026-09-06       9           9         0   100.0%
2026-09-07      12          12         0   100.0%
2026-09-08       1           1         0   100.0%
2026-09-09       2           2         0   100.0%
2026-09-10       3           3         0   100.0%

── THE T3 NUMBER ──
  story opens counted     108
  un-migrated (unknown)     0    0.0%
  MIGRATED                108  100.0%

── BY CLIENT (all days above, /api/hit) ──
      108  100.0%  web__noversion

── CROSS-CHECK: /api/story (migrated traffic only) ──
  total 2739
     2736  web__noversion
        3  unknown
```

**108 story opens in fourteen days. Every one of them `web__noversion`. No app client appears
in either bucket.**

## Why the zero is the finding, and not the good news it looks like

The report prints `MIGRATED 108 100.0%` and that number is **meaningless here**, because
`unknown` is also zero. Read `_telemetry.js`'s own header:

> `new clients → send client/clientVersion/updateId → counted by identity`
> `stale fleet → send nothing → counted as 'unknown'`
> `adoption = 1 − (unknown share of /api/hit)`

**A pre-migration app binary lands in `unknown`.** That bucket exists precisely because the old
fleet cannot be asked. So `unknown = 0` does not mean "the fleet has migrated" — it means
**nothing that is not the website fired the counter at all**, in either generation.

`/api/hit` is the denominator on purpose: "every version fires it, and its own header already
documents the two generations". If the app were reading `cms_stories` directly — the stale path
— it would still show up, as `unknown`. It does not.

**So there are exactly two readings, and the app repo must say which:**

1. **Nobody opened a story in the app in a fortnight.** Possible: iOS first released 8 July 2026,
   Android 18 July, the audience is small, and 108 opens across *all* clients is a small number
   to begin with. Under this reading the instrumentation is fine and the app simply has no
   readers — which is its own, larger problem, and the one APP-DL1 exists to attack.
2. **The app fires neither counter.** Under this reading the contract has **no observable uptake
   whatsoever**, `/api/story` has never served the app, and every §9 checklist item is unshipped.

⚠ **Do not average these two.** They call for opposite work, and the report cannot tell them
apart from this side.

## The three `unknown` calls to `/api/story`, which are the one loose thread

`/api/story` shows `2739` calls: `2736` web, **`3` unknown**. The report flags it itself:

> ⚠ Every caller of that endpoint is new enough to identify itself, so this means a client is
> omitting the telemetry fields — the adoption number is understated until fixed.

Three calls is consistent with a hand-run `curl` (this round made one) as easily as with an app
build that reaches the endpoint but omits `client`/`clientVersion`. **Worth resolving, because
under reading 2 those three calls are the only evidence the app can reach the contract at all.**

## What it blocks

| phase | what it needs | state |
|---|---|---|
| **T2** — "the app ships and takes up" | app traffic visible in `story_clients` | **no evidence it has begun** |
| **T3** — `content` becomes a tombstone | a number, "not a schedule" (§7) | **the number is currently zero, and unreadable** |

§7 is explicit that T3 proceeds on the adoption number. That number cannot be computed while the
denominator has no app in it. **T3 must not proceed on this data**, and it must not be read as
"100% migrated, safe to cut" — cutting `content` on the strength of a `100.0%` that is really an
empty set would hand a tombstone sentence to every app reader at once.

## The questions for the `calvary-app` repo

1. Does the app call `POST /api/hit` on a story open? If so, does it send `client`?
2. Does the app call `POST /api/story` at all, or does it still read `cms_stories` directly?
3. If neither: which of `STORY-SERVING-CONTRACT.md` §9's fifteen checklist items *are* shipped?
4. What are the app's own story-open counts for 28 Aug – 10 Sep 2026? That is the number that
   separates reading 1 from reading 2, and only the app repo has it.

## How to re-measure

```
node scripts/adoption-report.mjs      # read-only, no writes, no credentials beyond the usual
```

Re-run it after any app release. ⭑ **And re-run it the day after a deep-link cut ships** — if
APP-DL1 works, `/stories/*` links start landing in the app, and this is the instrument that will
say so. If the app fires no counter, the round's success will be invisible here too, which is a
second reason to answer question 1 before the cut rather than after.

See [`STORY-SERVING-CONTRACT.md`](../STORY-SERVING-CONTRACT.md) §7 and §9, and
[`docs/APP-DEEP-LINKS.md`](APP-DEEP-LINKS.md) for the round that found this.
