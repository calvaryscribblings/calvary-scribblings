# §6h — the cross-surface CFI exchange

Two surfaces read the same book. A position taken on one must mean the same place on the
other, or "continue reading" is a lie told by whichever device you picked up second. This is
the web half of the protocol that proves it.

## a. How the fixture is delivered — **generated from source, not committed**

> **This reverses an earlier answer in this document, and the reason is worth keeping.** The
> first call was "a committed test asset", on the reasoning that *a fixture you have to obtain
> is a fixture the test skips*. That was correct for a **delivered binary**. The app then sent
> its **generator** instead, which removes the premise entirely: nothing has to be obtained, so
> nothing skips — and a binary in git is a fixture nobody can review. The input changed, so the
> answer did.

The app sends `make-epub.mjs` and `zip.mjs`. They live at `tests/fixtures/cross-surface/`,
are committed (they are source, and reviewable in a diff), and the spec **runs them on every
test run** and matches the app's published digest.

Byte-identity is therefore **derived, not transferred**. A copied binary can only be checked
against a number somebody sent; a generated one is reproduced from the source that defines
it, in this environment, on this run. Verified here 2026-08-10 on Node 24 — the generator is
deterministic across both environments.

### ⚠ The same bytes travel under more than one name

Do not go hunting for a file that does not exist under the name you were given.

| where | path | committed? |
|---|---|---|
| web (here) | `tests/fixtures/cross-surface/build/fixture.epub` | no — gitignored, generated |
| app | `assets/reader/sample.epub` | yes — Metro must bundle it into the binary |
| app build output | `harness/reader/fixture/build/fixture.epub` | no |

The generator emits **`fixture.epub`**; the app ships it as **`sample.epub`**. All three are
byte-identical to `cb344c79f7e2abf2d9a6e872a31d81eebdef1c5c0b78518c1a2d5540e2fcbfff`
(54,981 bytes), or something is wrong. This table is also in `fixture-pin.json`, next to the
digest, because that is where someone will actually be looking.

**To run it:** `npx playwright test -c tests/reader/playwright.config.mjs cross-surface-cfi`.
There is no fetch step and nothing to place by hand.

## b. The digest gate

Runs in `beforeAll`, so it covers *every* test in the file rather than only the digest test:
no CFI is emitted or sought against a book whose bytes have not been re-derived on this run.

| state | behaviour |
|---|---|
| digest matches | proceed |
| digest differs | **fail loudly**, printing both digests |
| generator missing | **skip**, naming the path — nothing to build from |

A mismatch here would be a finding about **the generator's determinism across environments**
— a Node version that orders something differently, a Buffer encoding that moved — not about
the reader. It is worth knowing before it is worth fixing. It is never fixed by re-pinning:
the pinned value is the app's published one, and a fixture that genuinely changed is a change
both surfaces adopt together, in one move, or the exchange means nothing.

(An earlier revision of this gate handled a *received* binary and had a third state —
"present but unpinned" — which was the dangerous one, because the tests would run, pass, and
prove nothing about which book they ran against. Generating removes that state: there is no
unpinned copy to be fooled by.)

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
