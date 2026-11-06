'use client';

// STORY-W1 / RULING 328 — a story's responses as this reader is shown them: the Square's mute and
// block lists (app/components/square/useSafety.js, the same hook the Square reads them with),
// applied by shownResponses() (app/lib/storyResponses.js, where the decisions are written down).
// Signed out, or with nobody muted or blocked, the responses and the count are what they were.

import { useMemo } from 'react';
import useSafety from '../components/square/useSafety';
import { shownResponses } from './storyResponses';

export default function useShownResponses(comments, uid) {
  const { hidden } = useSafety(uid || null);
  return useMemo(() => shownResponses(comments, hidden), [comments, hidden]);
}
