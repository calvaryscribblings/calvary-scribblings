# Quiz Feature — Phase 1 Spec

## Goal

Build the admin-side flow for generating, reviewing, editing, and publishing quizzes for selected stories on Calvary Scribblings.

Quizzes are AI-generated using Claude Sonnet 4.6 via the Anthropic API, then reviewed and approved by the admin before going live to readers.

This phase covers admin only. User-facing quiz flow and cinematic animation come in phases 2 and 3.

## Stack

- Next.js 16 on Cloudflare Pages
- Firebase Realtime Database (europe-west1)
- Anthropic API (key in `ANTHROPIC_API_KEY` env variable)
- Existing admin auth at `/admin` (UID gate: `XaG6bTGqdDXh7VkBTw4y1H2d2s82`)

## Data model

Firebase node: `cms_quizzes/{slug}`

```json
{
  "hardball": {
    "question": "Story-specific open-ended question",
    "keywords": ["keyword1", "keyword2", "keyword3"],
    "minMatches": 2,
    "helperText": "Optional hint shown to user"
  },
  "mcqs": [
    {
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": 0,
      "explanation": "Why this is correct"
    }
  ],
  "essays": [
    {
      "question": "...",
      "keywordPool": ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"],
      "requiredMatches": 5
    }
  ],
  "mode": "story",
  "maxPoints": 50,
  "generatedAt": 0,
  "approvedAt": 0,
  "approvedBy": "",
  "model": "claude-sonnet-4-6"
}
```

Story mode: 15 MCQs, 3 essays, maxPoints 50.
Reader mode: 25 MCQs, 5 essays, maxPoints 100.

## Files to create

### 1. `/app/api/generate-quiz/route.js`

Server-side API route. POST endpoint.

Input: `{ slug, mode: "story" | "reader" }`

Steps:
1. Verify caller is admin (check Firebase auth token, match UID `XaG6bTGqdDXh7VkBTw4y1H2d2s82`)
2. Fetch story content from Firebase: try `cms_stories/{slug}` first, fall back to hardcoded `stories.js` lookup. For book reader mode, fetch the EPUB text.
3. Build prompt for Claude (see prompt template below)
4. Call Anthropic API with model `claude-sonnet-4-6`
5. Parse response as JSON
6. Validate structure (correct counts, required fields)
7. Return JSON to client (do NOT auto-save — admin must approve first)

Output: the generated quiz object, plus any validation warnings.

### 2. `/app/admin/quizzes/page.js`

New admin page. Layout:

**Top section:** Story selector
- Dropdown listing all stories (merge `stories.js` hardcoded + `cms_stories` from Firebase)
- Show indicator next to each: "✓ Quiz live", "⚠ Draft saved", or no marker
- Filter toggle: All / Story page / Book reader
- "Generate Quiz" button (disabled until story selected)

**Middle section:** Quiz preview/edit (shown after generation or when editing existing)
- HARDBALL question + editable keyword tags
- MCQ cards (15 or 25), each with editable question, 4 editable options, correct-answer radio, editable explanation
- Essay cards (3 or 5), each with editable question, editable keyword pool tags
- "Regenerate" button (calls API again, replaces current draft)
- "Save as draft" button (saves to `cms_quizzes/{slug}` with `approvedAt: null`)
- "Approve & publish" button (saves with `approvedAt: <now>`, `approvedBy: <admin uid>`)

**Loading states:** show "Generating quiz... (~30s)" with a subtle spinner during API call. Disable form inputs during generation.

**Error handling:** if API fails, show clear error message. Allow retry. Save partial progress to localStorage so admin doesn't lose work on browser refresh.

### 3. Prompt template (used inside `/app/api/generate-quiz/route.js`)

```
You are creating a comprehension quiz for a literary platform called Calvary Scribblings.

Story title: {title}
Author: {author}
Mode: {mode}

Full text:
"""
{storyText}
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
  "mode": "{mode}",
  "maxPoints": 50
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

Return ONLY the JSON. No preamble, no commentary, no markdown fences.
```

## Editorial preferences

All UI text and quiz content must use:
- British English
- Single quotes (not double)
- Em dashes with spaces ( — )
- No Oxford comma
- Italicised story/book titles where they appear

## Branding

Match existing admin pages styling:
- Dark background `#0a0a0a`
- Purple accent `#6b2fad`
- Gold accent `#c9a44c`
- Cream text `#f0ead8`
- Serif headings (Georgia)
- Inter for UI labels

## Out of scope for Phase 1

- User-facing quiz flow
- Cinematic animation
- Points wiring
- Quiz analytics

These come in Phase 2 and 3. Do not stub or build placeholder versions.

## Testing checklist

Before considering Phase 1 complete:
- [ ] `/admin/quizzes` page loads, gated by admin UID
- [ ] Story dropdown lists both hardcoded and CMS stories
- [ ] "Generate Quiz" calls `/api/generate-quiz` and returns valid JSON
- [ ] All fields are editable inline
- [ ] "Regenerate" replaces the current draft
- [ ] "Save as draft" persists to Firebase without `approvedAt`
- [ ] "Approve & publish" persists with `approvedAt`
- [ ] Existing quiz can be re-opened and edited
- [ ] localStorage persists work-in-progress through browser refresh