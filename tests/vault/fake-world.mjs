// SAFETY-2B — an in-memory stand-in for everything the puller talks to: Cloud Storage (both the
// site's buckets and the vault), the Identity Toolkit, Firebase Rules, Cloudflare and the metadata
// server. Every request is recorded, so a test can assert what the puller did NOT do (a DELETE, an
// overwrite, a write to the site, a Cloudflare settings call).
import { createHash } from 'node:crypto';

export const SITE_FILES = 'site-files-bucket';
export const SITE_PRIVATE = 'site-private-bucket';
export const VAULT = 'vault-bucket';
export const PROJECT = 'site-project';
export const CF_ACCOUNT = 'cf-account-0001';
export const CF_TOKEN = 'cf-token-SECRET-VALUE-0001';

const md5 = (b) => createHash('md5').update(b).digest('base64');

export function makeWorld({ pageSize = 2 } = {}) {
  let gen = 1000;
  const buckets = new Map([[SITE_FILES, new Map()], [SITE_PRIVATE, new Map()], [VAULT, new Map()]]);
  const put = (bucket, name, body, meta = {}) => {
    const bytes = Buffer.from(body);
    const o = { name, generation: String(++gen), size: String(bytes.length), md5Hash: md5(bytes), contentType: meta.contentType || 'application/octet-stream', metadata: meta.metadata, cacheControl: meta.cacheControl, bytes };
    buckets.get(bucket).set(name, o);
    return o;
  };
  const world = {
    buckets, put, requests: [],
    users: [], hashConfig: { algorithm: 'SCRYPT', signerKey: 'c2lnbmVy', saltSeparator: 'Bw==', rounds: 8, memoryCost: 14 },
    workers: { 'worker-one': 'export default { fetch() { return new Response("1") } }', 'worker-two': 'addEventListener("fetch", () => {})' },
    storageRules: { [SITE_FILES]: "rules_version = '2';\nservice firebase.storage {}" },
    failRewriteFor: new Set(), // object names whose copy answers 403
    vanishOnCopy: new Set(), // object names replaced on the site between the listing and the copy
    rewriteSteps: 1, // >1 makes the copy answer "not done" with a rewrite token first
    tokenCalls: 0,
  };

  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const listBucket = (bucket, url) => {
    const prefix = url.searchParams.get('prefix') || '';
    const all = [...buckets.get(bucket).values()].filter((o) => o.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name));
    const start = Number(url.searchParams.get('pageToken') || 0);
    const items = all.slice(start, start + pageSize).map(({ bytes, ...o }) => o);
    return json(200, { items, ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) });
  };

  world.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    world.requests.push({ method, url, headers });
    if (url.hostname === 'metadata.google.internal') { world.tokenCalls++; return json(200, { access_token: 'google-token', expires_in: 3600 }); }

    if (url.hostname === 'storage.googleapis.com') {
      if (headers.Authorization !== 'Bearer google-token') return json(401, {});
      let m;
      if (method === 'GET' && (m = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o$/))) return listBucket(decodeURIComponent(m[1]), url);
      if (method === 'GET' && (m = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/))) {
        return buckets.get(decodeURIComponent(m[1])).has(decodeURIComponent(m[2])) ? json(200, { name: decodeURIComponent(m[2]) }) : json(404, {});
      }
      if (method === 'POST' && (m = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o\/(.+)\/rewriteTo\/b\/([^/]+)\/o\/(.+)$/))) {
        const [src, sName, dst, dName] = m.slice(1).map(decodeURIComponent);
        if (world.failRewriteFor.has(sName)) return json(403, {});
        const o = buckets.get(src).get(sName);
        if (world.vanishOnCopy.has(sName) && o) { put(src, sName, Buffer.concat([o.bytes, Buffer.from('v2')])); }
        const live = buckets.get(src).get(sName);
        if (!live || live.generation !== url.searchParams.get('sourceGeneration')) return json(404, {});
        if (url.searchParams.get('ifGenerationMatch') === '0' && buckets.get(dst).has(dName)) return json(412, {});
        const step = Number(url.searchParams.get('rewriteToken') || 0) + 1;
        if (step < world.rewriteSteps) return json(200, { done: false, rewriteToken: String(step) });
        put(dst, dName, live.bytes, { contentType: live.contentType, metadata: live.metadata });
        return json(200, { done: true, resource: { name: dName } });
      }
      if (method === 'POST' && (m = url.pathname.match(/^\/upload\/storage\/v1\/b\/([^/]+)\/o$/))) {
        const b = decodeURIComponent(m[1]); const name = url.searchParams.get('name');
        if (url.searchParams.get('ifGenerationMatch') === '0' && buckets.get(b).has(name)) return json(412, {});
        put(b, name, Buffer.from(init.body), { contentType: headers['Content-Type'] });
        return json(200, { name });
      }
      return json(400, {});
    }

    if (url.hostname === 'identitytoolkit.googleapis.com') {
      if (headers.Authorization !== 'Bearer google-token') return json(401, {});
      if (url.pathname === `/admin/v2/projects/${PROJECT}/config`) return json(200, { signIn: world.hashConfig ? { hashConfig: world.hashConfig } : {} });
      if (url.pathname === `/v1/projects/${PROJECT}/accounts:batchGet`) {
        const start = Number(url.searchParams.get('nextPageToken') || 0);
        const users = world.users.slice(start, start + pageSize);
        return json(200, { users, ...(start + pageSize < world.users.length ? { nextPageToken: String(start + pageSize) } : {}) });
      }
      return json(404, {});
    }

    if (url.hostname === 'firebaserules.googleapis.com') {
      if (url.pathname === `/v1/projects/${PROJECT}/releases`) {
        return json(200, { releases: [
          { name: `projects/${PROJECT}/releases/cloud.firestore`, rulesetName: `projects/${PROJECT}/rulesets/fs1` },
          ...Object.keys(world.storageRules).map((b, i) => ({ name: `projects/${PROJECT}/releases/firebase.storage/${b}`, rulesetName: `projects/${PROJECT}/rulesets/st${i}` })),
        ] });
      }
      const m = url.pathname.match(/^\/v1\/projects\/[^/]+\/rulesets\/st(\d+)$/);
      if (m) return json(200, { source: { files: [{ name: 'storage.rules', content: Object.values(world.storageRules)[Number(m[1])] }] } });
      return json(404, {});
    }

    if (url.hostname === 'api.cloudflare.com') {
      if (headers.Authorization !== `Bearer ${CF_TOKEN}`) return json(403, { success: false });
      const base = `/client/v4/accounts/${CF_ACCOUNT}/workers/scripts`;
      if (url.pathname === base) return json(200, { success: true, result: Object.keys(world.workers).map((id) => ({ id, etag: 'x', handlers: ['fetch'] })) });
      const m = url.pathname.match(new RegExp(`^${base}/([^/]+)/content/v2$`));
      if (m && world.workers[decodeURIComponent(m[1])] != null) return new Response(world.workers[decodeURIComponent(m[1])], { status: 200, headers: { 'content-type': 'application/javascript' } });
      return json(404, { success: false });
    }
    return json(599, {});
  };
  return world;
}

export const ENV = (recipient) => ({
  VAULT_BUCKET: VAULT, SITE_PROJECT_ID: PROJECT, SITE_FILES_BUCKET: SITE_FILES, SITE_PRIVATE_BUCKET: SITE_PRIVATE,
  AGE_RECIPIENT: recipient, CF_ACCOUNT_ID: CF_ACCOUNT, CF_API_TOKEN: CF_TOKEN,
});
