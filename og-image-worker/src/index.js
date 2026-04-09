export default {
  async fetch(request) {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    if (!slug) return new Response('Missing slug', { status: 400 });

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
};