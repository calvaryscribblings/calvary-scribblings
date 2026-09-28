# Hand-off to the app repo: the house dictionary (W23 + W24, 28 Sep 2026) — for the app's next round

> **W24 update — Ikenna's rulings 101, 102, 103 (28 Sep) are FINAL and folded in below.** Port
> this version, not W23's: the credit line names both sources (101), a headword that is also a
> form of another word shows both (102, up to six senses), and a glossary PHRASE gets the Define
> chip (103). The data is unchanged — still `oewn-2025-1`.

The web's Reading Room no longer asks `api.dictionaryapi.dev` anything. By September 2026 that
service answered in ~19.5 s (20 of 20 lookups timed from the codespace on 28 Sep, 10 of them HTTP
522), so behind a 4 s timeout **every** lookup that missed the title's glossary became the calm miss.
The web now reads its own dictionary, Open English WordNet 2025, published as static JSON on the
site. **The app must do the same and stop calling `api.dictionaryapi.dev`.** It fails the same
way in the app, and it sends a reader's words to a third party.

This goes web → app (a system, not a look). The reference implementation is
**`app/lib/dictionary.js`** in this repo. It's plain ESM with no imports, so it can be copied into
the app as-is or run beside yours to compare answers.

## The lookup order (unchanged in shape)

1. **The title's house glossary** (`bookstore_titles/{id}/glossary`) — no network call at all.
   Keys may be phrases ("grand isle"); see *Glossary phrases* below. A multi-word selection that
   misses the glossary goes no further — the house dictionary holds single words only.
2. **The house dictionary** — below.
3. **The calm miss** — `No definition found for “<word>”.` Never an error tone.

One timeout of **4 s** bounds the whole of step 2: the manifest, the shard, and any second shard
morphy sends it to. Offline, a 404, a 5xx or a malformed body are all the miss.

## The URL scheme

```
https://calvaryscribblings.co.uk/dict/en/<version>/manifest.json
https://calvaryscribblings.co.uk/dict/en/<version>/p_<prefix>.json
https://calvaryscribblings.co.uk/dict/en/<version>/LICENSE
```

- **`<version>` is `oewn-2025-1` today.** It's `DICT_VERSION` in `app/lib/dictionary.js`. Pin it in
  the app as a constant, the same way. A version folder never changes. `scripts/dictionary/build.mjs`
  refuses to rewrite one, so every file is served `Cache-Control: public, max-age=31536000,
  immutable`. A new build is a new folder. When the web bumps the version, the old folder stays up
  for at least one deploy.
- **The manifest** lists every shard prefix: `{ version, source, headwords, shards, prefixes: [...] }`.
  Read it once per session.
- **Which shard.** Take the word's key: lowercase it, then replace every character outside `a–z0–9`
  with `_` (`o'clock` → `o_clock`, `éclair` → `_clair`). The shard is the **longest prefix in
  `prefixes` that the key starts with**. If none matches, the word isn't in the dictionary. The file
  name is `p_` + prefix + `.json` (`p_un.json`, `p_con.json`).
- 592 files in all, 8.5 MiB raw / 2.6 MiB gzip. The largest shard is 47.8 KiB gzip. Read each
  shard once and keep it in memory for the session. Don't keep a *failed* read: a reader who was
  offline once shouldn't miss for the rest of the session.

## The entry shape

A shard is one JSON object: headword → entry.

```json
"run":  { "s": [["n", "a score in baseball made by a runner touching all four bases…"],
                ["n", "the act of testing something"],
                ["n", "a race run on foot"],
                ["v", "move fast by using one's feet, with one foot off the ground at any given time"],
                ["v", "flee; take to one's heels; cut and run"],
                ["v", "stretch out over a distance, space, time, or scope; run or extend between two points or beyond a certain point"]] },
"ran":  { "x": { "v": ["run"] } },
"went": { "x": { "v": ["go"] } }
```

- **`s`** — the senses as `[pos, definition]`. `pos` is `n` noun, `v` verb, `a` adjective (satellites
  included), `r` adverb. They're in the source's own order: parts of speech in WordNet's order
  (n, v, a, r), and within each, the index's sense order. **There are at most three per part of
  speech.** The reader is shown three in all. Each part of speech carries its own three because
  morphy works one part of speech at a time.
- **`x`** — morphy's exception entries for this form, by part of speech (from WordNet's `*.exc`
  lists). Only present when the base is a headword in that part of speech.
- An entry may have `s`, `x`, or both (`"saw"` has noun senses of its own).
- Headwords are lowercase and single-word. Multi-word lemmas (`ice cream`) are left out, because the
  Define chip is single-word only.
- No pronunciation: WordNet has none, so the modal's phonetic line is simply absent.

## Morphy — WordNet's own, not a stemmer

Run this against `morphyCandidates` and `dictionaryLookup` in `app/lib/dictionary.js`. The golden
cases in `tests/reader/dictionary.spec.mjs` (the "built dictionary" block) are the parity list.

1. **Normalise** the tapped text exactly as `normaliseWord` does: NFKC, curly → straight
   apostrophes, every dash → `-`, lowercase, strip leading and trailing punctuation, drop a trailing
   `'s`.
2. **Literal first.** If the word's own entry has any `s`, that's the answer: its first three
   senses, headword = the word.
3. **Otherwise, per part of speech, in the order n, v, a, r:**
   - If the word's entry has `x[pos]`, use those bases (reading their shards) and take each base's
     senses **of that part of speech only**. As in `morph.c`, the exception list wins, and the
     rules aren't tried for that part of speech.
   - Otherwise apply the detachment rules for that part of speech, **in this order**, and take the
     **first** candidate whose entry has senses of that part of speech:

     | pos | suffix → ending |
     |---|---|
     | noun | `s`→``, `ses`→`s`, `xes`→`x`, `zes`→`z`, `ches`→`ch`, `shes`→`sh`, `men`→`man`, `ies`→`y` |
     | verb | `s`→``, `ies`→`y`, `es`→`e`, `es`→``, `ed`→`e`, `ed`→``, `ing`→`e`, `ing`→`` |
     | adjective | `er`→``, `est`→``, `er`→`e`, `est`→`e` |
     | adverb | none (exception list only) |

   - Noun guards, from `morph.c`: a noun ending in `ss` or of two letters or fewer isn't detached.
     A noun ending in `ful` is detached on the part before the last `f`, and `ful` is re-appended
     (`boxesful` → `box` + `ful` → `boxful`, which must itself be a headword).
4. **Headword groups (ruling 102).** The tapped word's own entry (step 2), when it has one, is the
   FIRST group — and step 3 still runs, so every base morphy finds follows it as a group of its
   own, in morphy's order (parts of speech n, v, a, r; bases in exception-list or rule order). A
   base that equals the tapped word is skipped; a base reached in two parts of speech is ONE group
   carrying both. A word with no entry of its own (`went`) is just its bases.
5. **Six senses in all, three per part of speech.** Deal one sense per group per round, in group
   order, until six are dealt or every group is exhausted — that is each group's share. Within a
   group whose share is smaller than its senses, spread the share across its parts of speech the
   same way (one per part of speech per round, n, v, a, r), then show the chosen senses in the
   source's order. A group within its share is shown whole.
6. **The modal.** One heading per group, in the modal's existing headword type — the first above
   the senses as before, each later one above its own list. The anchored quote still marks the word
   as tapped.

Expected (groups, against `oewn-2025-1`):

| tapped | groups | parts of speech shown |
|---|---|---|
| `saw` | saw, see | saw n n v · see v v v |
| `left` | left, leave | left n a a · leave v v v |
| `felt` | felt, feel | felt n v v · feel v v v |
| `rose` | rose, rise | rose n n a · rise v v v |
| `found` | found, find | found n v a · find v v v |
| `stalls` | stalls, stall | stalls n · stall n n n v v |
| `leaves` | leaf, leave | leaf n n n · leave n n v |
| `went` | go | go v v v (never the board game) |
| `ran` | run | run v v v |
| `run` | run | n n n v v v |

Also `cities` → city, `mice` → mouse, `happier` → happy, `raven` → raven (never "rave").

## The source line

The foot of the modal:

- a glossary hit: **`House glossary · Calvary Scribblings`** (unchanged)
- a house-dictionary hit: **`Open English WordNet · Princeton WordNet`** — **RULED (101, 28 Sep).**
  The licence asks for credit to both. It replaces W23's one-name draft. The full text is at
  `/dict/en/<version>/LICENSE`.
- a miss: `Calvary Scribblings` (unchanged)

Use the web's constant (`DICT_SOURCE`) verbatim.

## Glossary phrases (ruling 103)

The Define chip is single-word only, **except** for a selection that is one of the title's glossary
phrases (a key with a space in it: "grand isle", "middle passage" today). Every other multi-word
selection still gets no chip.

- Normalise the selection as `normaliseWord` does — which now also **collapses internal whitespace
  to one space**, so a phrase selected across a line break matches.
- Where the chip logic lives apart from the glossary (the web's reader frame), give it the PHRASES
  only — `glossaryPhrases(glossary)` in `app/lib/dictionary.js` — never the definitions.
- A phrase answers from the glossary only. It is never sent to the house dictionary.

## What the app stops doing

- **No request to `api.dictionaryapi.dev`, ever.** Remove the call, its response shaping, and any
  "Free Dictionary" source string.
- No other third-party dictionary. A reader's words stay between the app and our own site.

## The web's side, for reference

- `scripts/dictionary/build.mjs` builds from the pinned release zip (sha256 in the script).
  `--check` proves the committed folder matches a fresh build byte for byte.
- `scripts/launch-check.mjs` has a **Dictionary** row: the live shard must answer `serendipity`
  with a sense. It's RED otherwise, so this can't go silent again.
- `scripts/dictionary/coverage.mjs` measures coverage over the public samples. On 28 Sep 2026 it
  answered 89.0% of 9,792 distinct words, and 93.2% without proper names.
