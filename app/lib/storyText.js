// WHERE A STORY'S TEXT LIVES — PROOFS-R1, ruling 255 (Ikenna, 31 Oct 2026).
//
//   "A scheduled story's text stays out of the public part of the database until it goes live,
//    so nobody can read it early except its writer, through Proofs."
//
// A story's text is two fields, `content` and `extractedText` (the EPUB's plain text; the second
// copy of the body, so it always travels with the first). Since phase T1 both live at
// story_bodies/<slug>, which only founders can read. cms_stories/<slug> is `.read: true`, and
// every app runtime reads a LIVE story's text from cms_stories/<slug>/content (A50), so:
//
//   LIVE (isReadableStory)   the text is in BOTH places, identical.
//   NOT LIVE                 the text is in story_bodies ONLY. cms_stories carries neither field.
//
// "Not live" is scheduled, held for a cover, hidden, retired and draft alike: the record says
// published:false. There is one test, isReadableStory, the same one /api/story answers 404 on and
// the static export builds pages by.
//
// ── THE RULE IS ONE FUNCTION, placementPaths ────────────────────────────────────────────────
// Every writer and every flip goes through it, in the SAME multi-path update as the change of
// state, so there is no instant at which a live story has no public text or a story that isn't
// live has some. The callers:
//
//   app/admin/page.js            the CMS save (recordSavePaths), Hide, Unhide
//   app/admin/extract-text/      the extraction run
//   scripts/covers/store.mjs     the reconciler's release of a held story (coverFlipPaths)
//   scripts/stories/retire.mjs   retirement
//   workers-external/calvary-newsletter.worker.js
//                                the scheduled flip. The Worker cannot import this file, so it
//                                holds a hand copy (goLiveBodyPathsMirror); tests/rules/
//                                proofs-r1.test.mjs runs the real Worker against the emulator.
//
// Taking text OUT also writes it INTO story_bodies, from the copy being removed when story_bodies
// has none (bodyOf). So a story is never left with its text in neither place, whatever state the
// two nodes were in before.
import { isReadableStory } from './storyAccess.js';

export const BODIES_PATH = 'story_bodies';
export const STORIES_PATH = 'cms_stories';
export const BODY_FIELDS = Object.freeze(['content', 'extractedText']);

const isStr = (v) => typeof v === 'string';

/**
 * The text to carry, field by field: story_bodies' copy where it has one, else the public
 * record's own (a record written before T1's backfill, or before this round's). Always strings.
 */
export function bodyOf(bodyRec, publicRec) {
  const out = {};
  for (const f of BODY_FIELDS) {
    out[f] = isStr(bodyRec?.[f]) ? bodyRec[f] : isStr(publicRec?.[f]) ? publicRec[f] : '';
  }
  return out;
}

/**
 * THE PLACEMENT. story_bodies always holds the text; cms_stories holds it only when `live`.
 * Deep paths only, so it merges into any update that writes other fields of the same record.
 */
export function placementPaths(slug, body, live) {
  const out = {};
  for (const f of BODY_FIELDS) {
    const v = isStr(body?.[f]) ? body[f] : '';
    out[`${BODIES_PATH}/${slug}/${f}`] = v;
    out[`${STORIES_PATH}/${slug}/${f}`] = live ? v : null;
  }
  return out;
}

/**
 * The CMS save: one path per field the form owns, except the text, which is placed by the
 * record's NEXT state. `fields` is the editor's storyData, which always carries `published`.
 */
export function recordSavePaths(slug, fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (!BODY_FIELDS.includes(k)) out[`${STORIES_PATH}/${slug}/${k}`] = v;
  }
  return { ...out, ...placementPaths(slug, fields, isReadableStory(fields)) };
}

/**
 * The extraction run (app/admin/extract-text): extractedText alone, to story_bodies always and to
 * the public record only while the story is live. A story that isn't live gets an explicit null
 * there, so a stale public copy from before this round can't outlive a fresh extraction.
 */
export function extractTextPaths(slug, text, live) {
  return {
    [`${BODIES_PATH}/${slug}/extractedText`]: text,
    [`${STORIES_PATH}/${slug}/extractedText`]: live ? text : null,
  };
}
