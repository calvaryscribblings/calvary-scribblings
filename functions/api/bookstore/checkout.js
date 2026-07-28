// Bookstore checkout — Cloudflare Pages Function.
//
// POST /api/bookstore/checkout   body: { idToken, titleId, currency }
//   → 200 { url }   a Stripe Checkout Session URL to send the browser to
//
// THE TWO RULES THIS ENDPOINT EXISTS TO ENFORCE, both of which fail silently and
// expensively if broken:
//
//   1. The uid comes from a VERIFIED Firebase ID token, never from the request body.
//      The uid ends up as client_reference_id, which is what the webhook trusts when it
//      writes bookstore_purchases/{uid}/{titleId}. A body-supplied uid would let anyone
//      buy a book into anyone else's library — or, worse, claim one into their own.
//      functions/api/open-pages/moderate.js does take uid from the body and documents why
//      it is tolerable there (rules are the real boundary, worst case is misattribution).
//      That reasoning does not transfer to money. Do not copy it here.
//
//   2. The price comes from bookstore_titles/{titleId}.prices[currency], read server-side.
//      A client-supplied amount is a client-supplied discount.
//
// Auth pattern is functions/api/record-attempt.js verbatim: an Identity Toolkit
// accounts:lookup round-trip keyed by NEXT_PUBLIC_FIREBASE_API_KEY. That name looks alarming
// for a server file — it is not a secret. Firebase Web API keys are public project
// identifiers, shipped in every client bundle; they identify the project for the lookup and
// grant nothing. The id token in the body is the credential, and it is what gets verified.
//
// No Stripe SDK — the Workers runtime cannot pull it in without bundling, and the REST API
// is form-encoded and stable. Same reasoning as the hand-rolled signature check in
// stripe-webhook.js.

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const TITLES_PATH = 'bookstore_titles';
const PUBLISHERS_PATH = 'bookstore_publishers';

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

// Return origin for Stripe's redirects. Overridable so a Pages preview deployment sends the
// reader back to the preview rather than to production mid-test; production needs no var.
const DEFAULT_ORIGIN = 'https://calvaryscribblings.co.uk';

// R5 sells in GBP only — the storefront displays £ and nothing else yet. USD is accepted at
// the API because the price data already carries it and R9 turns on the display toggle.
// NGN is deliberately absent: Stripe cannot settle it, and the R9 work routes NGN through
// Paystack instead (hence the payout-provider field already on the publisher record).
const ALLOWED_CURRENCIES = new Set(['gbp', 'usd']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyToken(token, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.localId ?? null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const fbDb = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.STRIPE_SECRET_KEY) {
    console.error('[bookstore/checkout] STRIPE_SECRET_KEY is not set');
    return json({ error: 'Purchasing is not configured yet. Please try again later.' }, 500);
  }
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error('[bookstore/checkout] NEXT_PUBLIC_FIREBASE_API_KEY is not set');
    return json({ error: 'Purchasing is not configured yet. Please try again later.' }, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { idToken, titleId, currency } = body || {};

  if (!idToken || typeof idToken !== 'string') return json({ error: 'Sign in to buy this book.' }, 401);
  if (!titleId || typeof titleId !== 'string') return json({ error: 'titleId required.' }, 400);

  const cur = typeof currency === 'string' ? currency.toLowerCase() : '';
  if (!ALLOWED_CURRENCIES.has(cur)) {
    return json({ error: 'Unsupported currency.' }, 400);
  }

  // ── identity ───────────────────────────────────────────────────────────────
  const uid = await verifyToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.' }, 401);

  // ── the title, and its price ───────────────────────────────────────────────
  // bookstore_titles is world-readable (database.rules.json), so this needs no credential.
  let title;
  try {
    const res = await fetch(`${fbDb}/${TITLES_PATH}/${encodeURIComponent(titleId)}.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    title = await res.json();
  } catch (e) {
    console.error('[bookstore/checkout] title read failed:', e.message || e);
    return json({ error: 'Could not reach the catalogue. Please try again.' }, 502);
  }

  if (!title || typeof title !== 'object') return json({ error: 'That title is not in the catalogue.' }, 404);
  if (title.status !== 'published') return json({ error: 'That title is not on sale.' }, 403);

  // Defence in depth, mirroring filterByActivePublisher in app/lib/bookstore/loader.js:
  // every public read already hides titles from a suspended publisher, and checkout must not
  // become the one path that ignores the /admin/publishers suspension cascade. Fail OPEN on a
  // read error, matching the loader's documented behaviour — a transient Firebase blip should
  // not stop sales — but fail CLOSED on a definite non-active status.
  if (title.publisherId) {
    try {
      const pres = await fetch(`${fbDb}/${PUBLISHERS_PATH}/${encodeURIComponent(title.publisherId)}.json`);
      if (pres.ok) {
        const pub = await pres.json();
        if (pub && pub.status && pub.status !== 'active') {
          return json({ error: 'That title is not on sale.' }, 403);
        }
      }
    } catch {
      // fall through — see above
    }
  }

  const unitAmount = title.prices?.[cur];
  if (!Number.isInteger(unitAmount) || unitAmount <= 0) {
    console.error(`[bookstore/checkout] title ${titleId} has no usable ${cur} price:`, unitAmount);
    return json({ error: 'This title has no price in that currency.' }, 409);
  }

  // ── the Stripe session ─────────────────────────────────────────────────────
  const slug = typeof title.slug === 'string' && title.slug ? title.slug : titleId;

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('client_reference_id', uid);
  form.set('success_url', `${origin}/bookstore/${slug}?purchase=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/bookstore/${slug}?purchase=cancelled`);

  form.set('metadata[uid]', uid);
  form.set('metadata[titleId]', titleId);

  // The same pair on the PaymentIntent. Stripe copies PaymentIntent metadata onto the
  // Charge, which is the only way charge.refunded / charge.dispute.created reach the webhook
  // carrying enough identity to find the purchase they need to revoke. Session metadata alone
  // does not propagate that far.
  form.set('payment_intent_data[metadata][uid]', uid);
  form.set('payment_intent_data[metadata][titleId]', titleId);

  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', cur);
  form.set('line_items[0][price_data][unit_amount]', String(unitAmount));
  form.set('line_items[0][price_data][product_data][name]', String(title.title || 'Untitled'));
  if (typeof title.author === 'string' && title.author.trim()) {
    form.set('line_items[0][price_data][product_data][description]', `by ${title.author.trim()}`);
  }
  // Stripe rejects the whole session on a non-https image, so a bad cover must not be able to
  // block a sale — it is dropped instead.
  if (typeof title.coverUrl === 'string' && title.coverUrl.startsWith('https://')) {
    form.set('line_items[0][price_data][product_data][images][0]', title.coverUrl);
  }

  let session;
  try {
    const res = await fetch(STRIPE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    session = await res.json();
    if (!res.ok) {
      const msg = session?.error?.message || `HTTP ${res.status}`;
      console.error(`[bookstore/checkout] Stripe session create failed for ${titleId}:`, msg);
      return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
    }
  } catch (e) {
    console.error('[bookstore/checkout] Stripe request failed:', e.message || e);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  if (!session?.url) {
    console.error('[bookstore/checkout] Stripe returned a session with no url:', session?.id);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  console.log(`[bookstore/checkout] session ${session.id} uid=${uid} titleId=${titleId} ${cur}/${unitAmount}`);
  return json({ url: session.url });
}
