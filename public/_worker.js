export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy /api/og-image to the dedicated Worker
    if (url.pathname.startsWith('/api/og-image')) {
      return fetch(`https://calvary-og-image.calvarymediauk.workers.dev${url.search}`);
    }

    const response = await env.ASSETS.fetch(request);
    const newResponse = new Response(response.body, response);
    const ext = url.pathname.split('.').pop().toLowerCase();
    if (['html', 'js', 'css'].includes(ext) || url.pathname.endsWith('/') || !url.pathname.includes('.')) {
      newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newResponse.headers.set('Pragma', 'no-cache');
      newResponse.headers.set('Expires', '0');
    }
    return newResponse;
  }
};