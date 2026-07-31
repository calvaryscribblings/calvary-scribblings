'use client';

// The Summer Reading Program board.
//
// A literal route segment, not [boardId] — under output: 'export' a dynamic
// segment would need generateStaticParams, and a client component cannot export
// one. Every board gets its own three-line file like this; all the work is in
// SeasonBoard, all the configuration is in app/lib/leaderboards.js.

import SeasonBoard from '../../components/SeasonBoard';
import { SUMMER_2026 } from '../../lib/leaderboards';

export default function SummerReadingBoardPage() {
  return <SeasonBoard board={SUMMER_2026} />;
}
