// THE PRICE BOOK — Stripe rail.
//
// CONFIG, NOT ENV, and deliberately. These identifiers are not secrets; they are the mapping
// from money to entitlement, and a wrong one charges a reader the wrong amount or gives them
// the wrong tier. That belongs in a diff somebody reviews, not in a dashboard variable nobody
// can see the history of. The secret key stays in env where it belongs.
//
// ── EVERY PRICE IS HAND-SET, PER CURRENCY ────────────────────────────────────────────────
//
// There is no FX rate here, in the endpoints, or in the webhook — the same rule the bookstore
// holds. £2.99 and $3.99 are two decisions, not one decision converted. The `amount` beside
// each id is the settled figure in minor units, and setup verifies the created Stripe Price
// against it: a Price whose amount has drifted from this table is refused rather than used,
// because the table is what the marketing page will quote.
//
// NGN IS ABSENT ON PURPOSE. Stripe cannot settle naira; the naira rail is Paystack Plans
// (R10.5). This file covers GBP and USD and nothing else.
//
// ── GENERATIONS, AND WHY BOTH TIERS EXIST FROM DAY ONE ───────────────────────────────────
//
// A Stripe Subscription stays on its Price forever unless something moves it, so grandfathering
// is achieved by never migrating a member off the generation they joined on. That much is easy.
//
// THE TRAP IS THE UPGRADE. A member on founding Gold who upgrades to Platinum through the
// customer portal lands on whatever Platinum price the portal offers — and if that is the
// then-current one, their founding lock has silently ended at the moment they gave us MORE
// money. The failure is invisible: nothing errors, the subscription is valid, and the member
// only finds out when they compare notes with someone who joined later.
//
// So FOUNDING PLATINUM MUST EXIST BEFORE THE FIRST FOUNDING GOLD IS SOLD, even though nobody
// will buy it on day one, and the portal configuration must offer ONLY the founding
// generation's prices. Both halves are load-bearing: the prices without the portal
// restriction still lets the portal offer current prices, and the portal restriction without
// the prices leaves it nothing to offer.
//
// When a second generation is introduced, ADD a block — never edit this one. Editing a price
// id here does not move a single existing subscription (they are pinned in Stripe), so an edit
// would only break the reverse lookup that decides what an incoming subscription IS, which is
// a far more confusing failure than a wrong number.

export const TIERS = ['gold', 'platinum'];
export const INTERVALS = ['monthly', 'annual'];
export const STRIPE_CURRENCIES = ['gbp', 'usd'];

// The settled figures, in minor units. Kept separate from the ids so the amounts can be
// asserted without Stripe existing, and so setup has something to verify against.
export const AMOUNTS = {
  gold:     { monthly: { gbp: 299, usd: 399 },  annual: { gbp: 2999, usd: 3999 } },
  platinum: { monthly: { gbp: 499, usd: 649 },  annual: { gbp: 4999, usd: 6499 } },
};

export const CURRENT_GENERATION = 'founding';

// ─────────────────────────────────────────────────────────────────────────────────────────
// PRICE IDS. Filled by `node scripts/create-founding-prices.mjs --apply`, which creates the
// Products and Prices in Stripe and prints this block ready to paste. null until then, and
// every caller fails loudly rather than falling back to an inline price — an inline price
// would work, would charge the right amount, and would be UNGRANDFATHERABLE, because there
// would be no shared Price object for a later generation to be distinguished from.
// ─────────────────────────────────────────────────────────────────────────────────────────
export const PRICE_BOOK = {
  founding: {
    test: {
      gold:     { monthly: { gbp: 'price_1U1QJB0BtuEAyw2trDPzxZJp', usd: 'price_1U1QJB0BtuEAyw2tFttQ51eW' }, annual: { gbp: 'price_1U1QJC0BtuEAyw2tWvhWAamB', usd: 'price_1U1QJC0BtuEAyw2tueliuaeJ' } },
      platinum: { monthly: { gbp: 'price_1U1QJC0BtuEAyw2tbF9hWv0D', usd: 'price_1U1QJD0BtuEAyw2tWkJKBSjH' }, annual: { gbp: 'price_1U1QJD0BtuEAyw2tmJTCwn6o', usd: 'price_1U1QJE0BtuEAyw2t0w3NYJcT' } },
    },
    live: {
      gold:     { monthly: { gbp: null, usd: null }, annual: { gbp: null, usd: null } },
      platinum: { monthly: { gbp: null, usd: null }, annual: { gbp: null, usd: null } },
    },
  },
};

// The portal configuration id, also created by setup. It restricts the portal to the founding
// generation's prices — see the trap above. Without it the portal offers whatever the Product
// currently has, which is exactly how the lock ends.
export const PORTAL_CONFIGURATION = { founding: { test: 'bpc_1U1QJE0BtuEAyw2tQGwmXOle', live: null } };

/** Which mode a secret key belongs to. Stripe's own prefix is the only honest signal. */
export const modeOf = (secretKey) =>
  (typeof secretKey === 'string' && secretKey.startsWith('sk_live')) ? 'live' : 'test';

/**
 * The Price id for a tier/interval/currency, or null if this generation is not configured.
 * Callers must treat null as "membership is not set up yet" and say so, never as "use an
 * inline price".
 */
export function priceIdFor({ tier, interval, currency, generation = CURRENT_GENERATION, mode = 'test' }) {
  const gen = PRICE_BOOK[generation];
  if (!gen || !gen[mode]) return null;
  const t = gen[mode][tier];
  if (!t || !t[interval]) return null;
  return t[interval][String(currency || '').toLowerCase()] || null;
}

export function amountFor({ tier, interval, currency }) {
  const t = AMOUNTS[tier];
  if (!t || !t[interval]) return null;
  const a = t[interval][String(currency || '').toLowerCase()];
  return Number.isInteger(a) ? a : null;
}

/**
 * THE REVERSE LOOKUP, and the piece the founding lock actually turns on.
 *
 * Given the Price id on an incoming subscription, say what it IS. The webhook uses it twice:
 * to learn the tier a subscription confers without trusting anything on the event, and to
 * decide whether the member is still on a founding price after an upgrade.
 *
 * Returns null for an unknown id — a price created by hand in the dashboard, or a generation
 * this build predates. The webhook treats that as "cannot attribute" and refuses to guess a
 * tier from it, because guessing would either hand out Platinum or take away Gold.
 */
export function describePrice(priceId, mode = 'test') {
  if (typeof priceId !== 'string' || !priceId) return null;
  for (const [generation, byMode] of Object.entries(PRICE_BOOK)) {
    const book = byMode[mode];
    if (!book) continue;
    for (const tier of Object.keys(book)) {
      for (const interval of Object.keys(book[tier])) {
        for (const [currency, id] of Object.entries(book[tier][interval])) {
          if (id && id === priceId) return { generation, tier, interval, currency };
        }
      }
    }
  }
  return null;
}

/** Is this price part of the generation that carries the founding lock? */
export function isFoundingPrice(priceId, mode = 'test') {
  const d = describePrice(priceId, mode);
  return !!d && d.generation === 'founding';
}

/** Every configured price id for a generation — what the portal configuration is built from. */
export function priceIdsForGeneration(generation = CURRENT_GENERATION, mode = 'test') {
  const book = PRICE_BOOK[generation] && PRICE_BOOK[generation][mode];
  if (!book) return [];
  const out = [];
  for (const tier of Object.keys(book)) {
    for (const interval of Object.keys(book[tier])) {
      for (const id of Object.values(book[tier][interval])) if (id) out.push(id);
    }
  }
  return out;
}

/** Is the rail configured at all? Endpoints use this to answer honestly instead of 500ing. */
export function isConfigured(mode = 'test', generation = CURRENT_GENERATION) {
  return priceIdsForGeneration(generation, mode).length
    === TIERS.length * INTERVALS.length * STRIPE_CURRENCIES.length;
}
