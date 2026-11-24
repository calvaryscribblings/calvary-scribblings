// SHOP-B2 — the paperback shop's handoff page and its code-minting Function, the unit half.
// docs/ACCOUNT-CONTRACT.md §6.2 (a). The emulator half (the real conditional write, read back) is
// shop-handoff.emulator.test.mjs.
//
//   · the allow-list: one address, character for character; every near miss refused
//   · the state: 1–128 URL-safe characters, refused otherwise, never cleaned
//   · no open redirect: every address the page can go to is built from the constant
//   · the Function: the exact record, the key, the limiter's buckets, its refusals, and
//     nothing sensitive in any log line
//   · the page: noindex, no referrer, not in the sitemap, linked from nowhere, never claimed,
//     not exempt from the completion step, and no words but SHOP_COPY's

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { join, relative } from 'node:path';
import {
  SHOP_RETURN_URL, SHOP_RETURNS, STATE_MAX, CODE_RE, CODE_TTL_MS, SHOP_COPY, SHOP_CODE_ENDPOINT,
  isAllowedReturn, isState, readHandoffParams, returnHref, declineHref,
} from '../../app/lib/shopHandoff.js';
import { handleShopCode, SHOP_CODE_CAPS, mintCode, codeKey, SHOP_CODES_PATH } from '../../functions/api/account/shop-code.js';
import { consume } from '../../functions/api/_ratelimit.js';
import { SHOP_CODE_KEY } from '../../functions/api/account/_deletion.js';
import { completionExempt } from '../../app/lib/profileCompletion.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const R = SHOP_RETURN_URL;
const enc = encodeURIComponent;
const searchFor = (ret, state = 'abc_DEF-123.~') => `?return=${enc(ret)}&state=${enc(state)}`;

// ── the allow-list ─────────────────────────────────────────────────────────────────────────────
describe('the return address: exactly one, character for character', () => {
  test('the one address, and only it', () => {
    assert.equal(R, 'https://books.calvaryscribblings.co.uk/account/return');
    assert.deepEqual([...SHOP_RETURNS], [R]);
    assert.ok(Object.isFrozen(SHOP_RETURNS));
    assert.equal(isAllowedReturn(R), true);
    // As the shop should send it (percent-encoded in our query) and raw: one decode, the same string.
    assert.deepEqual(readHandoffParams(searchFor(R)), { ok: true, state: 'abc_DEF-123.~' });
    assert.deepEqual(readHandoffParams(`?return=${R}&state=s1`), { ok: true, state: 's1' });
    assert.deepEqual(readHandoffParams(`?state=s1&return=${enc(R)}&utm_source=x`), { ok: true, state: 's1' }, 'our own other parameters are ignored');
  });

  // Every value below is what `return` holds AFTER URLSearchParams' one decode.
  const REFUSED = {
    'another host': [
      'https://evil.example/account/return',
      'https://calvaryscribblings.co.uk/account/return',
      'https://www.calvaryscribblings.co.uk/account/return',
      'https://shop.calvaryscribblings.co.uk/account/return',
      'https://books.calvaryscribblings.co.uk.evil.example/account/return',
      'https://evil-books.calvaryscribblings.co.uk/account/return',
      'https://books.calvaryscribblings.co.uk./account/return',
      'https://books.calvaryscribblings.co/account/return',
      'https://xn--books-calvaryscribblings-co-uk.example/account/return',
    ],
    'http, or another scheme': [
      'http://books.calvaryscribblings.co.uk/account/return',
      'ws://books.calvaryscribblings.co.uk/account/return',
      'javascript:alert(1)//https://books.calvaryscribblings.co.uk/account/return',
      'data:text/html,https://books.calvaryscribblings.co.uk/account/return',
      '//books.calvaryscribblings.co.uk/account/return',
      'https:books.calvaryscribblings.co.uk/account/return',
      'https:/books.calvaryscribblings.co.uk/account/return',
      'https:///books.calvaryscribblings.co.uk/account/return',
      '/account/return',
      'account/return',
    ],
    'a prefix of it': [
      'https://books.calvaryscribblings.co.uk',
      'https://books.calvaryscribblings.co.uk/',
      'https://books.calvaryscribblings.co.uk/account',
      'https://books.calvaryscribblings.co.uk/account/',
      'https://books.calvaryscribblings.co.uk/account/retur',
      'https://books.calvaryscribblings.co.uk/return',
    ],
    'it, with a suffix': [
      `${R}s`,
      `${R}/evil`,
      `${R}.evil.example`,
      `${R}/../../evil`,
      `${R}/..`,
      `${R};x=1`,
      `${R}%00`,
      `${R}\u0000`,
      `${R} `,
      ` ${R}`,
      `${R}\t`,
      `${R}\n`,
      `\n${R}`,
      `${R}​`,
    ],
    'a trailing slash': [`${R}/`, `${R}//`],
    'an extra query or fragment': [
      `${R}?`, `${R}?x=1`, `${R}?code=AAAA`, `${R}?state=other`, `${R}?next=https://evil.example`,
      `${R}#`, `${R}#x`, `${R}?#`,
    ],
    'another case': [
      'HTTPS://books.calvaryscribblings.co.uk/account/return',
      'https://BOOKS.calvaryscribblings.co.uk/account/return',
      'https://books.CalvaryScribblings.co.uk/account/return',
      'https://books.calvaryscribblings.co.uk/Account/Return',
      'https://books.calvaryscribblings.co.uk/account/RETURN',
    ],
    'an encoding that survives one decode': [
      'https://books.calvaryscribblings.co.uk/account%2Freturn',
      'https://books.calvaryscribblings.co.uk/account%2freturn',
      'https://books.calvaryscribblings.co.uk/%61ccount/return',
      'https://books.calvaryscribblings.co.uk/account/retur%6E',
      'https%3A%2F%2Fbooks.calvaryscribblings.co.uk%2Faccount%2Freturn',
      'https://books%2Ecalvaryscribblings.co.uk/account/return',
      'https://books.calvaryscribblings.co.uk/account/%2e%2e/return',
      'https://books.calvaryscribblings.co.uk/account/return%23',
      'https://books.calvaryscribblings.co.uk/account/return%3Fx=1',
      'https://books.calvaryscribblings.co.uk/аccount/return', // Cyrillic а
      'https://bооks.calvaryscribblings.co.uk/account/return', // Cyrillic о
      'https://books.calvaryscribblings.co.uk/account/return'.normalize('NFKD').replace('/', '／'),
    ],
    'userinfo': [
      'https://user@books.calvaryscribblings.co.uk/account/return',
      'https://user:pass@books.calvaryscribblings.co.uk/account/return',
      'https://@books.calvaryscribblings.co.uk/account/return',
      'https://books.calvaryscribblings.co.uk@evil.example/account/return',
      'https://books.calvaryscribblings.co.uk:443@evil.example/account/return',
      'https://evil.example@books.calvaryscribblings.co.uk/account/return',
    ],
    'a port': [
      'https://books.calvaryscribblings.co.uk:443/account/return',
      'https://books.calvaryscribblings.co.uk:8443/account/return',
    ],
    'backslashes': [
      'https:\\\\books.calvaryscribblings.co.uk\\account\\return',
      'https://books.calvaryscribblings.co.uk\\account\\return',
      'https://books.calvaryscribblings.co.uk/account\\return',
      `${R}\\`,
      'https://evil.example\\@books.calvaryscribblings.co.uk/account/return',
      'https://evil.example\\.books.calvaryscribblings.co.uk/account/return',
      '/\\evil.example',
      '\\\\evil.example',
    ],
    'nothing': [''],
  };

  for (const [kind, values] of Object.entries(REFUSED)) {
    test(`refused: ${kind}`, () => {
      for (const v of values) {
        assert.equal(isAllowedReturn(v), false, `isAllowedReturn let through ${JSON.stringify(v)}`);
        assert.deepEqual(readHandoffParams(searchFor(v)), { ok: false, reason: 'return' }, `the page let through ${JSON.stringify(v)}`);
      }
    });
  }

  test('refused: double-encoded, or encoded in the raw query so one decode leaves it encoded', () => {
    assert.equal(readHandoffParams(`?return=${enc(enc(R))}&state=s`).ok, false);
    assert.equal(readHandoffParams('?return=https://books.calvaryscribblings.co.uk/account%252Freturn&state=s').ok, false);
    assert.equal(readHandoffParams(`?return=${R}%2F&state=s`).ok, false);
    assert.equal(readHandoffParams(`?return=${R}+&state=s`).ok, false, '+ is a space after the decode');
    assert.equal(readHandoffParams(`?return=${R}%3Fx%3D1&state=s`).ok, false);
  });

  test('refused: missing, repeated (even twice the right one), or a near name', () => {
    for (const s of ['', '?', '?state=s', `?Return=${enc(R)}&state=s`, `?return[]=${enc(R)}&state=s`, `?returnTo=${enc(R)}&state=s`,
      `?return=${enc(R)}&return=${enc('https://evil.example/')}&state=s`,
      `?return=${enc('https://evil.example/')}&return=${enc(R)}&state=s`,
      `?return=${enc(R)}&return=${enc(R)}&state=s`]) {
      assert.deepEqual(readHandoffParams(s), { ok: false, reason: 'return' }, s);
    }
  });

  test('only a string is ever compared: an array, a boxed string or an object with toString are refused', () => {
    for (const v of [[R], new String(R), { toString: () => R }, null, undefined, 1, true, {}]) {
      assert.equal(isAllowedReturn(v), false);
    }
  });
});

// ── the state ──────────────────────────────────────────────────────────────────────────────────
describe('the state: 1 to 128 URL-safe characters, echoed untouched', () => {
  test('128 is allowed, 129 is refused', () => {
    assert.equal(STATE_MAX, 128);
    assert.deepEqual(readHandoffParams(searchFor(R, 'a'.repeat(128))), { ok: true, state: 'a'.repeat(128) });
    assert.deepEqual(readHandoffParams(searchFor(R, 'a'.repeat(129))), { ok: false, reason: 'state' });
    assert.equal(isState('x'.repeat(1000)), false);
  });
  test('every unreserved character is allowed', () => {
    const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    assert.deepEqual(readHandoffParams(searchFor(R, all)), { ok: true, state: all });
  });
  test('anything not URL-safe is refused, never cleaned', () => {
    for (const bad of [' ', 'a b', 'a+b', 'a%20b', 'a/b', 'a?b', 'a#b', 'a&b', 'a=b', 'a"b', "a'b", 'a<b', 'a>b', 'a\\b',
      'a\nb', 'a\rb', 'a\u0000b', 'é', 'a​b', '😀', 'a,b', 'a;b', 'a:b', 'a@b', 'a!b', 'a*b', 'a(b)', 'a[b]', ' a', 'a ']) {
      assert.deepEqual(readHandoffParams(searchFor(R, bad)), { ok: false, reason: 'state' }, JSON.stringify(bad));
    }
  });
  test('missing, empty or repeated is refused', () => {
    for (const s of [`?return=${enc(R)}`, `?return=${enc(R)}&state=`, `?return=${enc(R)}&state`, `?return=${enc(R)}&state=a&state=a`]) {
      assert.deepEqual(readHandoffParams(s), { ok: false, reason: 'state' }, s);
    }
  });
  test('the state comes back exactly as sent', () => {
    const st = 'Zz09-._~'.repeat(16);
    assert.equal(st.length, 128);
    const code = mintCode();
    const href = returnHref(code, st);
    assert.equal(new URL(href).searchParams.get('state'), st);
    assert.ok(href.endsWith(`&state=${st}`), 'no character of it was encoded');
    assert.equal(declineHref(st), `${R}?state=${st}`);
  });
});

// ── no open redirect ───────────────────────────────────────────────────────────────────────────
describe('no open redirect: the page only ever goes to the constant', () => {
  test('returnHref and declineHref are the constant plus our own two values, and refuse anything else', () => {
    const code = mintCode();
    assert.equal(returnHref(code, 's1'), `${R}?code=${code}&state=s1`);
    assert.equal(declineHref('s1'), `${R}?state=s1`);
    for (const [c, s] of [['short', 's'], [`${code}x`, 's'], [code, 'a&next=https://evil.example'], [code, ''], [code, 'a'.repeat(129)]]) {
      assert.throws(() => returnHref(c, s));
    }
    assert.throws(() => returnHref(`${code.slice(0, 42)}/`, 's'));
    assert.throws(() => declineHref('a b'));
    const u = new URL(returnHref(code, 's1'));
    assert.equal(u.origin + u.pathname, R);
    assert.deepEqual([...u.searchParams.keys()], ['code', 'state']);
  });

  test('the page navigates only through those two builders, with location.replace', () => {
    const page = read('app/account/shop/page.js');
    const uses = page.match(/window\.location[.\w]*/g);
    assert.deepEqual(uses.sort(), ['window.location.replace', 'window.location.search'], 'the page touches location only to read its query and to leave');
    assert.equal((page.match(/\bleave\(/g) || []).length, 2, 'two calls to leave() (plus its definition)');
    assert.match(page, /leave\(returnHref\(data\.code, params\.state\)\)/);
    assert.match(page, /leave\(declineHref\(params\.state\)\)/);
    assert.doesNotMatch(page, /\.get\(['"]return['"]\)|router\.(push|replace)|location\.(assign|href\s*=)|<a\s|href=/, 'no other way out of the page');
    assert.match(page, /body: JSON\.stringify\(\{ return: SHOP_RETURN_URL, state: params\.state \}\)/, 'the Function is sent the constant, not the query');
  });

  test('a refused link sets no state to leave with', () => {
    // readHandoffParams is the page's only reading of its query; a refusal carries no state, and
    // both builders need one, so there is nothing a refused link can be sent to.
    for (const v of ['https://evil.example/', `${R}/`, `${R}?x=1`, 'javascript:alert(1)']) {
      const p = readHandoffParams(searchFor(v));
      assert.equal(p.ok, false);
      assert.equal('state' in p, false);
    }
  });
});

// ── the Function ───────────────────────────────────────────────────────────────────────────────
const UID = 'SHOPreader00000000000000000001';
const OTHER = 'SHOPother000000000000000000002';
const GOOD_TOKEN = 'eyJ.good-id-token.sig';
const IP = '203.0.113.77';
const STATE = 'shop-session_8Kq2.Zx~';
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: PEM,
  FIREBASE_DATABASE_URL: 'https://db.test',
};
const NOW = 1_795_000_000_000;

/** A stand-in for every outside service. `calls` records what was asked, `puts` the code writes. */
function world({ writeStatus = 200, counter = () => 1, lookupFails = false } = {}) {
  const calls = [];
  const puts = [];
  const fetchStub = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET' });
    if (u.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup')) {
      const { idToken } = JSON.parse(opts.body);
      if (lookupFails || idToken !== GOOD_TOKEN) return new Response('{"error":{"message":"INVALID_ID_TOKEN"}}', { status: 400 });
      return Response.json({ users: [{ localId: UID, email: 'reader@example.com' }] });
    }
    if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'admin-access-token' });
    if (u.startsWith('https://db.test/rate_limits/')) {
      if (opts.method === 'DELETE') return new Response('null');
      return new Response(String(counter(u)));
    }
    if (u.startsWith(`https://db.test/${SHOP_CODES_PATH}/`)) {
      puts.push({ url: u, method: opts.method, headers: opts.headers, body: opts.body });
      return new Response(writeStatus === 200 ? opts.body : '{"error":"x"}', { status: writeStatus });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { calls, puts, fetchStub };
}

function request({ token = GOOD_TOKEN, ip = IP, body = { return: R, state: STATE }, raw = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers['CF-Connecting-IP'] = ip;
  return new Request('https://calvaryscribblings.co.uk/api/account/shop-code', {
    method: 'POST', headers, body: raw ?? JSON.stringify(body),
  });
}

// Every console line any scenario prints, checked at the end for anything sensitive.
const LOGS = [];
const SECRETS = new Set([UID, OTHER, GOOD_TOKEN, IP, IP.replace(/\./g, '_'), STATE, 'reader@example.com', 'admin-access-token']);
const realConsole = { log: console.log, warn: console.warn, error: console.error };
const realFetch = globalThis.fetch;

describe('POST /api/account/shop-code', () => {
  before(() => {
    for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { LOGS.push(a.map(String).join(' ')); };
  });
  after(() => {
    Object.assign(console, realConsole);
    globalThis.fetch = realFetch;
  });
  beforeEach(() => { globalThis.fetch = realFetch; });

  async function run(w, req, opts = {}) {
    globalThis.fetch = w.fetchStub;
    const ctx = { request: req, env: ENV, waitUntil() {} };
    const res = await handleShopCode(ctx, { now: () => NOW, ...opts });
    const out = { status: res.status, headers: res.headers, json: await res.json() };
    for (const p of w.puts) SECRETS.add(p.url.split('/').pop().replace('.json', ''));
    if (typeof out.json.code === 'string' && out.json.code.length === 43) SECRETS.add(out.json.code);
    return out;
  }

  test('THE EXACT RECORD: { uid, exp } at sha256(code), conditional on absence, and the code back', async () => {
    const w = world();
    const res = await run(w, request());
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json), ['code']);
    assert.match(res.json.code, CODE_RE);
    assert.equal(Buffer.from(res.json.code, 'base64url').length, 32, '32 random bytes');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');

    assert.equal(w.puts.length, 1, 'one write');
    const [p] = w.puts;
    const key = createHash('sha256').update(res.json.code, 'ascii').digest('hex');
    assert.match(key, SHOP_CODE_KEY);
    assert.equal(p.url, `https://db.test/shop_handoff_codes/${key}.json`);
    assert.equal(p.method, 'PUT');
    assert.equal(p.headers['if-match'], 'null_etag');
    assert.equal(p.headers.Authorization, 'Bearer admin-access-token');
    assert.equal(p.body, JSON.stringify({ uid: UID, exp: NOW + 5 * 60 * 1000 }));
    assert.deepEqual(JSON.parse(p.body), { uid: UID, exp: NOW + CODE_TTL_MS });
    assert.equal(CODE_TTL_MS, 300_000);
    assert.equal(await codeKey(res.json.code), key);
    assert.ok(!p.url.includes(res.json.code), 'the code itself is never an address');
  });

  test('the body cannot choose the uid, the expiry or anything else', async () => {
    const w = world();
    const res = await run(w, request({ body: { return: R, state: STATE, uid: OTHER, exp: 9e15, orderNo: 'CS-7KQ2MX', email: 'x@y.z', code: 'A'.repeat(43) } }));
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(w.puts[0].body), { uid: UID, exp: NOW + CODE_TTL_MS });
    assert.notEqual(res.json.code, 'A'.repeat(43));
  });

  test('two calls, two different codes at two different keys', async () => {
    const w = world();
    const a = await run(w, request());
    const b = await run(w, request());
    assert.notEqual(a.json.code, b.json.code);
    assert.notEqual(w.puts[0].url, w.puts[1].url);
  });

  test('a return not on the list, or a bad state: 400, and nothing is asked of anyone', async () => {
    for (const [body, code] of [
      [{ return: `${R}/`, state: STATE }, 'bad_return'],
      [{ return: 'https://evil.example/account/return', state: STATE }, 'bad_return'],
      [{ return: [R], state: STATE }, 'bad_return'],
      [{ state: STATE }, 'bad_return'],
      [{ return: R, state: 'a'.repeat(129) }, 'bad_state'],
      [{ return: R, state: 'a b' }, 'bad_state'],
      [{ return: R }, 'bad_state'],
    ]) {
      const w = world();
      const res = await run(w, request({ body }));
      assert.equal(res.status, 400);
      assert.deepEqual(res.json, { code });
      assert.deepEqual(w.calls, [], 'no lookup, no limiter, no write');
    }
    for (const raw of ['', 'not json', '[]', 'null', '"x"']) {
      const w = world();
      const res = await run(w, request({ raw }));
      assert.equal(res.status, 400);
      assert.deepEqual(res.json, { code: 'bad_request' });
      assert.deepEqual(w.calls, []);
    }
  });

  test('no token, or one Google refuses: 401 and no write', async () => {
    for (const token of [null, 'forged.token.value']) {
      const w = world();
      const res = await run(w, request({ token }));
      assert.equal(res.status, 401);
      assert.deepEqual(res.json, { code: 'signed_out' });
      assert.equal(w.puts.length, 0);
      assert.ok(!w.calls.some((c) => c.url.includes('rate_limits')), 'not charged');
    }
    const w = world();
    const res = await run(w, request(), {});
    assert.equal(res.status, 200, 'control');
    const w2 = world({ lookupFails: true });
    assert.equal((await run(w2, request())).status, 401);
  });

  test('THE LIMITER: per uid and per address, a minute and a day each, and a global day', async () => {
    const caps = SHOP_CODE_CAPS({}, UID, IP);
    assert.deepEqual(caps.map(({ scope, period, id, limit }) => [scope, period, id ?? null, limit]), [
      ['shopcode', 'minute', UID, 5],
      ['shopcode', 'day', UID, 30],
      ['shopcode-ip', 'minute', IP, 10],
      ['shopcode-ip', 'day', IP, 100],
      ['shopcode', 'day', null, 2000],
    ]);
    assert.ok(caps.every((b) => !b.id || b.logAs === 'uid' || b.logAs === 'ip'), 'every actor bucket logs its kind, not its value');
    // Tunable, never removable.
    assert.equal(SHOP_CODE_CAPS({ SHOP_CODE_MINUTE_CAP: '0' }, UID, IP)[0].limit, 5);
    assert.equal(SHOP_CODE_CAPS({ SHOP_CODE_MINUTE_CAP: '7' }, UID, IP)[0].limit, 7);

    // What the Function charges: the verified uid and Cloudflare's address, never the body's.
    let charged;
    const w = world();
    const res = await run(w, request({ body: { return: R, state: STATE, uid: OTHER } }), { consume: async (_c, b) => { charged = b; return { ok: true }; } });
    assert.equal(res.status, 200);
    assert.deepEqual(charged, caps);
  });

  test('a refusal by the limiter: 429 with Retry-After, and no code is written', async () => {
    const w = world({ counter: (u) => (u.includes('/shopcode/minute/') && !u.endsWith('/_all.json') ? 6 : 1) });
    const res = await run(w, request());
    assert.equal(res.status, 429);
    assert.equal(res.json.code, 'rate_limited');
    assert.ok(Number(res.headers.get('Retry-After')) > 0);
    assert.equal(w.puts.length, 0);
    const charged = w.calls.filter((c) => c.url.startsWith('https://db.test/rate_limits/') && c.method === 'PUT').map((c) => c.url);
    assert.equal(charged.length, 5, 'all five buckets charged');
    assert.ok(charged.some((u) => u.includes(`/shopcode/minute/`) && u.endsWith(`/${UID}.json`)));
    assert.ok(charged.some((u) => u.includes(`/shopcode-ip/day/`) && u.endsWith(`/${IP.replace(/\./g, '_')}.json`)), 'an IPv4 key RTDB accepts');
  });

  test('the address bucket refuses on its own', async () => {
    const w = world({ counter: (u) => (u.includes('/shopcode-ip/day/') ? 101 : 1) });
    const res = await run(w, request());
    assert.equal(res.status, 429);
    assert.equal(w.puts.length, 0);
  });

  test('the limiter failing is a refusal (503), never an allowance', async () => {
    const w = world({ counter: () => 'not a number' });
    const res = await run(w, request());
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'limiter_unavailable');
    assert.equal(w.puts.length, 0);
  });

  test('no CF-Connecting-IP: refused before anything is charged or written', async () => {
    const w = world();
    let charged = false;
    const res = await run(w, request({ ip: null }), { consume: async () => { charged = true; return { ok: true }; } });
    assert.equal(res.status, 503);
    assert.equal(charged, false);
    assert.equal(w.puts.length, 0);
  });

  test('a write the database refuses (or a code already there): 500, and no code is handed out', async () => {
    for (const writeStatus of [412, 401, 500]) {
      const w = world({ writeStatus });
      const res = await run(w, request());
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { code: 'unavailable' });
    }
  });

  test('not configured: 500 and nothing asked', async () => {
    const w = world();
    globalThis.fetch = w.fetchStub;
    const res = await handleShopCode({ request: request(), env: { ...ENV, FIREBASE_PRIVATE_KEY: '' } });
    assert.equal(res.status, 500);
    assert.deepEqual(w.calls, []);
  });

  test('the real limiter names the bucket by kind when it refuses', async () => {
    const lines = [];
    const w = world({ counter: () => 999 });
    globalThis.fetch = w.fetchStub;
    const warn = console.warn;
    console.warn = (...a) => { lines.push(a.join(' ')); LOGS.push(a.join(' ')); };
    try {
      await consume({ env: ENV, waitUntil() {} }, SHOP_CODE_CAPS(ENV, UID, IP));
    } finally { console.warn = warn; }
    assert.ok(lines.some((l) => l.includes('shopcode/minute/uid reached 999 of 5')), lines.join('\n'));
    // An endpoint that never set logAs prints exactly what it always did.
    const before = [];
    console.warn = (...a) => { before.push(a.join(' ')); };
    try { await consume({ env: ENV, waitUntil() {} }, [{ scope: 'x', period: 'minute', id: 'actor1', limit: 1 }]); } finally { console.warn = warn; }
    assert.ok(before.some((l) => l.includes('x/minute/actor1 reached 999 of 1')));
  });

  test('NOTHING SENSITIVE IN ANY LOG LINE: no code, key, uid, address, state, token or email', () => {
    assert.ok(LOGS.length > 5, `the scenarios above logged ${LOGS.length} lines`);
    assert.ok(SECRETS.size > 10, 'codes and keys from the runs are in the list');
    for (const line of LOGS) {
      for (const s of SECRETS) assert.ok(!line.includes(s), `a log line carries a sensitive value: ${line.replace(s, '<redacted>')}`);
      assert.doesNotMatch(line, /[0-9a-f]{64}/, 'no hash');
      assert.doesNotMatch(line, /[A-Za-z0-9_-]{43}/, 'no code-shaped value');
    }
    assert.ok(LOGS.some((l) => l === '[account/shop-code] minted 1'), 'a success logs a count');
  });
});

// ── the page and its place on the site ─────────────────────────────────────────────────────────
describe('/account/shop on the site', () => {
  test('noindex, nofollow, no referrer, titled from SHOP_COPY', () => {
    const layout = read('app/account/shop/layout.js');
    assert.match(layout, /robots: \{ index: false, follow: false \}/);
    assert.match(layout, /referrer: 'no-referrer'/);
    assert.match(layout, /title: SHOP_COPY\.title/);
  });

  test('not in the sitemap', () => {
    assert.doesNotMatch(read('app/sitemap.js'), /account/);
  });

  test('linked from nowhere: no file outside the page names its path, except the completion step\'s list', () => {
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(m?js|jsx|tsx?|json|html|txt|md|xml)$/.test(name) || name === '_redirects' || name === '_headers') {
          if (/\/account\/shop(?![-\w])/.test(readFileSync(p, 'utf8'))) hits.push(relative(ROOT, p));
        }
      }
    };
    for (const d of ['app', 'public', 'emails', 'functions']) walk(join(ROOT, d));
    // The page, its own module (comments), and the completion step's list (a path, not a link).
    const allowed = ['app/account/shop/page.js', 'app/lib/shopHandoff.js', 'app/lib/profileCompletion.js'];
    assert.deepEqual(hits.filter((h) => !allowed.includes(h)), [], `named in: ${hits.join(', ')}`);
    assert.match(read('app/lib/profileCompletion.js'), /COMPLETION_REQUIRED = \['\/account\/shop'\]/);
  });

  test('never claimed by an app: on APP-DEEP-LINKS §4, and the association test checks it', () => {
    const doc = read('docs/APP-DEEP-LINKS.md');
    const s4 = doc.slice(doc.indexOf('## 4. Never claimed'), doc.indexOf('## 5.'));
    assert.match(s4, /\| `\/account\/shop` \|/);
    assert.match(read('tests/applinks/association.test.mjs'), /'\/account\/shop'/);
  });

  test('a new account completes its handle and date of birth here, as everywhere; /account itself stays exempt', () => {
    assert.equal(completionExempt('/account/shop'), false);
    assert.equal(completionExempt('/account/shop/'), false);
    for (const p of ['/account', '/account/deleted', '/settings', '/delete-account', '/privacy', '/terms']) assert.equal(completionExempt(p), true, p);
    for (const p of ['/', '/square', '/stories/x', '/accounts']) assert.equal(completionExempt(p), false, p);
    for (const f of ['app/components/ProfileCompletion.js', 'app/components/DobCheck.js']) {
      const src = read(f);
      assert.match(src, /if \(completionExempt\(pathname\)\) return null;/, f);
      assert.doesNotMatch(src, /const EXEMPT/, `${f} keeps no list of its own`);
    }
  });

  test('the page prints no sentence of its own: every word is SHOP_COPY', () => {
    const page = read('app/account/shop/page.js');
    const jsx = page.slice(page.indexOf('let body = null;'));
    const text = [...jsx.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-z]/.test(t));
    assert.deepEqual(text, ['Calvary', 'Scribblings'], `literal text in the page: ${JSON.stringify(text)}`);
    for (const k of Object.keys(SHOP_COPY)) {
      if (k === 'title') continue;
      assert.match(page, new RegExp(`SHOP_COPY\\.${k}\\b|'${k}'`), `SHOP_COPY.${k} is never shown`);
    }
    assert.equal(SHOP_CODE_ENDPOINT, '/api/account/shop-code');
  });

  test('the words, as suggested (to be ruled)', () => {
    assert.equal(SHOP_COPY.question, 'Keep this order with your others?');
    assert.equal(SHOP_COPY.keep, 'Keep it');
    assert.equal(SHOP_COPY.notNow, 'Not now');
    assert.equal(SHOP_COPY.note, 'Your Calvary account keeps the order number, date, titles and what you paid. Nothing else comes with it.');
    assert.equal(SHOP_COPY.badLink, 'This link can’t take you back to the shop.');
    for (const v of Object.values(SHOP_COPY)) assert.doesNotMatch(v, /'/, 'house style: curly apostrophes');
  });
});
