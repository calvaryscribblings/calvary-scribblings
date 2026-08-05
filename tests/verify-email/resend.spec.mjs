// R9.5 — THE RESEND ACTUALLY GOES TO THE BRANDED SENDER, AND SAYS THE RIGHT THING WHEN IT FAILS.
//
//   npm run test:verify-email
//
// WHAT CHANGED AND WHY IT NEEDS A TEST. The resend used to call firebase/auth's
// sendEmailVerification() straight from the browser. Firebase Auth's SMTP is disabled on
// this project, so that path sent an unbranded firebaseapp.com email which never appeared in
// Resend and could not be traced. It now posts to /api/auth/send-verification — the Pages
// proxy in front of the calvary-auth Worker — which is branded and logged.
//
// The regression that matters is silent: someone restores the firebase call, or a refactor
// drops the Authorization header, and mail goes back to being untraceable with nothing
// failing. So this asserts the REQUEST, not just the outcome — the URL, the method, the
// bearer token, the body — against the shipped modules read off disk.
//
// WHY THE ENDPOINT IS INTERCEPTED RATHER THAN CALLED. /api/auth/send-verification is a
// Cloudflare Pages Function. next.config.mjs sets output:'export', so it is not built into
// any local artifact and cannot run here. Delivery itself is therefore NOT tested by this
// suite and cannot be: confirming branded mail arrives and shows Delivered in Resend needs
// the deployed site, an unverified account and the Resend dashboard. What this suite pins is
// everything up to the network boundary.
//
// The modules are injected as classic scripts — both are plain JS, no JSX. verifyEmail.js's
// React import is stripped along with the exports; nothing here calls the hook, only the two
// pure/async functions beside it. The transform asserts it matched, so a change in the
// modules' shape fails loudly instead of testing an empty page.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function asClassicScript(relPath, exposes) {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const exportCount = (src.match(/^export (const|function|async function) /gm) || []).length;
  if (exportCount === 0) {
    throw new Error(`${relPath}: no top-level exports found — has the module's shape changed?`);
  }
  const body = src
    .replace(/^'use client';\s*$/m, '')
    .replace(/^import .*$/gm, '')          // React, and the authMail import (injected separately)
    .replace(/^export (const|function|async function) /gm, '$1 ');
  return `${body}\n${exposes.map((n) => `window.${n} = ${n};`).join('\n')}`;
}

const AUTHMAIL_JS = asClassicScript('app/lib/authMail.js', ['postAuthMail']);
const VERIFY_JS = asClassicScript('app/lib/verifyEmail.js', [
  'sendVerificationEmail', 'verificationMessageFor',
  'VERIFY_SENT_MESSAGE', 'VERIFY_THROTTLED_MESSAGE', 'VERIFY_ERROR_MESSAGE',
]);

const FAKE_TOKEN = 'fake-id-token-for-the-harness';

// The page needs a real ORIGIN, not about:blank. postAuthMail fetches the relative path
// '/api/auth/send-verification', and a relative URL on about:blank has no base to resolve
// against — fetch throws "Failed to parse URL" before any request exists to intercept.
//
// That is not a cosmetic detail: the first draft of this suite ran on about:blank, and the
// three cases expecting the GENERIC message passed anyway, because a TypeError maps to the
// generic message just as a 500 does. They were green while testing nothing. Serving the
// harness from a routed origin is what makes the failure cases mean what they say.
const ORIGIN = 'http://resend-harness.test';

async function prepare(page) {
  await page.route(`${ORIGIN}/`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>resend harness</title>',
  }));
  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ content: AUTHMAIL_JS });
  await page.addScriptTag({ content: VERIFY_JS });
  await page.evaluate((token) => {
    // Stands in for the Firebase User the banner and /settings both hand in.
    window.__user = {
      uid: 'u_test',
      displayName: 'Ada Nwosu',
      email: 'ada@example.com',
      getIdToken: async () => token,
    };
  }, FAKE_TOKEN);
}

// Intercept the Pages Function and answer with whatever the case needs.
async function stubEndpoint(page, respond) {
  const seen = [];
  await page.route('**/api/auth/**', async (route) => {
    const req = route.request();
    seen.push({
      url: req.url(),
      method: req.method(),
      auth: req.headers()['authorization'] || null,
      contentType: req.headers()['content-type'] || null,
      body: req.postData(),
    });
    await route.fulfill(respond());
  });
  return seen;
}

const ok = () => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
const fail = (status, payload) => () => ({
  status, contentType: 'application/json', body: JSON.stringify(payload),
});

test.describe('the resend posts to the branded sender', () => {
  test('it calls /api/auth/send-verification with the bearer token', async ({ page }) => {
    await prepare(page);
    const seen = await stubEndpoint(page, ok);

    const result = await page.evaluate(() => window.sendVerificationEmail(window.__user).then(() => 'resolved'));
    expect(result).toBe('resolved');

    expect(seen).toHaveLength(1);
    const [req] = seen;
    expect(req.url).toContain('/api/auth/send-verification');
    expect(req.method).toBe('POST');
    expect(req.auth).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(req.contentType).toContain('application/json');
  });

  test('it never touches Firebase\'s own verification endpoint', async ({ page }) => {
    // The specific regression: someone restores sendEmailVerification() and mail silently
    // goes back to the untraceable firebaseapp.com template. Any identitytoolkit call from
    // this path is that regression.
    await prepare(page);
    const identityToolkitCalls = [];
    await page.route('**identitytoolkit**', async (route) => {
      identityToolkitCalls.push(route.request().url());
      await route.fulfill({ status: 200, body: '{}' });
    });
    await stubEndpoint(page, ok);

    await page.evaluate(() => window.sendVerificationEmail(window.__user));
    expect(identityToolkitCalls).toEqual([]);
  });

  test('the first name rides along, and it is only the first name', async ({ page }) => {
    await prepare(page);
    const seen = await stubEndpoint(page, ok);
    await page.evaluate(() => window.sendVerificationEmail(window.__user));
    // "Ada Nwosu" → "Ada". The proxy prefers the account's own displayName over this, so a
    // wrong guess cannot reach the mail — but sending the surname would still be sloppy.
    expect(JSON.parse(seen[0].body)).toEqual({ firstName: 'Ada' });
  });

  test('a user with no displayName still sends', async ({ page }) => {
    await prepare(page);
    const seen = await stubEndpoint(page, ok);
    await page.evaluate(() => window.sendVerificationEmail({ ...window.__user, displayName: null }));
    expect(JSON.parse(seen[0].body)).toEqual({ firstName: '' });
    expect(seen[0].auth).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  test('no signed-in user throws before any request is made', async ({ page }) => {
    await prepare(page);
    const seen = await stubEndpoint(page, ok);
    const threw = await page.evaluate(() =>
      window.sendVerificationEmail(null).then(() => false, () => true));
    expect(threw).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

test.describe('failures are mapped through the real fetch, not just the mapper', () => {
  // Each case drives a genuine HTTP failure through postAuthMail and asserts the message the
  // reader would see. This is the part a unit test of verificationMessageFor cannot reach:
  // it proves the status actually survives the fetch and lands on the error object.
  const CASES = [
    {
      name: 'the Worker rate-limits (proxy reports it as upstream 429)',
      respond: fail(502, { error: 'Verification email could not be sent.', upstream: 429 }),
      expect: 'THROTTLED',
    },
    {
      name: 'the proxy itself answers 429',
      respond: fail(429, { error: 'Too many requests.' }),
      expect: 'THROTTLED',
    },
    {
      name: 'AUTH_WORKER_SECRET is unset in the Pages environment',
      respond: fail(500, { error: 'Server misconfigured.' }),
      expect: 'ERROR',
    },
    {
      name: 'the Worker is unreachable',
      respond: fail(502, { error: 'Could not reach the mail service.' }),
      expect: 'ERROR',
    },
    {
      name: 'the token has expired',
      respond: fail(401, { error: 'Unauthorised.' }),
      expect: 'ERROR',
    },
    {
      name: 'the account has no email address',
      respond: fail(400, { error: 'Account has no email address.' }),
      expect: 'ERROR',
    },
  ];

  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      await prepare(page);
      await stubEndpoint(page, c.respond);

      const shown = await page.evaluate(async () => {
        try {
          await window.sendVerificationEmail(window.__user);
          return { sent: true };
        } catch (e) {
          return { sent: false, message: window.verificationMessageFor(e), status: e.status, upstream: e.upstream };
        }
      });

      expect(shown.sent).toBe(false);
      const expected = await page.evaluate(
        (k) => (k === 'THROTTLED' ? window.VERIFY_THROTTLED_MESSAGE : window.VERIFY_ERROR_MESSAGE),
        c.expect,
      );
      expect(shown.message).toBe(expected);
    });
  }

  test('a success reports the sent message and nothing else', async ({ page }) => {
    await prepare(page);
    await stubEndpoint(page, ok);
    const r = await page.evaluate(async () => {
      await window.sendVerificationEmail(window.__user);
      return window.VERIFY_SENT_MESSAGE;
    });
    expect(r).toBe('Sent. Check your inbox.');
  });
});
