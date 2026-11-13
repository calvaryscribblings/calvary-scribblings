// Preloaded (node --require) by tests/vault/bootstrap.test.mjs: serves the puller file for its
// raw.githubusercontent.com URL, and refuses everything else, so the bootstrap runs offline.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
globalThis.fetch = async (url) => {
  if (String(url).startsWith('https://raw.githubusercontent.com/')) {
    const body = process.env.TEST_PULLER_BODY === 'tampered' ? Buffer.from('export const main = () => 99;') : readFileSync(join(__dirname, '../../vault/puller/puller.mjs'));
    return new Response(body, { status: 200 });
  }
  return new Response('{}', { status: 599 });
};
