# The paperback shop and the Calvary account: the hand-off

For the shop (books.calvaryscribblings.co.uk, the `calvaryprints` Worker). Written 24 Nov 2026 in
SHOP-B3. This note is the contract between the two codebases; the full design is
`docs/ACCOUNT-CONTRACT.md` §6.2 in the Calvary Scribblings repository.

The flow, in one line: after payment, the shop's confirmation page sends the reader to our page; the
reader signs in there and says yes or no; we send them back to the shop with a one-time code (or
without one); the shop's server then files the order with one signed call.

**Status.** The page (step 1) is live. The filing call (step 3) is built and committed but **not yet
deployed**; we say when it is. Until the reader's view of their orders ships (our round B4, with its
/privacy update), the filing call accepts **test orders only** (see §6).

---

## 1. Sending the reader to us

Link the reader to:

```
https://calvaryscribblings.co.uk/account/shop?return=<return>&state=<state>
```

- **`return`** must be exactly `https://books.calvaryscribblings.co.uk/account/return`. Percent-encode
  it in the query (`https%3A%2F%2Fbooks.calvaryscribblings.co.uk%2Faccount%2Freturn`) or send it
  raw; we decode once and compare character for character. Any other value (another path, a
  trailing slash, a query, another host, `http`) shows "This link can’t take you back to the shop."
  and **the reader is sent nowhere**. We never navigate to the `return` you send: we build the way
  back from our own copy of that address.
- **`state`** is yours, opaque to us, echoed back untouched: **1 to 128 characters, each one of
  `A–Z a–z 0–9 - . _ ~`**, present exactly once. Those characters need no encoding anywhere in a
  URL, so you get back exactly the characters you sent. Anything else is refused the same way.
  Tie it to the reader's tab (you set no cookies): the reader stays in the tab they started in
  (§1.1).

### 1.1 What the reader does on our page

- Signed in already: "Keep this order with your others?", with **Keep it** and **Not now**, and under
  it "Your Calvary account keeps the order number, date, titles and what you paid. Nothing else
  comes with it."
- Signed out: the same question above our sign-in (email or Google). A new email account goes
  straight on to the question (no "check your inbox" step on this page; the verification email
  still goes). A new account chooses its name, handle and date of birth first, on the same page.
  Google sign-in opens a pop-up, which closes itself and returns to the same tab (Ikenna is
  confirming this on iPad Safari). Apple sign-in is not on our website yet.

## 2. How the reader comes back to you

Always to `https://books.calvaryscribblings.co.uk/account/return`, in one of exactly two shapes:

| the reader chose | the address | what you do |
|---|---|---|
| **Keep it** | `…/account/return?code=<43 characters>&state=<your state>` | check `state`, then file the order with `code` (§3) |
| **Not now** | `…/account/return?state=<your state>` | check `state`; nothing to file |

- **Tell them apart by `code` alone:** present means the reader kept it; absent means they didn't.
- **Refuse any return whose `state` does not match the reader's own session in that tab**, with or
  without a code. Do not file anything for it.
- **A failure never comes back to you.** If we cannot make a code (refused, rate-limited, signed
  out, our error, or no answer within 20 seconds), our page says so and keeps **Not now** on screen,
  so the reader can always come back with the state and no code. No return ever carries an error or
  a reason.
- The code is 43 characters of `A–Z a–z 0–9 - _` (32 random bytes, base64url, no padding). It is good
  for **one** filing and for **5 minutes** from when the reader pressed Keep it. Send it to us from
  your server straight away; don't put it in logs or in a page another site can read (set
  `Referrer-Policy: no-referrer` on your return page).

## 3. Filing the order

```
POST https://calvaryscribblings.co.uk/api/account/shop-orders
Content-Type: application/json
X-Calvary-Key-Id: <your key id>
X-Calvary-Timestamp: <Unix seconds, decimal>
X-Calvary-Signature: <Ed25519 signature, base64url, no padding>

<body>
```

From your server only. No cookies, no browser, no ID token; the signature is the whole credential.

### 3.1 The signature

Sign these bytes with your Ed25519 private key: five lines, **each ended by `\n`** (one LF, no CR),
then the request body **byte for byte as you send it**:

```
calvary-shop-orders-v1\n
<key id>\n
<timestamp>\n
POST\n
/api/account/shop-orders\n
<body bytes>
```

- The timestamp is Unix seconds as a decimal string, the same string you send in
  `X-Calvary-Timestamp`. We refuse a call whose timestamp is **more than 300 seconds from our clock,
  either way**. Keep your Worker on real time (it is).
- The body is signed as raw bytes: sign the exact string you send, after JSON.stringify, not a
  re-serialisation. No query string on the URL (it is not covered by the signature; a call with one
  is refused).
- Send the 64-byte signature as base64url without padding.
- Every way the signature can fail (a missing header, an unknown key id, a bad signature, a time
  outside the window, a query string) gets the **same** refusal: `401 { "result": "signature_refused" }`.
- A replayed call inside the 5-minute window can only re-file the same order, which answers
  `already_filed` and changes nothing.

### 3.2 Key ids, and replacing a key

- A key's id is the **first 8 hex characters of the SHA-256 of its raw 32-byte public key**.
- Your key, as we hold it:
  - id **`b66e1054`**
  - raw (base64url) `JIt1JZ7k_B67fHpQCkanxZvZOAOMluLB6iIhzlMsUx4`
  - SPKI `MCowBQYDK2VwAyEAJIt1JZ7k/B67fHpQCkanxZvZOAOMluLB6iIhzlMsUx4=`
- We keep a list, and two keys can be valid at once. **To replace a key:** make the new pair in your
  Worker; send us **only the new public key** (raw or SPKI); we add it and deploy and tell you; you
  start signing with the new key and its id; you tell us; we remove the old one in a later deploy.
  Nothing breaks at any step. If a private key may have leaked, tell us and we remove its entry at
  once (calls signed with it start failing with `signature_refused`).
- The private key never leaves your Worker and is never sent to us.

### 3.3 The body

```json
{
  "code": "<the 43-character code from the return>",
  "order": {
    "orderNo": "CS-7KQ2MX",
    "paidAt": "2026-11-25T09:59:12Z",
    "titles": ["after-the-fact", "where-the-story-begins"],
    "copies": 3,
    "amount": { "value": 1500000, "currency": "NGN" },
    "test": true
  }
}
```

Exactly these fields, no others. Anything else is refused with `bad_request` naming the field.

| field | rule |
|---|---|
| `code` | the code exactly as it reached your return page, 43 characters |
| `orderNo` | `CS-` then six of `A–Z 0–9` (your example `CS-7KQ2MX`). Never trimmed or upper-cased for you |
| `paidAt` | when it was paid: ISO 8601 in UTC with a `Z` (`2026-11-25T09:59:12Z`, optional `.123`), a real date, not before 2026, not in the future. We store it as epoch milliseconds |
| `titles` | one or both of `after-the-fact`, `where-the-story-begins`, no repeats. A new book is a change on our side first: tell us before you sell it |
| `copies` | a whole number, 1 to 99: the copies in the order, as you count them |
| `amount.value` | what was paid, in whole **kobo** (₦15,000 is `1500000`), 100 to 1,000,000,000 |
| `amount.currency` | `"NGN"`, nothing else |
| `test` | `true` for your Paystack test mode, `false` for a real payment |

No address, name, email, phone or payment reference: none of those are accepted, and none are kept.
The account keeps the order number, the date, the titles, the copies, what was paid and whether it
was a test, plus when we filed it.

### 3.4 The replies

Every reply is JSON with a `result`. **Branch on `result`**, not on the status alone. Nothing in a
reply echoes the code, the order or the account.

| `result` | status | means | retry? |
|---|---|---|---|
| `filed` | 200 | filed to the reader's account | done |
| `already_filed` | 200 | already there: this code and order were filed before (your retry), or this account already holds this order | done (treat as success) |
| `code_used_for_another_order` | 409 | this code already filed a **different** order number | no |
| `code_expired` | 410 | the code's 5 minutes ran out before it was used | no; the reader can choose Keep it again from your confirmation page, which makes a new code |
| `code_unknown` | 404 | no such code (never made, or swept away) | no |
| `order_in_another_account` | 409 | this order number is already in a **different** Calvary account | no |
| `not_open_yet` | 403 | a real order (`test: false`) before we open (§6); nothing written, the code is left unused | no |
| `bad_request` | 400 | the body is wrong; `field` names which (`order.paidAt`, `order.address`, …) | no; fix the call |
| `signature_refused` | 401 | see §3.1 | no; check your signer, key id and clock |
| `too_many_calls` | 429 | over the limit for your key (60 a minute, 3,000 a day); `Retry-After` says when | yes, after `Retry-After` |
| `unavailable` | 503 | our own failure; `Retry-After: 30` | yes, the same call, a few times with backoff |

- **Retry only `too_many_calls` and `unavailable`** (and a network error or timeout with no reply at
  all). Retry with the **same code and the same order**, re-signed with a fresh timestamp.
- **A retry after a lost reply gets `already_filed`**, even after the code's 5 minutes: once used, the
  code is kept as a "used for order X" marker for 24 hours. So a lost reply is always safe to retry
  inside 24 hours.
- One order belongs to one account. If the same reader keeps the same order again (a second code),
  the answer is `already_filed` and nothing changes; the first filing stands.

## 4. The worked example

**A THROWAWAY key pair, made only for this example. It is not your key and is valid nowhere.** Use it
to check your signer: signing the bytes below with this private key must give exactly this signature
(Ed25519 signatures are deterministic).

- Public key, raw (base64url): `4ZgIF4MKpoevYvb4ceeZ2JmUy5ctDlUSg5NyKe_29tI`
- Public key, SPKI (base64): `MCowBQYDK2VwAyEA4ZgIF4MKpoevYvb4ceeZ2JmUy5ctDlUSg5NyKe/29tI=`
- Its key id (first 8 hex of SHA-256 of the raw 32 bytes): `b3642903`
- Private key, JWK `d` (base64url): `ae_ZbE0F1QKt-MP2MQ4uqRJzxmDcvbeOthRuwqWZf4U`
- Private key, PKCS#8 PEM:

```
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIGnv2WxNBdUCrfjD9jEOLqkSc8Zg3L23jrYUbsKlmX+F
-----END PRIVATE KEY-----
```

The body (238 bytes, exactly this, no trailing newline):

```
{"code":"q8Zr3vY1mXc0Lw9tB2nK5sJ7hD4fG6aP-eU_iO0yR1Q","order":{"orderNo":"CS-7KQ2MX","paidAt":"2026-11-25T09:59:12Z","titles":["after-the-fact","where-the-story-begins"],"copies":3,"amount":{"value":1500000,"currency":"NGN"},"test":true}}
```

The bytes signed (each line ends with one `\n`; the body follows the last one directly):

```
calvary-shop-orders-v1
b3642903
1795602000
POST
/api/account/shop-orders
{"code":"q8Zr3vY1mXc0Lw9tB2nK5sJ7hD4fG6aP-eU_iO0yR1Q","order":{"orderNo":"CS-7KQ2MX","paidAt":"2026-11-25T09:59:12Z","titles":["after-the-fact","where-the-story-begins"],"copies":3,"amount":{"value":1500000,"currency":"NGN"},"test":true}}
```

The signature (base64url):

```
Tks7SQXyh5mmJA_X_Thhb2yWSCpa43VpsJqzQKAa_eNBv73GdI4ccObAgIyNPA2R9ZOPeRMYU_kAwvmRSGB1Aw
```

The headers:

```
X-Calvary-Key-Id: b3642903
X-Calvary-Timestamp: 1795602000
X-Calvary-Signature: Tks7SQXyh5mmJA_X_Thhb2yWSCpa43VpsJqzQKAa_eNBv73GdI4ccObAgIyNPA2R9ZOPeRMYU_kAwvmRSGB1Aw
```

(1795602000 is 2026-11-25T10:20:00Z. Sent to us for real, this call would be refused: the key is not
on our list, and the time is long past.)

A signer in a Worker, for reference:

```js
const enc = new TextEncoder();
const key = await crypto.subtle.importKey('pkcs8', pkcs8Bytes, { name: 'Ed25519' }, false, ['sign']);
const body = JSON.stringify({ code, order });
const ts = String(Math.floor(Date.now() / 1000));
const head = enc.encode(`calvary-shop-orders-v1\n${KEY_ID}\n${ts}\nPOST\n/api/account/shop-orders\n`);
const bytes = new Uint8Array([...head, ...enc.encode(body)]);
const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, bytes));
const b64url = btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
await fetch('https://calvaryscribblings.co.uk/api/account/shop-orders', {
  method: 'POST', body,
  headers: { 'Content-Type': 'application/json', 'X-Calvary-Key-Id': KEY_ID, 'X-Calvary-Timestamp': ts, 'X-Calvary-Signature': b64url },
});
```

## 5. What we keep, and for how long

- In the reader's Calvary account: the order number, `paidAt`, the titles, the copies, the amount,
  `test`, and when we filed it. Nothing else.
- One order number belongs to one account.
- When the reader deletes their Calvary account, their orders go with it. We never learn anything
  that would let us reach your copy; our deletion wording (written with B4) will point readers to you
  for your own record of paid orders.

## 6. Test orders, and when real orders open

- **`test: true`** (your Paystack test mode) files like any real order and keeps `test: true`. We remove
  test orders **7 days** after filing.
- **Until we open, only test orders are accepted.** A real order (`test: false`) gets
  `403 { "result": "not_open_yet" }`: nothing is written and its code is left unused. We open with
  one switch in the round that shows readers their orders and updates our /privacy page. We'll tell
  you the day. Until then, keep sending real orders' readers back as normal; they just won't be
  filed yet.
