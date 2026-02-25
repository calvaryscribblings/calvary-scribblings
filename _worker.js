export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);

    // Clone the response so we can modify headers
    const newResponse = new Response(response.body, response);

    // Apply no-cache headers to HTML, JS, and CSS files
    const ext = url.pathname.split('.').pop().toLowerCase();
    if (['html', 'js', 'css'].includes(ext) || url.pathname.endsWith('/') || !url.pathname.includes('.')) {
      newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newResponse.headers.set('Pragma', 'no-cache');
      newResponse.headers.set('Expires', '0');
    }

    return newResponse;
  }
};
