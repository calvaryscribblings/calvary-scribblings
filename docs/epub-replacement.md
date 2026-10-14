# Replacing a live book's EPUB

A saved reading position is a CFI: coordinates into one file's bytes, pinned to the Storage
generation of `master.epub` ([reading-position-pin.md](./reading-position-pin.md)). Upload any
new file and the generation changes, so every saved position falls back to its `fraction`. Ribbons
(`readerBookmarks`) carry no pin at all. Their CFI is used as-is against the new bytes.

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

## On the day

1. `verify.mjs` and `open-in-foliate.mjs` both clean, and `map-positions.mjs --title` shows no
   misses.
2. Upload with `ifGenerationMatch` set to the generation recorded when the original was
   downloaded, so a live file that changed since then refuses the upload.
   `scripts/bookstore/author-copy.mjs` shows the firebase-admin form.
3. Re-pin kept records and write mapped ones. Back up first, and make each write conditional
   on the record being unchanged, so a reader's live save wins. Run it again later for any
   session that had the book open during the swap.
4. Re-read every record touched and compare. Delete the private copies once the swap is
   verified.

`/admin/bookstore` can also replace a master, but it does none of this. It overwrites the
object with no precondition and re-merges the whole form into the title record. It doesn't
touch the sample, the cover (unless new files are chosen), or any reader data, and it computes
nothing from the EPUB.
