import { NextResponse } from 'next/server';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const ADMIN_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

async function verifyAdminToken(token) {
  // Verifies a Firebase ID token via the Identity Toolkit REST API (no Admin SDK needed).
  // Returns the token's uid on success, null on any failure.
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
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

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dryRun') === 'true';

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  const uid = await verifyAdminToken(token);
  if (uid !== ADMIN_UID) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  try {
    // Fetch all quizzes and all stories in parallel
    const [quizzesRes, storiesRes] = await Promise.all([
      fetch(`${FB_DB}/cms_quizzes.json`),
      fetch(`${FB_DB}/cms_stories.json`),
    ]);

    if (!quizzesRes.ok) throw new Error(`Failed to fetch cms_quizzes (HTTP ${quizzesRes.status})`);
    if (!storiesRes.ok) throw new Error(`Failed to fetch cms_stories (HTTP ${storiesRes.status})`);

    const quizzesData = await quizzesRes.json();
    const storiesData = await storiesRes.json();

    if (!quizzesData) {
      return NextResponse.json({
        message: 'No quizzes found. Nothing to migrate.',
        migrated: 0,
        skippedDraft: 0,
        skippedNoStory: 0,
      });
    }

    const updates = {};
    const migratedSlugs = [];
    let skippedDraft = 0;
    let skippedNoStory = 0;

    for (const [slug, quiz] of Object.entries(quizzesData)) {
      // Only migrate approved (live) quizzes
      if (!quiz.approvedAt) {
        skippedDraft++;
        continue;
      }

      // Only write if the story node exists — avoids orphaned quizMeta
      if (!storiesData?.[slug]) {
        skippedNoStory++;
        continue;
      }

      const existing = storiesData[slug].quizMeta;

      updates[`/cms_stories/${slug}/quizMeta`] = {
        hasQuiz: true,
        scribblesReward: quiz.maxPoints ?? 50,
        publishedAt: quiz.approvedAt,
        // Preserve counters and naming state on re-run
        attemptCount: existing?.attemptCount ?? 0,
        namingClaimedBy: existing?.namingClaimedBy ?? null,
        namingClaimedAt: existing?.namingClaimedAt ?? null,
      };

      migratedSlugs.push(slug);
    }

    if (migratedSlugs.length === 0) {
      return NextResponse.json({
        message: 'No approved quizzes matched a story node. Nothing written.',
        dryRun,
        migrated: 0,
        skippedDraft,
        skippedNoStory,
      });
    }

    if (!dryRun) {
      const patchRes = await fetch(`${FB_DB}/.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!patchRes.ok) {
        const text = await patchRes.text();
        throw new Error(`Firebase PATCH failed (HTTP ${patchRes.status}): ${text}`);
      }
    }

    return NextResponse.json({
      message: dryRun
        ? `Dry run: ${migratedSlugs.length} quizMeta block(s) would be written. No changes made.`
        : `Migration complete. ${migratedSlugs.length} quizMeta block(s) written.`,
      dryRun,
      migrated: migratedSlugs.length,
      skippedDraft,
      skippedNoStory,
      slugs: migratedSlugs,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
