const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

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

const SYSTEM_PROMPT = `You are a close-reading evaluator for a literary platform.
You assess whether a reader's answer demonstrates genuine engagement with a specific story.
Be strict about evidence of close reading — a correct general answer about themes is not enough without grounding in the text.
Be forgiving of synonyms, paraphrases, and imperfect phrasing — reward understanding over word-for-word recall.
A genuine reader who close-read the story should pass. Someone who skimmed or used a summary should not.`;

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

  let body;
  try { body = await request.json(); }
  catch { return evalJson({ error: 'Invalid request body.' }, 400); }

  const { slug, type } = body;
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

  const storyText = stripHtml(story.content || '');
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
        system: SYSTEM_PROMPT,
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
