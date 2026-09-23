// THE EXPO PUSH API — the only code that talks to it. `fetchImpl` is injected so the suite can
// stand in for Expo; nothing here reads a credential from anywhere but its caller.
//
// ⚠ ENHANCED PUSH SECURITY. Once it is switched on for the project in Expo's dashboard, Expo
// refuses any send that does not carry the project's access token — which is the point: a
// leaked device token is then useless to anyone but the holder of EXPO_ACCESS_TOKEN. Until it
// is on, anyone holding a device's token can push to that device, and this header is merely
// accepted. See docs/PUSH-GO-LIVE.md.

export const SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

// Expo's documented ceiling is 600 notifications per second per project. One batch of 100 per
// second is a sixth of that, and the whole readership fits in a handful of batches.
export const BATCH_PAUSE_MS = 1000;
const RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, payload, { accessToken, fetchImpl = fetch, pause = sleep }) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastErr = err;
      await pause(2 ** attempt * 1000);
      continue;
    }
    // 429 and 5xx are Expo telling us to come back; anything else is our request being wrong,
    // and sending it again would be wrong again.
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Expo ${res.status}`);
      await pause(2 ** attempt * 1000);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      throw new Error(`Expo refused the request: HTTP ${res.status} ${JSON.stringify(json?.errors ?? json)}`);
    }
    if (Array.isArray(json.errors) && json.errors.length && json.data === undefined) {
      throw new Error(`Expo refused the request: ${JSON.stringify(json.errors)}`);
    }
    return json;
  }
  throw lastErr || new Error('Expo request failed');
}

/** One batch (≤100 messages). Resolves to the tickets, one per message, in order. */
export async function sendBatch(messages, opts) {
  const json = await post(SEND_URL, messages, opts);
  const tickets = Array.isArray(json.data) ? json.data : [json.data];
  if (tickets.length !== messages.length) {
    throw new Error(`Expo returned ${tickets.length} tickets for ${messages.length} messages`);
  }
  return tickets;
}

/** Receipts for ≤1000 ticket ids. Ids Expo has no receipt for yet are simply absent. */
export async function getReceipts(ids, opts) {
  if (!ids.length) return {};
  const json = await post(RECEIPTS_URL, { ids }, opts);
  return json.data || {};
}
