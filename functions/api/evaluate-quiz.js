import { readStoryBody } from './_story-body.js';
import { consume, limitResponse, capFromEnv } from './_ratelimit.js';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// ═══════════════════════════════════════════════════════════════════════════════════════
// THE CAPS, AND WHERE THE NUMBERS CAME FROM
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// This endpoint turns a signed-in reader's request into a paid Anthropic call. Before the
// Fortress Audit there was NO ceiling of any kind: `attemptIndex` arrives in the request
// body and only selects which system prompt to use, so one account in a loop was an
// unbounded bill. These caps close that.
//
// ── THE DERIVATION ─────────────────────────────────────────────────────────────────────
//
// Measured against the live database on 23 Aug 2026 — 1,398 submissions by 78 readers
// across 84 days, against the 160 quizzes that exist:
//
//   submissions per reader per day    median 3 · p90 11 · p99 32 · MAX EVER 46
//   submissions per day, platform     median 7 · MAX EVER 119
//   attempts per quiz                 1,248 first attempts, 144 second — never a third
//
// A submission costs at most TWO calls here: one `hardball`, one `essays` batch. So the
// busiest reader-day ever recorded is 46 × 2 = 92 calls, and the busiest platform-day ever
// is 119 × 2 = 238 calls.
//
//   PER READER, PER DAY — 200
//     2.2× the busiest reader-day ever recorded. Also below the ceiling the catalogue
//     itself imposes: 160 quizzes × 2 attempts × 2 calls = 640 calls is the most a reader
//     could EVER generate, and nobody has come within a quarter of that in a day.
//
//   PER READER, PER MINUTE — 12
//     Six submissions a minute. A submission means reading a story and writing essay
//     answers; the busiest reader-day on record averages one submission every thirty
//     minutes. This is an order of magnitude above human pace and it stops a tight loop
//     within seconds rather than within a day.
//
//   PLATFORM, PER DAY — 1,000
//     4.2× the busiest platform-day ever recorded. This is the circuit breaker, not the
//     working limit: at roughly $0.015–0.02 a call (claude-sonnet-4-6 at $3/$15 per Mtok,
//     ~3k input tokens for a median story plus up to 1,024 output), it bounds this
//     endpoint at about $15–20 on its very worst day, against no bound at all before.
//
// ⚠ A LEGITIMATE READER MUST NEVER HIT THE WALL. That is the property these numbers are
// chosen for, and it is why every one of them is a MULTIPLE of the observed maximum rather
// than a percentage above the average. If the library grows past 160 quizzes, or a reading
// contest changes what "busy" means, raise them by env rather than removing them — see
// capFromEnv(), which cannot be set to zero or disabled.
export const EVAL_CAPS = (env, uid) => ([
  { scope: 'evalq', period: 'minute', id: uid, limit: capFromEnv(env, 'QUIZ_EVAL_MINUTE_CAP', 12) },
  { scope: 'evalq', period: 'day', id: uid, limit: capFromEnv(env, 'QUIZ_EVAL_DAY_CAP', 200) },
  { scope: 'evalq', period: 'day', limit: capFromEnv(env, 'QUIZ_EVAL_GLOBAL_DAY_CAP', 1000) },
]);

function evalJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function verifyToken(token, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.localId ?? null;
}

const EVAL_TOOL = {
  name: 'evaluate_answers',
  description: 'Evaluate reader answers against a literary story.',
  input_schema: {
    type: 'object',
    properties: {
      hardball: {
        type: 'object',
        properties: {
          passed: { type: 'boolean' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasoning: { type: 'string' },
        },
        required: ['passed', 'confidence', 'reasoning'],
      },
      essays: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 1 },
            reasoning: { type: 'string' },
            strengths: { type: 'string' },
            gaps: { type: 'string' },
          },
          required: ['score', 'reasoning', 'strengths', 'gaps'],
        },
      },
    },
  },
};

const SYSTEM_PROMPT_STRICT = `You are a close-reading evaluator for a literary platform.
You assess whether a reader's answer demonstrates genuine engagement with a specific story.
Be strict about evidence of close reading — a correct general answer about themes is not enough without grounding in the text.
Be forgiving of synonyms, paraphrases, and imperfect phrasing — reward understanding over word-for-word recall.
A genuine reader who close-read the story should pass. Someone who skimmed or used a summary should not.`;

const SYSTEM_PROMPT_SOFT = `You are a close-reading evaluator for a literary platform. The reader has already failed one attempt at this question and is now on their second and final try.

Lower the bar slightly. Accept answers that demonstrate engagement with the specific story even when phrased thematically — as long as the reader anchors their answer to the text.

An anchored answer references a specific moment, scene, character action, object, image, line of dialogue, or detail from the story. The reader doesn't need to quote the exact words. They can paraphrase or interpret, as long as you can tell they're pointing at something in the text rather than speaking abstractly.

Pass: anchored thematic readings, paraphrases of specific moments, accurate interpretations grounded in the story.

Fail: answers that stay purely abstract or generic — readings that could apply to any story with similar themes, with no anchor in this specific text. Also fail answers that contradict the story's content.

Be more generous than you would be on a first attempt, but don't pass empty close reading.`;

function buildHardballPrompt(title, author, storyText, hardball, answer) {
  return `Story: "${title}" by ${author}

Full text:
"""
${storyText}
"""

Comprehension check question:
"${hardball.question}"

Concept hints (specific details or phrasings the quiz creator expected):
${hardball.keywords.join(', ')}

Reader's answer:
"${answer}"

Evaluate whether this answer demonstrates that the reader close-read the story. Call the evaluate_answers tool with a hardball result only.`;
}

function buildEssaysPrompt(title, author, storyText, essays, answers) {
  const blocks = essays.map((essay, i) => `Essay ${i + 1}:
Question: "${essay.question}"
Thematic keywords: ${essay.keywordPool.join(', ')}
Reader's answer: "${answers[i] || ''}"
`).join('\n');

  return `Story: "${title}" by ${author}

Full text:
"""
${storyText}
"""

${blocks}
Evaluate each essay answer for genuine engagement with the story. Call the evaluate_answers tool with an essays array.`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return evalJson({ error: 'Unauthorised.' }, 401);

  const uid = await verifyToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return evalJson({ error: 'Unauthorised.' }, 401);

  // THE CEILING, charged before any work is done — before the story is read and long
  // before Anthropic is called. A refused caller costs one database increment and nothing
  // else. See EVAL_CAPS above for where the numbers come from; consume() fails closed, so
  // a limiter that cannot reach its counter store refuses rather than waving the call
  // through. There is deliberately no `catch` around this: consume() never throws, and a
  // try/catch here is exactly how a fail-closed limiter becomes a fail-open one.
  const verdict = await consume(context, EVAL_CAPS(env, uid));
  if (!verdict.ok) {
    console.warn('[evaluate-quiz] refused | uid:', uid, '|', verdict.reason, verdict.scope ?? '');
    return limitResponse(verdict);
  }

  let body;
  try { body = await request.json(); }
  catch { return evalJson({ error: 'Invalid request body.' }, 400); }

  const { slug, type, attemptIndex } = body;
  console.log('[evaluate-quiz] uid:', uid, '| slug:', slug, '| type:', type);

  if (!slug || !['hardball', 'essays'].includes(type))
    return evalJson({ error: 'slug and type are required.' }, 400);

  let story;
  try {
    const fbRes = await fetch(`${FB_DB}/cms_stories/${encodeURIComponent(slug)}.json`);
    if (!fbRes.ok) throw new Error(`Firebase ${fbRes.status}`);
    story = await fbRes.json();
  } catch (e) {
    console.error('[evaluate-quiz] Firebase error:', e.message);
    return evalJson({ error: `Failed to fetch story: ${e.message}` }, 500);
  }
  if (!story) return evalJson({ error: 'Story not found.' }, 404);

  // Phase T1: the body moved to story_bodies/<slug> (`.read: false`). The fetch above
  // still reads cms_stories for TITLE and AUTHOR, which are public metadata and stay
  // there. Only the body needs a credential, and this is NOT a second gate — no tier,
  // no window. See functions/api/_story-body.js.
  let storyBody;
  try {
    storyBody = await readStoryBody(env, slug);
  } catch (e) {
    console.error('[evaluate-quiz] story body read failed:', e.message);
    return evalJson({ error: 'Could not read the story just now. Please try again.' }, 502);
  }

  const storyText = stripHtml(storyBody.content || '');
  if (!storyText) return evalJson({ error: 'Story has no content.' }, 400);

  const title = story.title || slug;
  const author = story.author || 'Unknown';

  let prompt;
  if (type === 'hardball') {
    const { hardball, answer } = body;
    if (!hardball?.question || !Array.isArray(hardball.keywords) || typeof answer !== 'string')
      return evalJson({ error: 'hardball (question, keywords) and answer are required.' }, 400);
    prompt = buildHardballPrompt(title, author, storyText, hardball, answer);
  } else {
    const { essays, answers } = body;
    if (!Array.isArray(essays) || !Array.isArray(answers))
      return evalJson({ error: 'essays and answers arrays are required.' }, 400);
    prompt = buildEssaysPrompt(title, author, storyText, essays, answers);
  }

  console.log('[evaluate-quiz] prompt length:', prompt.length, '| calling Claude...');

  let evalResult;
  try {
    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: (typeof attemptIndex === 'number' && attemptIndex >= 1) ? SYSTEM_PROMPT_SOFT : SYSTEM_PROMPT_STRICT,
        tools: [EVAL_TOOL],
        tool_choice: { type: 'tool', name: 'evaluate_answers' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    console.log('[evaluate-quiz] Claude status:', aRes.status);
    if (!aRes.ok) {
      const errText = await aRes.text();
      console.error('[evaluate-quiz] Claude error:', errText);
      throw new Error(`Anthropic ${aRes.status}: ${errText.slice(0, 200)}`);
    }

    const aData = await aRes.json();
    const toolBlock = aData.content?.find(b => b.type === 'tool_use' && b.name === 'evaluate_answers');
    if (!toolBlock?.input) throw new Error('No tool_use block in response.');
    evalResult = toolBlock.input;
  } catch (e) {
    console.error('[evaluate-quiz] evaluator threw:', e.message);
    return evalJson({ error: e.message, fallback: true }, 500);
  }

  if (type === 'hardball') {
    if (typeof evalResult.hardball?.passed !== 'boolean') {
      console.error('[evaluate-quiz] malformed hardball result:', JSON.stringify(evalResult).slice(0, 200));
      return evalJson({ error: 'Malformed evaluator response.', fallback: true }, 500);
    }
  } else {
    if (!Array.isArray(evalResult.essays) || evalResult.essays.some(e => typeof e.score !== 'number')) {
      console.error('[evaluate-quiz] malformed essays result:', JSON.stringify(evalResult).slice(0, 200));
      return evalJson({ error: 'Malformed evaluator response.', fallback: true }, 500);
    }
  }

  console.log(
    '[evaluate-quiz] success |', type,
    type === 'hardball' ? '| passed:' + evalResult.hardball.passed : '| essays:' + evalResult.essays.length
  );
  return evalJson({ ...evalResult, evaluatedBy: 'claude-sonnet-4-6' });
}
