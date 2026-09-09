# R46.2 — material for Ed Oiji's roster card

Generated from live data on 9 Sep 2026. **Nothing has been written.** Ikenna's ruling put Ed Oiji
on the roster; the bio and the register are Ikenna's and Claude's to approve, exactly as the other
ten were, and the write follows on his word.

⚠ **He has written his own bio.** That is the material — see below — and it should be the starting
point rather than something composed from the work, which is what the other ten needed.

---

## The person, resolved live from `users/VbCrNAu3EoZD30zoa30d22xtQZf2`

| | |
|---|---|
| **displayName** | `Ed Oiji` — this is the byline the ten stories already carry |
| **username / handle** | `devwin` / `devwin` |
| **reader avatar** | **yes** — 200 OK, 1,995,116 bytes, `image/png` |
| **isAuthor** | `true` |
| **user_search copy** | present and **in agreement** with the live record (name, username, avatar) |
| **joined** | 2026-05-11 |

⭑ He draws a **photograph**, not the quiet disc — so the Voices row becomes seven photographs and
four discs.

⚠ Note the avatar is a **2 MB PNG**. Every other row on the index lazy-loads a much smaller file;
this one is worth resizing at some point, but it is his upload and not this round's business.

## His own bio, verbatim (`users/VbCrNAu3EoZD30zoa30d22xtQZf2/bio`, 192 chars)

> A Silicon Scribbler, developer, tech consultant, and humanitarian worker with a passion for ideas that inspire and inform. I write about tech, society, and whatever else captures my curiosity.

## The work — 10 live published pieces

- **by category**: News & Updates 6 · Inspiring 4
- **by subcategory**: Tech 4 · Personal Essay 4 · Culture 2
- **byline stored on every piece**: `Ed Oiji`
- **handle stored**: `devwin`

Titles, newest first, with subcategory and opening line:

- *Apple's Quiet Health Overhaul* — News & Updates / Tech  (Sep 4, 2026)
  > Apple’s health features feel less like gimmicks and more like tools that show up right when you need them. The one making the biggest splash on road trips is…
- *The Resistance of the Worn Strap* — News & Updates / Tech  (Jul 30, 2026)
  > An industrial fan roars overhead, fighting a losing battle against the heavy air inside Bodyline Gym in Maitama. It is 6.30pm on a Tuesday. The floor hums with…
- *Beyond the Metered Grid* — News & Updates / Tech  (Jul 27, 2026)
  > The late-afternoon sun filtered through the glass displays of Kanyi's phone repair kiosk at Ndupet GSM Plaza in High Level, Makurdi's business hub, catching the…
- *Amoré’s Cage* — News & Updates / Tech  (Jul 23, 2026)
  > The heavy July rain had finally stopped, leaving the air over Makurdi thick and humid. Inside a cramped shop in the town's bustling High Level area, the low hum…
- *When the Basket Bleeds* — News & Updates / Culture  (Jul 13, 2026)
  > The fragile peace of Yelwata, a small farming community in Guma, was shattered overnight between 13 and 14 June 2025. Kpadoo was putting her ten-year-old…
- *The Last Shared Second* — Inspiring / Personal Essay  (Jul 6, 2026)
  > The silence came first. It was that agonising, split-second vacuum of sound that only happens when a striker beats the final defender and the ball is…
- *The Frictionless Trap* — Inspiring / Personal Essay  (Jul 5, 2026)
  > I recently found an old, battered Walkman at a small stall tucked away near Wadata market. It was bulky, the plastic was scratched, and it hummed with a…
- *My Best Friend Is An Algorithm* — Inspiring / Personal Essay  (Jul 2, 2026)
  > It started as a simple productivity experiment. I had been using various AI tools to draft grant proposals and structure workshops for Roots Media Initiative…
- *The Iron and the Wood* — News & Updates / Culture  (Jul 1, 2026)
  > The room is dimly lit, but the music is heavy. It carries the distinct, unhurried stride of Afro-Soul — a bassline that feels like blood pumping through an…
- *The Ghost At the Dinning Table* — Inspiring / Personal Essay  (Jun 30, 2026)
  > The ambient noise of the riverside lounge, The Kitchen, in Makurdi was supposed to be the backdrop to a celebration. It was my partner's birthday. The humid…

## The slug

`ed-oiji`, from the admin's own `slugify("Ed Oiji")` — the same function that generates story
slugs, since both become URL segments in the static export. **Nothing occupies it**: the roster
holds ten slugs and `ed-oiji` is not among them, and `out/voices/` has no such page.

⚠ One existing slug does NOT match its own display name: **`arthor-eze`** regenerates as
`arthur-eze`. That is a frozen typo in a key, not a pattern to copy — the slug is the key and
renaming it would orphan the card's URL. Derive `ed-oiji` from the function, not from that
precedent.


## The shape of a roster record — before one is created

`cms_voices/{slug}` carries **14 fields**. What the live ten actually hold:

| field | on the ten | required? | what it is |
|---|---|---|---|
| `slug` | 10/10 | **required** | the key, repeated inside the record. URL segment. |
| `displayName` | 10/10 | **required** | the roster's copy of the name. ⚠ **Not read for display** — the index resolves `users/{matchUid}` at render. Keep it right anyway; a wrong copy gets copied. |
| `matchUid` | 10/10 | **required** | ⚠ **THE FIELD THE AVATAR AND NAME RESOLVE THROUGH.** Not `authorUid` — that field does not exist on any roster record, and reading it yields a screen of fallback discs that looks like "nobody uploaded a photograph". For Ed: `VbCrNAu3EoZD30zoa30d22xtQZf2`. |
| `cardImage` | 10/10 | **required** | ⚠ **ED HAS NONE. This is the one blocker.** See below. |
| `cardSizes` | 10/10 | derived | `{w360, w540}`, generated from `cardImage` on upload. |
| `order` | 10/10 | **required** | the ten are 1…10 with no gaps. Ed is 11 unless Ikenna places him, which renumbers the others. |
| `published` | 10/10 | **required** | all ten `true`. A draft is readable at the node but renders nowhere — both the grid and the author page gate on `=== true`. |
| `bio` | 10/10 | optional in the form | universal in practice. Ed has written his own — above. |
| `register` | 10/10 | optional in the form | universal since R46.1. Ikenna's to approve. |
| `createdAt` | 10/10 | set by the form | epoch ms |
| `updatedAt` | 10/10 | set by the form | epoch ms |
| `genreTag` | **6/10** | optional | a form list (`SHORT STORY. POETRY`). Empty on four. Genuinely optional. |
| `message` | **0/10** | optional | never used by anyone. |
| `portrait` | **0/10** | optional | never used by anyone. |
| `matchNames` | 0/10 | optional | for stories saved with no uid. ⚠ **Ed does not need it** — all ten of his pieces carry `authorUid`. |

So a complete card in the house's actual practice is **eleven fields**: the seven required, plus
`bio`, `register`, `createdAt`, `updatedAt`. `genreTag` is a judgement call; `message`, `portrait`
and `matchNames` are dead in the data and should be left unset rather than filled for symmetry.

**What the rules enforce:** nothing per-record. `database.rules.json` gives `cms_voices` a public
`.read` and an admin-only `.write`, and there is **no `.validate` on `$slug`** — the superseded
`database.rules.voices-fragment.json` documents an intended
`hasChildren(['slug','displayName','cardImage','order','published'])` but it is not deployed. ⚠ So
the database will happily accept a partial card; the completeness check is this table, not the rules.

## ⚠ The one blocker: there is no card image

All ten cards point at `voices/{slug}/card.{png|jpeg}` in Storage, with `w360`/`w540` derivatives.
Ed has none, and **his reader avatar is not a substitute** — they are different assets doing
different jobs:

- the **reader avatar** (`avatars/{uid}`) is what the search index draws, and he has one;
- the **card image** (`voices/{slug}/card.*`, 1080×1350 per the admin form) is the editorial portrait
  the `/voices` grid and his own author page render, and it is a commissioned or chosen image.

A card created without one would appear on `/voices` as a hole. Someone has to supply the image
through Admin → Voices, which also generates the derivatives.

## And the write is not the whole job

`/voices` and `/voices/{slug}` are **statically exported** — `generateStaticParams` enumerates
`cms_voices` at build time. Creating the record makes the card real in the database; the page at
`/voices/ed-oiji` does not exist until a deploy runs. The search index picks him up immediately,
because it reads `cms_voices` live in the browser — so for a window he would be listed on the index
and link to a 404. Sequence the deploy with the write.

## When Ikenna approves

Same discipline as the ten: read before write, **PATCH not PUT**, and every other field on every
other record verified byte-identical afterwards. `scripts/write-voice-registers.mjs` is the pattern.
