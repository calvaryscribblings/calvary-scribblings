export async function onRequest(context) {
  const url = new URL(context.request.url);
  return fetch(`https://calvary-og-image.calvarymediauk.workers.dev${url.search}`);
}
