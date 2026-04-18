import { NextResponse } from 'next/server';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const SECRET = 'calvary-square-cleanup-2026';
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== SECRET) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const res = await fetch(`${FB_DB}/square_posts.json`);
    const data = await res.json();
    if (!data) return NextResponse.json({ message: 'No posts.' });
    const now = Date.now();
    const toDelete = [];
    for (const [id, post] of Object.entries(data)) {
      if (post.pinned) continue;
      const deletionStart = post.unpinnedAt || post.createdAt;
      if (now - deletionStart > TWO_DAYS) toDelete.push({ id, authorUid: post.authorUid });
    }
    for (const { id, authorUid } of toDelete) {
      await fetch(`${FB_DB}/square_posts/${id}.json`, { method: 'DELETE' });
      if (authorUid) await fetch(`${FB_DB}/user_square_posts/${authorUid}/${id}.json`, { method: 'DELETE' });
    }
    return NextResponse.json({ message: `Deleted ${toDelete.length} posts.` });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}