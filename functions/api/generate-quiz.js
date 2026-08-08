import { readStoryBody } from './_story-body.js';

const QUIZ_ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const QUIZ_TOOL = {
  name: 'generate_quiz',
  description: 'Generate a comprehension quiz for a literary story. Return the complete quiz object.',
  input_schema: {
    type: 'object',
    properties: {
      hardball: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' }, minItems: 3 },
          minMatches: { type: 'integer' },
          helperText: { type: 'string' },
        },
        required: ['question', 'keywords', 'minMatches', 'helperText'],
      },
      mcqs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            correctAnswer: {
              type: 'string',
              description: 'The correct answer as plain text. Do not prefix with a letter, number, or any positional marker.',
            },
            distractors: {
              type: 'array',
              items: { type: 'string' },
              minItems: 3,
              maxItems: 3,
              description: 'Exactly 3 plausible wrong-answer texts. Do not prefix with letters or numbers. Order does not matter — the server will combine these with correctAnswer and randomise positions.',
            },
            explanation: { type: 'string' },
          },
          required: ['question', 'correctAnswer', 'distractors', 'explanation'],
        },
      },
      essays: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            keywordPool: { type: 'array', items: { type: 'string' }, minItems: 5 },
            requiredMatches: { type: 'integer' },
          },
          required: ['question', 'keywordPool', 'requiredMatches'],
        },
      },
      mode: { type: 'string', enum: ['story', 'reader'] },
      maxPoints: { type: 'integer' },
    },
    required: ['hardball', 'mcqs', 'essays', 'mode', 'maxPoints'],
  },
};

const SYSTEM_PROMPT = `You are a quiz generator for a literary platform. When asked to generate a quiz you MUST call the generate_quiz tool with all required fields populated.

All string values must be properly escaped JSON strings. This means:
- Double quotes inside strings MUST be escaped as \\"
- Backslashes MUST be escaped as \\\\
- Newlines MUST be escaped as \\n
- Never use smart/curly quotes (“”‘’) — use straight ASCII quotes only
- Never use em dashes without spaces around them inside JSON strings`;

function quizJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Verbatim from functions/api/record-attempt.js. Exchanges a Firebase ID token
// for the uid Google says it belongs to, or null if the token is absent,
// expired, forged or malformed.
//
// WHY THIS EXISTS HERE NOW: this endpoint used to read `uid` out of the request
// BODY and check it against QUIZ_ADMIN_UIDS. The admin uids are not secret —
// they are in the client bundle, in storage.rules, and in this file's first
// line — so anyone who read them could post {"uid":"XaG6..."} and spend the
// platform's Anthropic budget generating quizzes, and write the result into
// cms_stories. The body uid is now ignored entirely; the only uid this function
// trusts is the one that comes back from Google.
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

function buildQuizPrompt(title, author, mode, storyText) {
  const maxPoints = mode === 'story' ? 50 : 100;
  return `Generate a comprehension quiz for this story using the generate_quiz tool.

Story title: ${title}
Author: ${author}
Mode: ${mode}
maxPoints: ${maxPoints}

Full text:
"""
${storyText}
"""

Counts:
- Story mode: EXACTLY 10 MCQs and 2 essays.
- Reader mode: EXACTLY 15 MCQs and 3 essays.

Rules:
- All questions in British English. Single quotes for quotations within questions, em dashes with spaces, no Oxford comma.
- For each MCQ, provide correctAnswer (the right answer as plain text) and distractors (exactly 3 plausible wrong-answer texts). Do not prefix any answer text with letters, numbers, or positional markers. Distractors must not be obviously wrong — they should reflect common misreadings or surface-level interpretations.
- Spread MCQ difficulty: roughly one third easy (literal recall), one third medium (inference), one third hard (theme/symbolism).
- Essay keywords should be lowercase. Avoid trivially common words ("the", "and", "story", "character"). Pick words that genuinely signal someone engaged with the text.
- HARDBALL question must be ungeneralisable — a question that has only one right framing because of a specific detail in this story. It must reference a specific moment, image, or detail that someone who only skimmed a summary or used AI to generate an answer would miss.
- The hardball helperText is an optional one-sentence hint; use an empty string if not needed.
- Hardball keywords: 3–5 specific words/phrases a genuine reader would naturally include in their answer.`;
}

// Position determined server-side to eliminate model position bias.
// Do not move position logic into the prompt or the tool schema —
// the model returns correctAnswer (text) + distractors (3 texts) and
// has no concept of option positions. This function combines them,
// shuffles, and computes the index that the rest of the pipeline expects.
function fisherYates(arr) {
  const a = [...arr];
  const useCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
  for (let i = a.length - 1; i > 0; i--) {
    let j;
    if (useCrypto) {
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      j = r[0] % (i + 1);
    } else {
      j = Math.floor(Math.random() * (i + 1));
    }
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleMcqs(mcqs) {
  if (!Array.isArray(mcqs)) return mcqs;
  return mcqs.map(mcq => {
    const correctText = mcq.correctAnswer;
    const distractors = Array.isArray(mcq.distractors) ? mcq.distractors : [];
    const pool = [correctText, ...distractors];
    const options = fisherYates(pool);
    return {
      question: mcq.question,
      options,
      correctAnswer: options.indexOf(correctText),
      explanation: mcq.explanation,
    };
  });
}

// Last-resort repair for common JSON corruption before falling back to an error.
function repairJson(text) {
  // Strip markdown fences (defensive — should already be stripped elsewhere)
  let s = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // Convert smart/curly quotes to ASCII
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');

  return s;
}

function validateQuiz(quiz, mode) {
  const warnings = [];
  const mcqCount = mode === 'story' ? 10 : 15;
  const essayCount = mode === 'story' ? 2 : 3;
  if (!quiz.hardball?.question) warnings.push('Missing hardball question.');
  if (!Array.isArray(quiz.hardball?.keywords) || quiz.hardball.keywords.length < 3)
    warnings.push('Hardball should have at least 3 keywords.');
  if (!Array.isArray(quiz.mcqs) || quiz.mcqs.length !== mcqCount)
    warnings.push(`Expected ${mcqCount} MCQs, got ${quiz.mcqs?.length ?? 0}.`);
  if (!Array.isArray(quiz.essays) || quiz.essays.length !== essayCount)
    warnings.push(`Expected ${essayCount} essays, got ${quiz.essays?.length ?? 0}.`);
  (quiz.mcqs || []).forEach((mcq, i) => {
    if (!Array.isArray(mcq.options) || mcq.options.length !== 4)
      warnings.push(`MCQ ${i + 1}: expected 4 options.`);
    if (typeof mcq.correctAnswer !== 'number' || mcq.correctAnswer < 0 || mcq.correctAnswer > 3)
      warnings.push(`MCQ ${i + 1}: invalid correctAnswer.`);
  });
  (quiz.essays || []).forEach((essay, i) => {
    if (!Array.isArray(essay.keywordPool) || essay.keywordPool.length < 5)
      warnings.push(`Essay ${i + 1}: keywordPool should have at least 5 items.`);
  });
  return warnings;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Authenticate BEFORE reading the body, so a forged uid never even reaches a
  // variable. Same order as record-attempt.js.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return quizJson({ error: 'Unauthorised.' }, 401);

  const uid = await verifyToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return quizJson({ error: 'Unauthorised.' }, 401);
  if (!QUIZ_ADMIN_UIDS.includes(uid)) return quizJson({ error: 'Unauthorised.' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return quizJson({ error: 'Invalid request body.' }, 400); }

  // `uid` is deliberately NOT destructured from the body. If a client still
  // sends one it is inert — the uid above came from the verified token.
  const { slug, mode } = body;
  console.log('[generate-quiz] slug:', slug, '| mode:', mode, '| uid:', uid, '(verified)');
  console.log('[generate-quiz] ANTHROPIC_API_KEY set:', !!env.ANTHROPIC_API_KEY);

  if (!slug || !['story', 'reader'].includes(mode))
    return quizJson({ error: 'slug and mode are required.' }, 400);

  let story;
  try {
    const fbUrl = `${FB_DB}/cms_stories/${encodeURIComponent(slug)}.json`;
    console.log('[generate-quiz] fetching:', fbUrl);
    const fbRes = await fetch(fbUrl);
    const fbText = await fbRes.text();
    console.log('[generate-quiz] Firebase status:', fbRes.status, '| body start:', fbText.slice(0, 200));
    if (!fbRes.ok) throw new Error(`Firebase ${fbRes.status}: ${fbText}`);
    story = JSON.parse(fbText);
  } catch (e) {
    console.error('[generate-quiz] Firebase error:', e.message);
    return quizJson({ error: `Failed to fetch story: ${e.message}` }, 500);
  }

  if (!story) return quizJson({ error: 'Story not found in CMS.' }, 404);

  // ── THE BODY IS NO LONGER ON THE PUBLIC RECORD ─────────────────────────────
  // Phase T1: content/extractedText live at story_bodies/<slug>, which is
  // `.read: false`. The fetch above still reads cms_stories because TITLE and AUTHOR
  // are public metadata and stay there; only the body needs a credential.
  //
  // NOT a second gate — see functions/api/_story-body.js. No tier, no window.
  let storyBody;
  try {
    storyBody = await readStoryBody(env, slug);
  } catch (e) {
    console.error('[generate-quiz] story body read failed:', e.message);
    return quizJson({ error: 'Could not read the story just now. Please try again.' }, 502);
  }

  let storyText;
  if (mode === 'reader') {
    storyText = (storyBody.extractedText || '').trim();
    console.log('[generate-quiz] reader-mode extractedText length:', storyText.length);
    if (storyText.length < 500) {
      return quizJson({
        error: 'Reader story has no extracted text. Run extraction from /admin/extract-text first.',
      }, 400);
    }
  } else {
    storyText = stripHtml(storyBody.content || '');
    console.log('[generate-quiz] story-mode storyText length:', storyText.length);
    if (!storyText) return quizJson({ error: 'Story has no content to generate from.' }, 400);
  }

  const prompt = buildQuizPrompt(story.title || slug, story.author || 'Unknown', mode, storyText);
  console.log('[generate-quiz] prompt length:', prompt.length, '| calling Anthropic...');

  let rawText, quiz;
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
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: [QUIZ_TOOL],
        tool_choice: { type: 'tool', name: 'generate_quiz' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    console.log('[generate-quiz] Anthropic status:', aRes.status);
    const aText = await aRes.text();
    if (!aRes.ok) {
      console.error('[generate-quiz] Anthropic error:', aText);
      throw new Error(`Anthropic API error ${aRes.status}: ${aText}`);
    }

    const aData = JSON.parse(aText);
    const toolBlock = aData.content?.find(b => b.type === 'tool_use' && b.name === 'generate_quiz');

    if (toolBlock) {
      // tool_use input is already a parsed JS object — no JSON.parse needed
      console.log('[generate-quiz] received tool_use response (pre-parsed JSON)');
      quiz = toolBlock.input;
    } else {
      // Unexpected: Claude responded with text instead of tool call
      const textBlock = aData.content?.find(b => b.type === 'text');
      rawText = textBlock?.text ?? '';
      console.warn('[generate-quiz] no tool_use block; falling back to text parse. stop_reason:', aData.stop_reason);
      if (!rawText) throw new Error('Empty response from Claude.');

      const cleaned = repairJson(rawText);
      try {
        quiz = JSON.parse(cleaned);
      } catch (parseErr) {
        const head = cleaned.slice(0, 500);
        const tail = cleaned.length > 500 ? cleaned.slice(-500) : '';
        console.error('[generate-quiz] JSON parse failed.');
        console.error('[generate-quiz] raw head (500):', head);
        if (tail) console.error('[generate-quiz] raw tail (500):', tail);
        return quizJson({
          error: `Claude returned invalid JSON: ${parseErr.message}`,
          rawHead: head,
          rawTail: tail || undefined,
        }, 500);
      }
    }
  } catch (e) {
    console.error('[generate-quiz] Anthropic threw:', e.message);
    return quizJson({ error: e.message }, 500);
  }

  // Transform model output into stored shape: shuffle options server-side
  // and compute the correctAnswer index. The model never picks positions.
  quiz.mcqs = shuffleMcqs(quiz.mcqs);

  const warnings = validateQuiz(quiz, mode);
  quiz.generatedAt = Date.now();
  quiz.model = 'claude-sonnet-4-6';
  console.log('[generate-quiz] success, warnings:', warnings.length);
  return quizJson({ quiz, warnings });
}
