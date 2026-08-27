// R18 — THE AUTHOR BLOCK, on the Book Store detail page.
//
// ── WHERE IT STANDS ──────────────────────────────────────────────────────────────────────
// After the synopsis, before the editor's note. The page's reading order in that column is:
//
//     cover / title / byline / pills → pull-quote → short blurb
//     THE STORY   → synopsis
//     THE AUTHOR  → photograph, name, bio          ← this file
//     editor's note box (— Calvary)
//     CTA button
//
// The note is the last beat before the button and stays that way. An author block placed
// after it would put a biography between the curator's sentence and the thing it is
// recommending, which is the one position this section must never take.
//
// ── THE GRAMMAR IT FOLLOWS ───────────────────────────────────────────────────────────────
// A gold section label in tracked caps, then the content. Verbatim from the "From the book"
// head further down the same page (page-detail.js): Cinzel .58rem, .28em, uppercased by CSS,
// #c9a44c, 1.2rem of air beneath. It is the page's own label face, not a new one — the whole
// point of a house grammar is that a reader meets the third head and already knows what it is.
//
// ── NO FALLBACK ──────────────────────────────────────────────────────────────────────────
// authorBlockOf() returns null when there is no bio and no photograph, and this component
// returns null with it. NOT an empty <section>, NOT a hidden one, NOT a label with nothing
// under it: the element is ABSENT from the document. A title with no author block is a normal
// title — an anthology has no single author — and the shape of "normal" here is silence.
// tests/bookstore/author-render.test.mjs asserts the ELEMENT is missing rather than empty,
// because an empty frame passes a string test and still leaves a hole on the page.

import { authorBlockOf } from '../../lib/bookstore/author';

// THE PHOTOGRAPH'S TREATMENT — a plate, not a raw upload dropped into a circle.
//
// The shop prints books: rectangles with a hairline, a deep shadow and warm paper. A round
// avatar is the vernacular of a profile page, and this page has no profiles on it. So the
// photograph is set as a portrait PLATE — 4:5, the ratio a printed author photograph actually
// takes on a jacket flap — with the same 1px radius the shelf card uses, the same muted gold
// hairline the metadata strip rules with, and a shadow at the cover's depth.
//
// The filter is the quiet half: a touch of desaturation and warmth so a publisher-supplied
// JPEG, shot against whatever wall it was shot against, sits in a near-black page beside
// Cormorant rather than glaring out of it. It is a tone, not a duotone — the face stays a face.
export const AUTHOR_BLOCK_CSS = `
.bd-author{margin-top:2.6rem}
.bd-author-label{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.28em;text-transform:uppercase;color:#c9a44c;margin-bottom:1.2rem}
.bd-author-body{display:flex;gap:1.6rem;align-items:flex-start}
.bd-author-plate{flex:0 0 auto;width:124px;aspect-ratio:4/5;object-fit:cover;object-position:center 30%;
  border-radius:1px;border:1px solid rgba(201,164,76,.22);box-shadow:0 10px 26px rgba(0,0,0,.5);
  filter:grayscale(.22) sepia(.1) contrast(1.02);background:rgba(201,164,76,.05)}
.bd-author-text{min-width:0}
.bd-author-name{font-family:'Cinzel',serif;font-size:1.02rem;font-weight:600;letter-spacing:.03em;color:#f0ead8;margin:0 0 .7rem}
.bd-author-bio{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.02rem;line-height:1.8;color:rgba(240,234,216,.66);margin:0}
/* R28 — the handset. The block stacks, and it stacks LEFT.
   "text-align:center" came off with the blanket one on .bd-header (see the note there):
   Ikenna's ruling names the author bio as body copy, and body copy is left-aligned.
   ⚠ align-items MOVED WITH IT, and that is a proposal rather than a transcription — the app
   witnesses this block on a phone but the round carried no figure for where the PLATE sits
   once the text beside it is left-aligned. A centred photograph over left-aligned prose reads
   as two alignments in one block, so the plate lines up with the text it belongs to. If
   Ikenna wants the photograph centred over left copy, this is the one line to change back. */
@media(max-width:720px){.bd-author-body{flex-direction:column;align-items:flex-start}.bd-author-plate{width:150px}}
`;

export default function AuthorBlock({ title }) {
  const block = authorBlockOf(title);
  // The absence, said plainly. See the header note — this is the whole no-fallback rule.
  if (!block) return null;

  const { name, bio, photoUrl, alt } = block;

  return (
    <section className="bd-author" data-testid="author-block">
      <div className="bd-author-label" data-testid="author-label">The author</div>
      {/* PHOTO-ONLY and BIO-ONLY both land here. The flex row simply has one child in each
          case: no reserved column, no placeholder plate, and a bio with no photograph runs to
          the column's full width rather than indenting past an empty box. */}
      <div className="bd-author-body">
        {photoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element --
             26 Aug 2026. The rule advises next/image. next.config.mjs sets
             `images: { unoptimized: true }` under `output: 'export'`, which is what a static
             export requires — there is no Next server to run the optimizer, so <Image /> emits
             a plain <img> with the same src and adds a client component for nothing. The alt
             text is the editor's own authorPhotoAlt (app/lib/bookstore/author.js), so the
             accessibility half the rule is sometimes a proxy for is already covered and
             jsx-a11y/alt-text passes here. Suppressed at the site rather than repo-wide: the
             day this app stops being a static export the other 78 occurrences should all light
             up again. */
          <img className="bd-author-plate" data-testid="author-photo" src={photoUrl} alt={alt} loading="lazy" decoding="async" />
        )}
        {(name || bio) && (
          <div className="bd-author-text">
            {/* The same display register as the rest of the page's proper nouns — Cinzel, the
                h1's own face, a step down in size. NEVER derived from title.author: the byline
                and the author's name are different claims and may disagree by design. */}
            {name && <p className="bd-author-name" data-testid="author-name">{name}</p>}
            {bio && <p className="bd-author-bio" data-testid="author-bio">{bio}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
