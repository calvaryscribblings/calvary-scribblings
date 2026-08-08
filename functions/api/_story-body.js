// Credentialed read of a story's body. Shared by the two quiz endpoints.
//
// Underscore-prefixed so Pages does not route it as an endpoint — the same
// convention as functions/api/bookstore/_lib.js.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
//
// generate-quiz.js and evaluate-quiz.js both used to read the body with a bare,
// UNAUTHENTICATED `fetch(FB_DB/cms_stories/<slug>.json)`, relying on that node being
// world-readable. Since phase T1 the body also lives at story_bodies/<slug>, which is
// `.read: false` — so the quiz endpoints have to present a credential like everything
// else that touches it.
//
// They move in the SAME phase as the endpoint, not after it. The whole point of the
// phase is to close a public read; leaving two callers on the public copy would mean
// the node cannot be cut at T3 without breaking quizzes, which is how a migration
// acquires a permanent exception.
//
// ── WHAT IS AND IS NOT GATED HERE ────────────────────────────────────────────────
//
// A quiz is about a story the reader has, by definition, just read. THIS IS NOT A
// SECOND GATE and it must not become one: it takes no tier, checks no window, and
// asks nothing about entitlement. The change is about closing a public read, and a
// quiz that refused a reader who had legitimately read the story inside the free
// window would be a bug, not a policy.
//
// Story METADATA — title, author — stays on cms_stories and stays public. Only the
// body moved, so only the body needs a token.

import { dbBase, mintAccessToken, SCOPES, FIREBASE_TIMEOUT_MS } from './bookstore/_lib.js';

const BODIES_PATH = 'story_bodies';

/**
 * `{ content, extractedText }` for a slug, read with an admin token.
 *
 * THROWS on a missing credential, a mint failure or a failed read. Callers turn that
 * into their own error shape — both quiz endpoints already have one, and inventing a
 * third here would leave them reporting failures two different ways.
 *
 * Returns empty strings rather than undefined for a story with no body, so callers
 * can keep their existing `(story.content || '')` idiom without a null check.
 */
export async function readStoryBody(env, slug) {
  if (!env?.FIREBASE_CLIENT_EMAIL || !env?.FIREBASE_PRIVATE_KEY) {
    throw new Error('story body read is not configured (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)');
  }

  const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES);

  const res = await fetch(`${dbBase(env)}/${BODIES_PATH}/${encodeURIComponent(slug)}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`story_bodies GET failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

  const rec = await res.json();
  return {
    content: typeof rec?.content === 'string' ? rec.content : '',
    extractedText: typeof rec?.extractedText === 'string' ? rec.extractedText : '',
  };
}
