# W13: the reactions take the choreography Ikenna approved

On 26 Sept Ikenna said the web's reaction effect "feels like the worst reaction effect on the
internet". On 25 Sept he had tapped a choreographed prototype and approved it ("definitely the
one"). This round ports that prototype's motion beat for beat, with his palette, the app's A14 row
and his rulings of 26 Sept, to every reaction button on the web.

## Where it lives

- **`app/lib/reactionMotion.js`** holds the motion. The block between its PROTOTYPE markers is the
  prototype's code **verbatim**, byte-identical to `tests/reactions/prototype.verbatim.txt`, and
  CI holds it there. One line is added inside the block, marked `W13-MASK`: where the ground behind
  a button isn't flat, the burst's hole is cut out with a mask instead of painted.
- **`app/components/conversation/Reaction.js`** holds the button (no JSX) and the per-surface
  descriptors. It builds the DOM the prototype expects: `b.st`, `.fx`, `.i-off` and `.i-on` with
  the prototype's transform origins, and FIRE with TONGUE on top. The stylesheet is a React 19
  `<style href precedence>`, so React keeps it in `<head>`. A hand-injected one was once caught
  missing after a re-render, and the buttons measured 300px.
- **`ReactionRow`** (`ConversationKit.js`) lays out story comments and the Square. Open Pages uses
  `Reaction` directly.

| Surface | Reactions | Icon |
|---|---|---|
| Story responses and replies (`/stories/…`, `/reader/…`) | heart, fire | 16px |
| The Square: posts and replies | heart (`like` key), like (`clap` key), fire | 16px |
| Open Pages: the piece's own heart | heart | 18px (kept) |
| Open Pages thread: comments and replies | heart | 16px |

**"The story's own row."** A CMS story page has no reaction row of its own on the web. The only
story-level row is the Open Pages piece's heart, and it keeps its size. Profile and user pages
show reaction counts as pills, not buttons, so they were not touched. Their heart stays `#d4537e`.

**Stored data is unchanged.** Stored comment `clapCount`s stay stored and aren't shown. The
Square's thumbs-up "like" sits on its `clap` key.

## The contract with each surface

`onToggle()` flips the state at once and returns a promise. When a save fails, it restores the
state and rejects, and the button then:
1. clears the burst;
2. shakes ±3px over 300ms;
3. shows "Couldn't save your reaction. Try again." in a `role="status"` line under its row.

The motion runs on the tap, never on a prop change, so an echo from the database, another
device's tap or the revert draws no burst. Four surfaces were changed to keep this contract:
- the reader page and the Square were not optimistic before;
- Open Pages swallowed failures;
- the author's notification now goes out after the save and in its own `try`, so a failed
  notification can't turn a saved reaction back off.

**The Square rendered `ReactionBar` as a component declared inside its own render.** That made it a
new component type every render, so every reaction button remounted on each state change, which
would have torn a burst out mid-flight. It is now called as a function.

## Measured on the web, not copied

A14 says a slot widens only when icon + 5 + count + 10px clear won't fit in 44px, "so 0–99 never
moves a neighbour". In Cormorant at 14px, two tabular digits take **13.75px**:
16 + 5 + 13.75 + 10 = **44.75px**. Followed to the letter, the rule would move every neighbour at
10. I kept the stated outcome:
- **0–99:** the slot holds exactly 44px, and the clear at two digits is **9.25px**.
- **100 and up:** the slot widens by the letter of the rule (`data-wide`: at least 44px, with a
  10px clear).

This was question 2 for Ikenna below. **Ruled 26 Sept (ruling 36): keep it.** W15 pins it.

**Zero was shown in W13.** The prototype's `setCount` draws the number, and A14 says "0–99".
Before W13, story comments hid a zero. This was question 3. **Ruled 26 Sept (ruling 37): hide it
until the first reaction.** W15 does this outside the verbatim block; see `docs/W15-COUNTS.md`.

## Proof

All shots and sheets are kept locally, never committed.

### `tests/reactions/proof.mjs`: the real components in WebKit and Chromium

- **Frames:**
  - Every reaction, on and off, at 390, 820 and 1180, at 1× and ¼×.
  - Compared frozen side by side against `bare.html`, which runs the prototype's code verbatim
    with the prototype's own globals.
  - **WebKit: 666/666 pixel-exact.**
  - **Chromium: 665/666 pixel-exact.** The remaining 1 is Chromium raster noise: replaying one
    frame, about 1 shot in 20 differs by 9 pixels at ≤2/255 on the fire's edge, with identical DOM.
- **The row:**
  - 44×44 slots, 16px icons at the slot's edge, the count 5px after;
  - 14px lining tabular figures (all ten digits 13.75px as pairs), cream 72% → full;
  - 0–99 moves nothing, and 100, 999 and 12345 widen only as far as they must.
- **The count:**
  - no slide on mount, on an echo, or on an echo after a change;
  - a real change slides once, up for an increase and down for a decrease.
- **Behaviour:**
  - Reduce Motion: state and count change at once, with no burst, slide or press;
  - a forced failure reverts, shakes and shows the line;
  - the press-down is .88 over 90ms and back over 160ms;
  - the 9ms tick lands at the icon's arrival: 407, 274 and 282ms.
- **Stability:**
  - no box in or around the row moves while an effect plays;
  - layout-shift score 0 and no long tasks (Chromium);
  - no frame over 50ms.
- **The hole:**
  - painted in the exact ground on a flat surface, masked on a gradient;
  - in both cases the ground shows through and the ring surrounds it.

**313/313.**

### `tests/reactions/live.mjs`: the real pages

- **Setup:** the local export against the live database, signed in as Ikenna, WebKit and Chromium
  at 390, 820 and 1180.
- **Pages:** a story's responses, the Square (clock pinned to 21:00 London), and an Open Pages
  piece and its thread.
- **Checks:**
  - the rows measured, the words, and the hole's colour against the painted ground (equal within
    1);
  - frames of real taps;
  - a saved tap stays on;
  - a failure forced by the database proxy's own `permission_denied`;
  - Reduce Motion;
  - stability.
- **Result: 254/255.** The one failure is WebKit refusing Google's `accounts:lookup` sign-in
  request from the local origin. It comes from the Firebase Auth SDK, is intermittent, and is
  unrelated to the reactions.

**No live record was touched.** Every client write (358) was answered at the socket proxy and none
was forwarded. The proxy also pushes the value to listeners before acking, as the server does.
Without that, the SDK drops its local copy on the ack. The 7 records the taps aimed at read back
unchanged.

### `tests/reactions/mutations.mjs`

It breaks each rule and confirms a test catches it: **23/23 caught**. Two guards are structural,
and the mutants are written to that:
- The echo guard is double: the `[count]` effect dependency and the prototype's equal-value
  return. The mutant drops both.
- The fx layer can't move layout, because it lives in a fixed S×S box in a fixed 44px slot. The
  count's overlap during the slide is what can, so that's the mutant.

### `tests/ci/w13-reactions.test.mjs`

It runs in `npm run test:ci`, with 19 tests covering:
- the verbatim block;
- the palette;
- the button's markup;
- the row's CSS;
- the rulings, the copy and the Reply word;
- every surface on the one button;
- every toggle rethrowing;
- notifications after the save.

## Copy

See `docs/COPY-RULINGS.md`, 26 Sep, W13. Two quiz lines named "the Discussion" and were changed so
that they still point at something. They are **not ruled**.

## For Ikenna

1. **Tap:** a heart, then a fire, on any story's responses. Then heart, like and fire on a Square
   post. Then the heart at the end of an Open Pages piece.
2. **Two-digit counts:** A14's two sentences can't both hold in the web's Cormorant. The slot
   stays 44px for 0–99, and the clear after a two-digit count is 9.25px, not 10. Keep that, or
   widen to 44.75px?
   **Ruled 26 Sept (ruling 36):** keep the 44px slot, with 9.25px after a two-digit count.
3. **Zero:** show "0" (now), or hide it until the first reaction (before)?
   **Ruled 26 Sept (ruling 37):** hide it until the first reaction; the slot keeps its 44px, so
   nothing moves. Done in W15.
4. **The two quiz lines** and "Sign in to join the discussion": rule on the words.
