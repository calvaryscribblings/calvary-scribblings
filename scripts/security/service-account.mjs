// SECURITY-R1 — load the Firebase admin service account WITHOUT EVER PRINTING IT.
//
// Why this file exists. Three times (25 Sep, 17 Oct, 20 Oct 2026) a scratch script ran
//
//   JSON.parse(process.env.FIREBASE_SA_KEY)
//
// FIREBASE_SA_KEY is BASE64, not JSON, so the parse threw — and Node, on an uncaught
// SyntaxError from JSON.parse, prints the WHOLE INPUT as the "source line" of the error
// (`<anonymous_script>:1` followed by the full string). The truncated message under it
// ("Unexpected token ... is not valid JSON") makes it look as if only ten characters
// leaked. They didn't: the full private key went into the session each time.
//
// So: every parse of a credential happens here, inside a try/catch whose error names the
// SOURCE and never the value. Nothing in this file logs.
//
// Sources, first match wins:
//   1. a path in one of the given env vars (the workflows' COVERS_SERVICE_ACCOUNT etc.)
//   2. FIREBASE_SA_KEY — the Codespaces secret, BASE64 of the key file
//   3. FIREBASE_SERVICE_ACCOUNT — raw JSON (the GitHub Actions secret's format)
//   4. serviceAccountKey.json at the repo root (git-ignored; decoded from 2 by .devcontainer)

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parse credential text. On failure throws an error naming `source` — never the text. */
export function parseServiceAccount(text, source) {
  let sa;
  try {
    sa = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid service-account JSON (value withheld)`);
  }
  if (!sa || typeof sa !== 'object' || !sa.private_key || !sa.client_email) {
    throw new Error(`${source} parsed, but is not a service-account key (value withheld)`);
  }
  return sa;
}

/** FIREBASE_SA_KEY is base64 of the key file. Decode first, then parse. */
export function decodeBase64ServiceAccount(b64, source = 'FIREBASE_SA_KEY') {
  return parseServiceAccount(Buffer.from(String(b64).trim(), 'base64').toString('utf8'), `${source} (base64-decoded)`);
}

export function readServiceAccountFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  return parseServiceAccount(text, path);
}

/** The service account, from the first source present. `pathVars`: env vars that hold a PATH. */
export function loadServiceAccount({ pathVars = [], env = process.env } = {}) {
  for (const v of pathVars) if (env[v]) return readServiceAccountFile(env[v]);
  if (env.FIREBASE_SA_KEY) return decodeBase64ServiceAccount(env.FIREBASE_SA_KEY);
  if (env.FIREBASE_SERVICE_ACCOUNT) return parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT, 'FIREBASE_SERVICE_ACCOUNT');
  return readServiceAccountFile(join(ROOT, 'serviceAccountKey.json'));
}

/** The fields that may be printed. Everything else in a key is secret. */
export const publicFields = (sa) => ({
  project_id: sa.project_id,
  client_email: sa.client_email,
  private_key_id: sa.private_key_id,
});
