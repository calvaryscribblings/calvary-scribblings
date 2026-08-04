// Bookstore region lookup — Cloudflare Pages Function.
//
// GET /api/bookstore/region   →  200 { country }
//
// THE SINGLE GEOGRAPHY SOURCE for the bookstore. R8.3 uses it to pick a default currency;
// R8.4 (territory enforcement) will use it to decide whether a title may be sold at all. Those
// are very different jobs and it matters that they read the same answer, so this endpoint
// returns the RAW two-letter country and nothing else. It maps nothing to a currency and
// nothing to a licence: both of those are policy, they will disagree about edge cases, and a
// policy baked in here would be a policy R8.4 has to fight.
//
// WHERE THE COUNTRY COMES FROM. Cloudflare resolves the client's country at the edge and
// exposes it two ways: `request.cf.country` (a structured property on the incoming Request) and
// the `CF-IPCountry` header. They carry the same value. `cf` is preferred because it is the
// canonical form and cannot be spoofed by a client — an inbound header of that name is stripped
// and re-set by the edge — with the header as a fallback for the case where `cf` is absent,
// which is what happens under `wrangler dev` and in any local harness.
//
// WHEN NEITHER RESOLVES the answer is `null`, deliberately, and NOT a guessed country. A
// visitor Cloudflare cannot place is a visitor we do not know about; inventing 'GB' for them
// would be a lie that the currency selector would then present as a decision it had made about
// where they are. The client treats null as "no opinion" and keeps its default.
//
// Two values are also treated as unknown:
//   'XX'  Cloudflare's own code for "could not determine".
//   'T1'  a Tor exit node. The reader's real country is unknowable by construction.
//
// NO AUTH, NO BODY. It reveals nothing the caller does not already know — it is telling you
// where YOU are. It is therefore safe to call before sign-in, which is the whole point: the
// storefront needs a currency before it knows who is looking.
//
// UNCACHEABLE. The response is per-visitor by definition, so a shared cache holding one
// reader's country and serving it to the next is the one failure mode that matters. Cloudflare
// does not cache function responses by default, but `no-store` says so explicitly rather than
// relying on a default staying put — and it covers the browser cache too.

const UNKNOWN = new Set(['XX', 'T1']);

/**
 * The country from a Pages Function request, or null.
 *
 * Pure and exported so the harness can assert every branch without a Cloudflare edge: the
 * whole point of this endpoint is the branch it takes when geography is absent, and that is the
 * branch a live call can never exercise.
 */
export function countryFrom(request) {
  const raw = request?.cf?.country ?? request?.headers?.get?.('CF-IPCountry') ?? null;
  if (typeof raw !== 'string') return null;

  const code = raw.trim().toUpperCase();
  // ISO 3166-1 alpha-2, and nothing else. Anything of another shape is a header someone else
  // set, not something Cloudflare produced.
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (UNKNOWN.has(code)) return null;
  return code;
}

export async function onRequestGet(context) {
  return new Response(JSON.stringify({ country: countryFrom(context.request) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
