# §6h — the cross-surface CFI exchange

Two surfaces read the same book. A position taken on one must mean the same place on the
other, or "continue reading" is a lie told by whichever device you picked up second. This is
the web half of the protocol that proves it.

## a. How the fixture is delivered — **a committed test asset**

`tests/fixtures/cross-surface/sample.epub`, committed, with its digest pinned in
`tests/reader/cross-surface/fixture-pin.json`.

Not a dev route, and not a local load, for one reason each:

- **A dev route** makes the book a thing the test *fetches*. Then the test depends on a
  server being up and serving the version it expects, and the first time that drifts the
  failure reads as a CFI bug. The bytes must be under the same review as the code that
  asserts on them.
- **A local load** (each developer drops the file in) is the state this repo already knows is
  unreliable: `live-cfi.spec.mjs` skips whenever its licensed master is absent, which is
  correct there because the book *cannot* be committed. This one can, so it should be — a
  fixture you have to obtain is a fixture the test skips, and a test that skips is a test
  that is not run.

The repo already commits `tests/fixtures/*.epub` for exactly this purpose, so this is the
existing pattern rather than a new one. It is small, it is synthetic, and committing it gets
byte-pinning from git for free — the digest assertion below is the belt to that braces.

**When the file arrives:**

1. Put it at `tests/fixtures/cross-surface/sample.epub`.
2. Put the app's published digest — *theirs, not one you computed* — into `fixture-pin.json`.
3. `npx playwright test -c tests/reader/playwright.config.mjs cross-surface-cfi`

Step 2 is the one that matters. If you paste in whatever `sha256sum` says about the file on
your disk, the pin certifies the copy against itself and proves nothing.

## b. The digest gate

In place before a single CFI is emitted, with three states that behave differently:

| state | behaviour |
|---|---|
| fixture absent, digest not pinned | **skip** — nothing delivered yet; the suite stays runnable by anyone |
| fixture present, digest not pinned | **fail** — the file arrived and nobody pinned it |
| digest mismatch | **fail loudly**, printing both digests |

The middle row is the dangerous one and the reason the gate is not a simple `existsSync`
check: the tests would otherwise run, pass, and prove nothing about *which book* they ran
against. Both failure paths were verified by making them happen, not by reading the code.

A mismatch is never fixed by re-pinning. Either the copy is corrupt, or the fixture was
revised — and a revised fixture is a change both surfaces adopt together, in one move, or the
exchange means nothing.

## c. What is compared — **not the CFI string, and not the page**

Nothing here compares CFI strings. Two CFIs can differ as strings and resolve to the same
place: range form versus point form, an ID assertion present or absent, an offset normalised
into the next text node. Comparing strings produces false failures, and false failures teach
people to ignore the test.

**And not the page either.** The obvious comparison — seek the CFI, report the text of the
resulting page — is wrong in the same direction and is easier to miss. A page is a *viewport
artefact*: the app is a phone at 400 CSS px, this surface is whatever window, type size,
leading and column count the reader chose. The same CFI resolves to the same character on
both surfaces and still yields completely different page text, because the two paginated the
section differently. That comparison would report a mismatch on a book both surfaces are
reading correctly.

So each record carries what the CFI **resolves to in the document**:

```json
{ "key": "…", "cfi": "epubcfi(…)", "sectionIndex": 2, "resolvedText": "…60 chars…" }
```

`sectionIndex` must match exactly. `resolvedText` is read forward through the section's text
nodes from the resolved range's start — document order, whitespace-normalised, viewport
irrelevant. One side's text may be a prefix of the other's (a range that stops at a node
boundary captures less), and that is accepted: it is a difference in how much was captured,
not in where it started. Case and punctuation are never normalised — a CFI that lands on a
different word must not be able to pass by looking similar.

## The four positions

| key | what it is for |
|---|---|
| `mid-section-1` | an ordinary interior position — the case that must simply work |
| `last-page-section-2` | the far edge of a section: the offset most likely to normalise differently |
| `first-page-section-3` | **the boundary** — the position either surface is most likely to attribute to the *previous* section |
| `inside-degenerate-section-3` | inside the one-screen section, whose first and last page are the same page, so a surface deriving position from pagination has nowhere to hide |

`first-page-section-3` is deliberately *not* offset 0 of the first text node: that is a
position both surfaces agree on trivially, which would let the boundary case pass without
testing anything.

## Both directions, and they are separate results

- **web → app**: we emit `docs/cfi-web-list.json`; the app seeks each and reports its landing.
- **app → web**: they emit `docs/cfi-app-list.json`; we seek each and report ours.

These are two tests, not one, because web→app passing while app→web fails is a real outcome
and a one-directional test would call it green.

Before anything is sent, each CFI we emit is **round-tripped on our own surface** — emitted,
then sought, then checked to land where it was emitted. A CFI this surface cannot reproduce
for itself is not worth sending: the failure would surface against the app.

Emission uses `view.getCFI(index, range)` and resolution uses `view.resolveCFI(cfi)` —
foliate's own calls, the same ones the reader uses for a bookmark. A test-only CFI path could
be correct while the production one is not.

## The property that makes any of this possible

Search highlighting goes through `Overlayer`, which owns its own `<svg>` and never touches the
content document. A CFI is a path through the document tree plus a character offset into a
text node, so it is only stable while the tree and the text nodes are. Replace `Overlayer`
with anything that wraps matches in `<mark>` and every CFI after the first hit silently
resolves somewhere else — including ones already stored in `readerBookmarks`.

That warning lives at the `case 'search':` handler in `public/reading-room.html`, where a
search change will actually meet it.
