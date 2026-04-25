import { NextResponse } from 'next/server';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const CARRYOVER_THRESHOLD = 800;
const SECRET = 'calvary-points-reset-2026';

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    // Fetch all points nodes
    const res = await fetch(`${FB_DB}/points.json`);
    const data = await res.json();
    if (!data) return NextResponse.json({ message: 'No points data.' });

    const now = Date.now();
    const updates = {};

    for (const [uid, pointsData] of Object.entries(data)) {
      const total = pointsData.total || 0;
      const newTotal = total >= CARRYOVER_THRESHOLD ? total : 0;
      const historyEntry = {
        type: 'reset',
        amount: newTotal - total,
        description: total >= CARRYOVER_THRESHOLD
          ? `Monthly reset — ${total} Scribbles carried over`
          : `Monthly reset — ${total} Scribbles expired`,
        createdAt: now,
      };
      updates[`/points/${uid}/total`] = newTotal;
      updates[`/points/${uid}/lastResetAt`] = now;
      updates[`/points/${uid}/history/${now}_${uid}`] = historyEntry;
    }

    // Batch update
    const patchRes = await fetch(`${FB_DB}/.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!patchRes.ok) throw new Error('Firebase patch failed');
    return NextResponse.json({ message: `Reset complete. ${Object.keys(data).length} users processed.` });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}