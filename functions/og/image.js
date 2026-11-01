import { isId } from '../../app/lib/ids.js';
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const slug = url.searchParams.get('slug');
  // LIVE-PATHS-1: the slug was spliced raw into cms_stories/<slug>/cover.json, so `x/../../<node>/<field>`
  // read any public string and this route then FETCHED it and served the bytes. Pattern first.
  if (!isId('slug', slug)) return new Response('Missing slug', { status: 400 });

  try {
    const dbUrl = `https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app/cms_stories/${slug}/cover.json`;
    const res = await fetch(dbUrl);
    const coverUrl = await res.json();

    if (!coverUrl || typeof coverUrl !== 'string') {
      return new Response('Cover not found', { status: 404 });
    }

    const cleanUrl = coverUrl.includes('firebasestorage.googleapis.com')
      ? coverUrl.split('?')[0] + '?alt=media'
      : coverUrl;

    const imageRes = await fetch(cleanUrl);
    if (!imageRes.ok) return new Response('Image fetch failed', { status: 502 });

    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}