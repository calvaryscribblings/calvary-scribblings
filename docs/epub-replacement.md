# Replacing a live book's EPUB

A saved reading position is a CFI: coordinates into one file's bytes, pinned to the Storage
generation of `master.epub` ([reading-position-pin.md](./reading-position-pin.md)). Upload any
new file and the generation changes, so every saved position falls back to its `fraction`. Since
W43 ribbons (`readerBookmarks`) carry the same pin and use the same table. Ribbons saved before
W43 carry none, and their CFI is still used as-is against the new bytes, so the carry-over
handles unpinned records too (below).

So **repair, don't rebuild.** A rebuild re-serialises every document and moves every place in
the book. A repair changes only the bytes that are wrong. Places outside the repair then resolve
to the same text, keep their CFI string, and need only re-pinning.

## The tools — `scripts/epub-repair/`

| step | command | what it does |
|---|---|---|
| repair | `repair.mjs --in <a.epub> --plan <plan.json> --out <b.epub>` | split one chapter file at bare heading lines, or relabel exact bytes |
| verify | `verify.mjs --original <a> --repair <b> --plan <p> --epubcheck <jar>` | the gate: byte identity, block equality, EPUBCheck, build-epub `--check`, the folded-headings audit |
| open | `open-in-foliate.mjs --epub <b> --plan <p> --shots <dir>` | the vendored reader in Chromium: contents in order, each changed chapter opens at its heading |
| map | `map-positions.mjs --old <a> --new <b> [--title <id>] [--sample]` | dry run of the carry-over: kept / mapped / landed for every saved place |
| carry | `carry-over.mjs --title <id> --old <a> --new <b> [--old-generation <g>] [--new-generation <g> --apply]` | the carry-over's write mode; dry run by default |
| swap | `swap.mjs --title <id> --dir <private folder> [--go]` | the whole swap in order; dry run by default |

Plan formats are documented at the top of `lib.mjs`. **Plans, EPUBs, screenshots and reports
live outside the repo** (`~/calvary-private/epub-repairs/<book>/`), and every tool refuses a path
inside the work tree. Plans quote a book's headings, and the files are licensed books.

## What a repair may change

- **Split:** the split file, the new files, the OPF, `nav.xhtml` and `toc.ncx`. Nothing else.
  - The kept file is the original's bytes up to the block before the first heading line, then
    its original closing bytes.
  - Each new file is the split file's head (with its own `<title>`), a pattern chapter's h1 and
    opener with the label swapped, the moved blocks verbatim, and the same closing bytes.
  - New itemrefs go straight after the split file. Existing names, ids, hrefs and spine order
    stay as they are.
- **Relabel:** the edited files and the OPF. Each edit is an exact byte match with an expected
  count, so an em space is not a space and a numeral that appears twice is refused.
- Both update `dcterms:modified`.

A heading line with markup on it, an ambiguous match, a collision, or pattern chapters that
disagree **stops the repair**. That book goes back to the publishing side.

## The carry-over

For each saved place, in this order:

1. **Kept.** The stored CFI still resolves in the new file, to the same document and the same
   text at both ends. Keep it byte-for-byte; only `epubVersion` changes.
2. **Mapped.** Take the block the place starts in. Find the same text, at the same occurrence
   across the whole spine, in the new file, at the same character offset. Write the new CFI
   with foliate's `fromRange`, resolve it back, and require the same text.
3. **Landed.** If the text is gone (a removed heading line), use the start of the chapter that
   the next mappable block moved to. Never the start of the book.

Fractions come from foliate's own `SectionProgress` over uncompressed section sizes.

### A stored CFI is wrapped exactly once (W47)

Every CFI the carry-over writes is `epubcfi(` + body + `)`, with no second `epubcfi(` inside
(`scripts/epub-repair/cfi.mjs`, `wrappedOnce`). foliate's `joinIndir` unwraps its parts and
wraps the join once, so its result is never wrapped again. W45 did wrap it again: record A
went out as `epubcfi(epubcfi(/6/84!…))`. foliate's parser read that at the right place, so the
mapping's own round trip passed and nothing caught it. Nothing may rely on that.

The guard, `guardCfi`, runs on every decision, whichever branch made it (kept, mapped, landed,
or a pin-only write). A record whose planned CFI breaks the rule is **refused**. It is shown as
`REFUSE (refused: cfi not wrapped once; was <branch>)`, counted in `refused`, never backed up or
written, and the run exits non-zero. The dry run prints `planned cfi wrapped once` or
`NOT WRAPPED ONCE` on every line it would write, and `stored cfi …` on every line it leaves, so
a fault like W45's shows before anything is written. A refused record needs a person: find out
why its CFI came out that way. Don't hand-edit it into shape.

## On the day

1. `verify.mjs` and `open-in-foliate.mjs` both clean, and a `swap.mjs` dry run shows the live
   generation matching the recorded one, no record it cannot carry, and no `REFUSE` or
   `NOT WRAPPED ONCE` on any line.
2. `swap.mjs --go` does the rest, in this order, stopping at the first failure:
   - it confirms the live generation is the one recorded at download;
   - it copies that generation to `calvary-scribblings-storage-backups/epub-replacements/<timestamp>/<titleId>/`;
   - it uploads with `ifGenerationMatch` on that generation, so a live file that changed since
     the download refuses the upload, and carries the content type, disposition and custom metadata;
   - it runs `carry-over.mjs --apply`, which refuses unless the live generation is the new one;
   - it requires the live object's sha256 to equal the repair's.
3. The carry-over, per record:
   - **pinned new** → leave;
   - **pinned old** → kept, mapped or landed, written with the new pin;
   - **unpinned** → the file its CFI resolves in *and* its own fraction agrees with (within
     0.02; the closer one if both). Old → as pinned old. New → **pinned new** ("pinned new (was
     unpinned)"), cfi unchanged, so a later replacement can't trust it blindly. Neither →
     **pinned old** ("pinned old (unplaced)");
   - **unpinned, read in the old file, but unmappable or mapped with text that differs** →
     **pinned old** ("pinned old (unplaced)");
   - **pinned old and can't be placed** → leave: it already reads by fraction;
   - **pinned to anything else** → leave and report.
   **No unpinned cfi is ever left behind (W44).** Both surfaces trust an unpinned cfi, so an
   old-file cfi left unpinned would be read precisely, and wrongly, against the new file. A
   record pinned old (unplaced) keeps its cfi and stored fraction; both surfaces read it by
   fraction, since the pins differ. Only `epubVersion` changes, so a position keeps
   `positionRecord`'s shape and its `updatedAt`, a ribbon `ribbonRecord`'s. These writes get the
   same backup, `if-match` and re-read as the rest.
   The fraction is shifted by the mapping's own delta, clamped to 0–1. A ribbon that changes
   chapter takes the new contents label. Every record is backed up before writing. Each write is
   a PUT with `if-match` on the record's ETag, so a reader's save in between wins and is
   reported. Every written record is re-read and compared.
4. Run `carry-over.mjs --apply` again later. It leaves what it carried and picks up anything a
   session still holding the old file saved since. It also tries again every record the last
   run pinned old (unplaced), now as a pinned-old record: one whose cfi maps is carried, one
   that still can't be placed stays as it is. Delete the private copies once the swap is
   verified.

`/admin/bookstore` can also replace a master, but it does none of this. It overwrites the
object with no precondition and re-merges the whole form into the title record. It doesn't
touch the sample, the cover (unless new files are chosen), or any reader data, and it computes
nothing from the EPUB.
