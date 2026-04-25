'use client';

export function normalise(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function stem(word) {
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('ed')) return word.slice(0, -2);
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function tokenise(text) {
  return normalise(text)
    .split(/\s+/)
    .filter(w => w.length > 1)
    .map(stem);
}

export function countKeywordMatches(answer, keywords) {
  const tokens = new Set(tokenise(answer));
  let count = 0;
  for (const kw of keywords) {
    const kwTokens = tokenise(kw);
    if (kwTokens.length > 0 && kwTokens.every(t => tokens.has(t))) {
      count++;
    }
  }
  return count;
}

export function scoreHardball(answer, hardball) {
  const { keywords, minMatches = 2 } = hardball;
  return countKeywordMatches(answer, keywords) >= minMatches;
}

export function scoreEssay(answer, essay) {
  const { keywordPool, requiredMatches = 5 } = essay;
  return countKeywordMatches(answer, keywordPool) >= requiredMatches;
}

export function determineTier(percent) {
  if (percent >= 100) return { tier: 'platinum', label: 'Platinum', pointsAwarded: 50 };
  if (percent >= 90) return { tier: 'gold', label: 'Gold', pointsAwarded: 45 };
  if (percent >= 80) return { tier: 'silver', label: 'Silver', pointsAwarded: 40 };
  if (percent >= 60) return { tier: 'bronze', label: 'Bronze', pointsAwarded: 25 };
  return { tier: null, label: null, pointsAwarded: 0 };
}

export function scoreQuiz(quizData, mcqAnswers, essayAnswers) {
  const { mcqs, essays } = quizData;

  let mcqScore = 0;
  for (let i = 0; i < mcqs.length; i++) {
    if (mcqAnswers[i] === mcqs[i].correctAnswer) mcqScore++;
  }

  let essayScore = 0;
  for (let i = 0; i < essays.length; i++) {
    if (scoreEssay(essayAnswers[i] || '', essays[i])) essayScore++;
  }

  const total = mcqs.length + essays.length;
  const totalPercent = total > 0 ? ((mcqScore + essayScore) / total) * 100 : 0;
  const tierResult = determineTier(totalPercent);

  return { mcqScore, essayScore, totalPercent, ...tierResult };
}
