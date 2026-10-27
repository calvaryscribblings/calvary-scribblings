# App handoff: The Series on Home (rulings 233–237)

For the app round that mirrors SERIES-MOVE (web `0149caf2`) and SERIES-MOVE.1. The web is the
reference for the **system** here: the order, the loading rules and the text rules. The numbers
below were measured on the web's own widths. **Re-measure them on the app's own ground. Don't
copy them.** (CLAUDE.md: app → web for look, web → app for systems.)

## The order (233)

Ikenna, 27 Oct 2026: *"On Home, The Series sits directly under Just Added, on web and in the app."*

The web's Home, top down:

hero → Square banner (desktop) → **Just Added → The Series** → Summer Reading banner (hidden
outside its window) → Top Readers → Top 10 → Flash Fiction, Short Stories, Poetry, News &
Updates, Inspiring Stories → Open Pages → Subscribe.

Nothing else moved. Open Pages stays below every genre row and above Subscribe.

## The four rulings (27 Oct 2026, Ikenna)

- **234:** On Home, the Series posters are 160×240: Just Added's card width at the poster's own
  2:3, so the two rows line up card for card.
- **235:** The posters take Just Added's 12px corners but keep their own faint edge, with no
  purple border or glow, because they are artwork.
- **236:** On Home, Just Added, The Series, Top Readers, Top 10 and the genre rows all have 16px
  between their heading and their cards. Just Added and Top Readers move from 12px.
- **237:** The Series card's text sits like Just Added's, with no blank lines held in reserve.
  The row may move by up to a line when it loads.

How the web reads them, which is the part to port:

- **234 is about lining up, not about 160.** A Series card is as wide as a Just Added card, and the
  two strips share their left inset and the gap between cards. So card *n* of The Series starts
  at the same x as card *n* of Just Added. The poster's height follows from its own 2:3.
  If the app's Just Added card isn't 160 wide, the Series card takes the app's width, not 160.
- **235:** the corner radius is whatever Just Added's is. The edge is a 1px hairline,
  `rgba(255,255,255,0.08)`, with no shadow. Just Added's purple border and glow are not carried
  over.
- **236:** heading-to-cards is one value for every row listed. Open Pages is excluded. It has a
  three-line heading with its own type and a 20px gap, a separate design the ruling didn't
  cover.
- **237:** the title takes Just Added's title style and clamps at two lines. The shelf line
  ("5 instalments · next 3 November") takes Just Added's **author line** style exactly: same
  size, same line height, same 4px gap under the title. It also clamps at two lines. Neither
  holds space it doesn't use, so a one-line title has its shelf line directly beneath it.
  The longest line the format writes ("12 instalments · next 30 September 2027") fits in two
  at the web's width.

## The skeleton rules

The Series loads on its own reads, separately from the page's main load. Directly under Just
Added, drawing nothing until those reads land would push everything below it down by a whole
row. So:

1. **First read only.** While the first read is in flight, draw a skeleton: the same header
   (kicker, then "The Series"; the web keeps the See-all's box but hides it) and the same poster
   frame. Its text area holds a **two-line title and a one-line shelf line**. That's the middle
   of the four cases, so the finished row lands within one line of it either way.
2. **Nothing on an empty or failed first read.** No skeleton left behind, no section, no
   message. An empty Series section would advertise a shelf with nothing on it.
3. **A re-read never brings the skeleton back.** When an instalment's release minute arrives,
   the row reads again (W35). That re-read keeps the drawn row up while it runs, and if it
   fails the row already drawn stays.

## What the web measured

Emulator build, `npm run test:series-home` (`tests/series/home-placement.spec.mjs`), at 390px
and 1280px wide. The two widths gave the same numbers except where noted.

| | |
|---|---|
| Poster | 160 × 240, radius 12px, 1px `rgba(255,255,255,0.08)`, no shadow |
| Left edges, first two cards | Just Added = Series: 15.59 / 189.59 (390px); 51.19 / 225.19 (1280px) |
| Heading → cards | 16px on Just Added, The Series, Top Readers, Top 10, Flash Fiction |
| One-line title → shelf line | 4px |
| One title line | 18.3px (0.88rem × 1.3) |
| Skeleton row height | 400.19px |

The four text cases, finished row against skeleton (same at both widths):

| title | shelf | row | vs skeleton |
|---|---|---|---|
| 1 line | 1 line | 381.89px | −18.30px |
| 1 line | 2 lines | 397.50px | −2.69px |
| 2 lines | 1 line | 400.19px | 0 |
| 2 lines | 2 lines | 415.80px | +15.61px |

Gaps around the row (from the lowest text or cover of one row to the next row's kicker):
Just Added → The Series 32px, The Series → Top Readers 32px, against 33px between two genre rows.

## What the app should measure

On the app's own Home, at its own phone and tablet widths, in points:

1. The left x of the first two Just Added cards and the first two Series cards. They must be
   equal.
2. The Series poster's width, height and corner radius against Just Added's card.
3. Heading-to-cards on Just Added, The Series, Top Readers, Top 10 and one genre row. One value
   for all five.
4. With a one-line title, the gap between the title's bottom and the shelf line's top. It must
   equal Just Added's gap between title and author line.
5. The skeleton's row height, and the finished row's height for the four cases (title 1 or
   2 lines × shelf 1 or 2 lines). Each difference must be no more than one title line *in the
   app's own type*.
6. With the first read held, the skeleton shows. With an empty shelf, nothing shows and no
   skeleton is left. After a release-minute re-read, the skeleton never reappears.

Report those numbers back in the round's notes; they are the only interface between the two
repos.
