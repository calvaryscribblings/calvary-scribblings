# W15: the counts, as ruled

On 26 Sept Ikenna answered W13's questions 2 and 3.

- **Ruling 36.** The 44px slot stays, with 9.25px after a two-digit count. From 100 the slot
  still widens (`data-wide`: at least 44px, 10px clear). Nothing changed; W15 pins it.
- **Ruling 37.** A count is hidden until the first reaction, so zero shows the icon alone. The
  slot keeps its 44px, so the first count appears without moving anything.

## How zero is hidden

The prototype's `setCount` sits inside the verbatim block and always draws the number, so it is
not touched. `Reaction.js` calls it through `showCount`, which then marks every number reading
"0" with `.z`, and the stylesheet hides `.rx-count>.n.z` with `visibility`, not `display`. The
0 keeps its box, so:

- at 0 the button paints the icon alone;
- 0→1 is the 1 sliding in, with no 0 seen leaving;
- 1→0 is the 1 sliding out, with nothing seen arriving;
- nothing in or around the row moves either way.

Every surface draws its count through the one button: story responses and replies (`/stories`,
`/reader`), the Square's posts and replies, and Open Pages (the piece's heart and its thread). No
surface prints a count of its own beside a button. The aria-label already named no zero.

Profile and user pages show reaction pills, not buttons. They already print nothing at zero
(`ReactionPill` returns `null`), so they were left alone.

## Proof

- `tests/ci/w15-counts.test.mjs` (in `npm run test:ci`): the class and its CSS, `showCount` on
  mount and on every change, the 44px slot, `data-wide` from 100, and both rulings recorded.
- `tests/reactions/proof.mjs`, new `zero` section, in WebKit and Chromium: no digit painted at 0
  (pixel-identical to the icon alone), one slide in at 0→1 and one out at 1→0, nothing moving,
  Reduce Motion at once, and 44px at 0, 1 and 99. The row's two-digit clear is now held to 9.25px
  in WebKit.
- `tests/reactions/mutations.mjs`: five new mutants for the two rulings. **28/28 caught.**

Full proof: **394/395** (W13 was 313/313; the 82 new checks are the zero section). The one
failure was WebKit's "no frame over 50ms" in the stability section at count 12, which W15 does
not touch. It measured 77ms on a two-core Codespace at load 7.8, and passed 4/4 on two of three
reruns. It is a timing check under load, not a count.

**Headless Chromium on Linux measures 9px, not 9.25.** It has no subpixel glyph positioning, so
it rounds each digit to 7px. There the proof holds the clear to what the 44px slot leaves.

**Running WebKit in this Codespace.** Run the proof with `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`.
Without it, WebKit's GPU path under Mesa crashes the page when a count slides from one digit to
two at 2×. This happens at W13's commit too, so it is the container's GL, not the code.
