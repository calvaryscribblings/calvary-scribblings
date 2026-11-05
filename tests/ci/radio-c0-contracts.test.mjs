// RADIO-C0 (5 Nov 2026): the two contracts other repos build against, docs/RADIO-CONTRACT.md and
// docs/ACCOUNT-CONTRACT.md. They are public (the repo is public) and are read by other chats, so
// they may never hold a key, a secret, story text, a reader's details, a price or anyone's
// contract terms. This pins what a text check can: both are marked DRAFT until reviewed, and
// neither carries anything shaped like a credential, an email address, a uid or a price.
// It also pins the RADIO-C0 rulings into docs/COPY-RULINGS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const CONTRACTS = ['docs/RADIO-CONTRACT.md', 'docs/ACCOUNT-CONTRACT.md'];

// Lift this when Ikenna has reviewed a contract, and say so in the same commit.
test('both contracts are marked DRAFT until reviewed', () => {
  for (const p of CONTRACTS) {
    const head = read(p).split('\n').slice(0, 6).join('\n');
    assert.match(head, /\*\*DRAFT\. Not yet reviewed\.\*\*/, `${p} must open with the DRAFT line`);
  }
});

const FORBIDDEN = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a PEM private key'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/, 'a Stripe key'],
  [/\bAIza[0-9A-Za-z_-]{20,}/, 'a Google API key'],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/, 'an Anthropic key'],
  [/\bre_[A-Za-z0-9]{16,}/, 'a Resend key'],
  [/https:\/\/api\.cloudflare\.com\/client\/v4\/pages\/webhooks\/deploy_hooks\/[A-Za-z0-9-]+/, 'a deploy-hook URL'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a JWT'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, 'an email address'],
  [/(?<![A-Za-z0-9])[A-Za-z0-9]{28}(?![A-Za-z0-9])/, 'a Firebase uid-shaped string'],
  [/[£$€₦]\s?\d/, 'a price'],
];

test('neither contract carries a credential, an email, a uid or a price', () => {
  for (const p of CONTRACTS) {
    const text = read(p);
    for (const [re, what] of FORBIDDEN) assert.doesNotMatch(text, re, `${p} carries ${what}`);
  }
});

test('the RADIO-C0 rulings are logged, with the held and owed numbers', () => {
  const log = read('docs/COPY-RULINGS.md');
  const at = log.indexOf('## 4 Nov 2026 (Ikenna): Calvary Radio and the Calvary account, rulings 330–348 (RADIO-C0)');
  assert.ok(at >= 0, 'the RADIO-C0 section is missing');
  const section = log.slice(at);
  for (const n of ['332', '333', '334', '335', '336', '337', '345', '331 (in part)']) {
    assert.ok(section.includes(`- **${n}:**`), `ruling ${n} is missing`);
  }
  assert.match(section, /\*\*330, 344, and the rest of 331:\*\* ruled 4 Nov 2026 and held with Radio\./);
  assert.match(section, /\*\*338–343 and 346–348:\*\* \*\*Owed\.\*\*/);
});
