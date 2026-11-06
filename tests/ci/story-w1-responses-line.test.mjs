// STORY-W1 — the words of the responses line (rulings 315 and 316). The page's behaviour
// (where it sits, what a tap does) is measured in a browser by tests/stories/; this pins the words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { responsesLineText } from '../../app/lib/responsesLine.js';

test('none: the invitation (316)', () => {
  assert.equal(responsesLineText(0), 'Be the first to respond');
  assert.equal(responsesLineText(undefined), 'Be the first to respond');
  assert.equal(responsesLineText(-1), 'Be the first to respond');
});
test('one: singular (315)', () => assert.equal(responsesLineText(1), '1 response'));
test('more: plural (315)', () => {
  assert.equal(responsesLineText(2), '2 responses');
  assert.equal(responsesLineText(117), '117 responses');
});
test('the story page renders the line from this module, under the byline, and not in a proof', () => {
  const src = readFileSync(new URL('../../app/stories/[slug]/page-client.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ responsesLineText \} from '\.\.\/\.\.\/lib\/responsesLine'/);
  const clip = src.indexOf('<div className="story-byline-clip">');
  const line = src.indexOf('<div className="story-responses-line">');
  assert.ok(clip > 0 && line > clip, 'the line comes after the byline');
  assert.match(src.slice(line - 40, line), /\{!proof && \(/, 'a proof has no responses, so no line');
});
