// LIVE-PATHS-2 (audit #4) — what approving a quiz writes on its story, as one path per field.
//
// quizMeta holds five fields with three different writers:
//   hasQuiz, scribblesReward, publishedAt   the quiz admin (Approve / Save draft)
//   attemptCount                            record-attempt and reset-attempt, server-side increments
//   namingClaimedBy, namingClaimedAt        the naming claim
// Approval owns the first three and writes exactly those. Writing the block whole meant reading
// the other writers' fields first and writing them back, which reverses anything they wrote in
// between. Never add attemptCount or a naming field here.
import { isId } from './ids.js';

export const QUIZ_APPROVAL_FIELDS = Object.freeze(['hasQuiz', 'scribblesReward', 'publishedAt']);

export function quizApprovalMetaPaths(slug, { scribblesReward, approvedAt }) {
  if (!isId('slug', slug)) throw new Error('quizApprovalMetaPaths: not a slug');
  return {
    [`cms_stories/${slug}/quizMeta/hasQuiz`]: true,
    [`cms_stories/${slug}/quizMeta/scribblesReward`]: scribblesReward,
    [`cms_stories/${slug}/quizMeta/publishedAt`]: approvedAt,
  };
}
