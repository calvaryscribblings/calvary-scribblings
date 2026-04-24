import { NextResponse } from 'next/server';

const ADMIN_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

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

function buildPrompt(title, author, mode, storyText) {
  const maxPoints = mode === 'story' ? 50 : 100;
  return `You are creating a comprehension quiz for a literary platform called Calvary Scribblings.

Story title: ${title}
Author: ${author}
Mode: ${mode}

Full text:
"""
${storyText}
"""

Generate a quiz in valid JSON matching this exact structure:

{
  "hardball": {
    "question": "An open-ended question that tests genuine close reading. The question should reference a specific moment, image, or detail from the story that someone who only skimmed a summary or used AI to generate an answer would miss. Avoid generic literary questions.",
    "keywords": ["3-5 specific words or phrases that a genuine reader would naturally include in their answer"],
    "minMatches": 2,
    "helperText": "Optional one-sentence hint, or empty string"
  },
  "mcqs": [
    {
      "question": "A clear question testing comprehension, theme recognition, character motivation, or close reading.",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "One sentence on why the correct answer is right."
    }
  ],
  "essays": [
    {
      "question": "An open-ended question inviting reflection on theme, character, or craft.",
      "keywordPool": ["8 thematically appropriate words/phrases that signal genuine engagement"],
      "requiredMatches": 5
    }
  ],
  "mode": "${mode}",
  "maxPoints": ${maxPoints}
}

Counts:
- Story mode: EXACTLY 15 MCQs and 3 essays. maxPoints 50.
- Reader mode: EXACTLY 25 MCQs and 5 essays. maxPoints 100.

Rules:
- All questions in British English. Single quotes, em dashes with spaces, no Oxford comma.
- MCQ wrong answers (distractors) must be plausible — not obviously wrong. They should reflect common misreadings or surface-level interpretations.
- Spread MCQ difficulty: roughly one third easy (literal recall), one third medium (inference), one third hard (theme/symbolism).
- Essay keywords should be lowercase. Avoid trivially common words ("the", "and", "story", "character"). Pick words that genuinely signal someone engaged with the text.
- HARDBALL question is the most important. It must be ungeneralisable — a question that has only one right framing because of a specific detail in this story.

Return ONLY the JSON. No preamble, no commentary, no markdown fences.`;
}

function validateQuiz(quiz, mode) {
  const warnings = [];
  const mcqCount = mode === 'story' ? 15 : 25;
  const essayCount = mode === 'story' ? 3 : 5;

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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { slug, mode, uid } = body;

  if (uid !== ADMIN_UID) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  if (!slug || !['story', 'reader'].includes(mode)) {
    return NextResponse.json({ error: 'slug and mode ("story" or "reader") are required.' }, { status: 400 });
  }

  let story;
  try {
    const res = await fetch(`${FB_DB}/cms_stories/${slug}.json`);
    if (!res.ok) throw new Error(`Firebase responded with ${res.status}.`);
    story = await res.json();
  } catch (e) {
    return NextResponse.json({ error: `Failed to fetch story: ${e.message}` }, { status: 500 });
  }

  if (!story) {
    return NextResponse.json({ error: 'Story not found in CMS.' }, { status: 404 });
  }

  const storyText = stripHtml(story.content || '');
  if (!storyText) {
    return NextResponse.json({ error: 'Story has no content to generate from.' }, { status: 400 });
  }

  const prompt = buildPrompt(story.title || slug, story.author || 'Unknown', mode, storyText);

  let raw;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    raw = data.content?.[0]?.text;
    if (!raw) throw new Error('Empty response from Claude.');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  let quiz;
  try {
    quiz = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: 'Claude returned invalid JSON. Try regenerating.', raw },
      { status: 500 }
    );
  }

  const warnings = validateQuiz(quiz, mode);
  quiz.generatedAt = Date.now();
  quiz.model = 'claude-sonnet-4-6';

  return NextResponse.json({ quiz, warnings });
}
