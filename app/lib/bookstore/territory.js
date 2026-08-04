// TERRITORY RESTRICTIONS — R8.4.
//
// A publisher licenses a book for a set of countries. `territoriesAllowed` has been on every
// title record since the schema was written and, until this round, nothing read it: the field
// was a promise the shop had not kept. This module is where the promise becomes a decision.
//
// PLAIN ESM, NO BROWSER, NO REACT, NO CLOCK, NO NETWORK. Both halves of the enforcement need
// it — the storefront (which marks a title) and the two checkout endpoints (which refuse to
// sell one) — and those run in a bundler and in a Workers runtime respectively. The only way
// the shelf and the till can agree about a licence is for them to run the same function, so
// this file must import nothing that either of them cannot load. (countries.js is a frozen
// object literal and two string helpers; it loads anywhere this does.)
//
// ── RIGHTS ARE USUALLY WRITTEN AS EXCLUSIONS ───────────────────────────────────────────────
// A publishing contract almost never reads like an allow-list. It reads "World excluding North
// America", or "UK & Commonwealth" — the grantable world minus a carve-out somebody else
// already bought. An allow-list can express that, but only by enumerating 250-odd countries
// and then maintaining that enumeration forever, which is a licence stored as a transcription
// error waiting to happen. So there are THREE modes, and the matcher is written against them
// rather than against the storage:
//
//   WORLDWIDE  no restriction. Sells everywhere. What all four live titles are today.
//   DENY       sells everywhere EXCEPT these countries. "World excluding North America".
//   ALLOW      sells in exactly these countries and nowhere else. "UK & Ireland only".
//
// ── THE SHAPE ON DISK ──────────────────────────────────────────────────────────────────────
// TWO FIELDS, and TITLE_SCHEMA stays locked at v2. `territoriesExcluded` is schema-external —
// the samplePath / glossary / catalogueNumber precedent: a field the loader passes through
// untouched, validated at the point of write in app/lib/bookstore/admin-writes.js rather than
// by a schema bump and a migration nothing would migrate.
//
//   worldwide         territoriesAllowed '*',              no territoriesExcluded
//   worldwide-except  territoriesAllowed '*',              territoriesExcluded ['CA','US']
//   only-in           territoriesAllowed ['GB','NG'],      no territoriesExcluded
//
// NO MIGRATION. Absent territoriesExcluded means none, which is what every existing record
// already says by saying nothing. All four live titles ('*', no exclusions) behave in R8.4
// exactly as they did in R8.3.
//
// AN ALLOW-LIST TOGETHER WITH EXCLUSIONS IS REJECTED AT WRITE TIME (see assertTerritories
// below) because an allow-list already says everything there is to say: it names the complete
// set of countries the licence covers. Exclusions on top of it are not additive, they are
// ambiguous — is ['GB','NG'] excluding ['NG'] a licence for Britain, or an editor who ticked
// the wrong box and means to sell in both? Neither reading is safer than the other, so the
// combination never gets stored. normaliseTerritories still has to ANSWER for one, because a
// console hand-edit can create what the writer refuses; it resolves it the only way a licence
// may be resolved when its meaning is unclear, which is by the most restrictive reading.
//
// ── MISSING MEANS WORLDWIDE, NOT NOWHERE ───────────────────────────────────────────────────
// Absent, empty, or unreadable normalises to worldwide. A title written before the field
// existed, or one whose value a bad migration flattened, must not silently become unsellable
// everywhere — that is a shop that quietly stops taking money, which is the failure nobody
// notices until the month's sales are counted. A restriction is a positive claim: it applies
// when someone has actually made it. (The one exception is the contradictory pair above, where
// a restriction demonstrably WAS made and only its meaning is in doubt.)
//
// The rules do not help here and must not be relied on: database.rules.json validates only
// `isString() || hasChildren()` on territoriesAllowed — '' passes, 'worldwide' passes, an
// object of anything passes — and it does not know territoriesExcluded exists at all. schema.js
// is stricter but runs in the admin client, and a hand-edit in the Firebase console never meets
// it. Everything below treats the stored value as untrusted input.

import { countryPhrase, joinNames, isKnownCountry } from './countries.js';

/** The sentinel a title carries when it is licensed everywhere. */
export const WORLDWIDE = '*';

/** The canonical modes. Exported so callers switch on a constant, not on a bare string. */
export const MODE_WORLDWIDE = 'worldwide';
export const MODE_ALLOW = 'allow';
export const MODE_DENY = 'deny';

// ── THE NULL-COUNTRY DECISION, in one constant ─────────────────────────────────────────────
//
// Cloudflare cannot always place a visitor: a Tor exit node, a corporate egress it has no
// record of, a preview deployment with no edge in front of it. region.js reports that honestly
// as `null` rather than guessing. This constant is what the shop does with that answer for a
// title that is restricted AT ALL — allow-list or deny-list alike, because both are licences
// with an outside.
//
// It is FALSE — an undetermined country does not get to buy a restricted title. The asymmetry
// is deliberate and it only ever runs in one direction:
//
//   worldwide title + unknown country  →  SELLS. Unaffected by this constant. That is nearly
//                                         the whole catalogue, so nearly every reader whose
//                                         geography we cannot read is inconvenienced not at all.
//   restricted title + unknown country →  REFUSED. A licence is a contract with a publisher
//                                         about where their book may be sold. An unreadable
//                                         geography is not evidence that the reader is inside
//                                         the licence; selling on it would breach the contract
//                                         on a guess, and the cost of being wrong is borne by
//                                         the publisher, not by us.
//
// It applies to DENY exactly as to ALLOW, and for the same reason: "not known to be in the
// carve-out" is not the same claim as "known to be outside it".
//
// The reader is not stranded: they see an honest refusal rather than a broken checkout, and a
// title they genuinely may buy is one support message away.
//
// FLIP IT HERE, IN ONE EDIT, if that trade ever stops being the right one — set it to true and
// every call site follows, client and server, because they all read isSellableIn().
export const SELL_TO_UNKNOWN_COUNTRY = false;

const ALPHA2 = /^[A-Z]{2}$/;

/**
 * A single value from a stored territories list, uppercased, or null if it is not a country
 * code. Anything that is not an alpha-2 string is dropped rather than coerced — a list
 * containing 'United Kingdom' is a list someone got wrong, and inventing 'UN' from it would
 * turn a data error into a wrong licence.
 */
function asCountry(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return ALPHA2.test(code) ? code : null;
}

/**
 * The codes in a stored list, deduplicated, uppercased and sorted, so that two spellings of one
 * licence compare equal.
 *
 * RTDB IS WHY THE OBJECT BRANCH EXISTS. The Realtime Database stores an array with a hole in it
 * as an object keyed by index, and the REST API hands it back that way — so a list written as
 * ['GB','NG'] can be read as { '0': 'GB', '1': 'NG' }, or as { '1': 'NG' } if index 0 was ever
 * deleted. Both are the same licence and both must read as it.
 *
 * A STRING is read as a separated list: 'GB,NG' and 'GB NG' both mean those two countries. That
 * is not a shape the admin writes, but it is the shape a hand-edit in the Firebase console
 * produces, the rules accept it, and reading it as "a restriction someone meant" is truer than
 * discarding it.
 */
function codesIn(value) {
  let raw;
  if (typeof value === 'string') raw = value.split(/[,;\s]+/);
  else if (Array.isArray(value)) raw = value;
  else if (value && typeof value === 'object') raw = Object.values(value);
  else return [];

  const codes = [];
  for (const entry of raw) {
    const code = asCountry(entry);
    if (code && !codes.includes(code)) codes.push(code);
  }
  codes.sort();
  return codes;
}

const freeze = (mode, countries) => Object.freeze({ mode, countries: Object.freeze(countries) });
const WORLDWIDE_FORM = freeze(MODE_WORLDWIDE, []);

/**
 * The canonical form of a title's rights: `{ mode, countries }`, frozen.
 *
 * A frozen object rather than the raw fields, so a caller cannot accidentally test the sentinel
 * by hand and get the empty-list case wrong, and so the matcher below has three branches
 * instead of a decision tree over two loosely-typed fields.
 *
 * @param allowed  the stored territoriesAllowed  ('*' | array | anything)
 * @param excluded the stored territoriesExcluded (array | absent)
 *
 * WORLDWIDE IS THE ANSWER FOR: '*' with no exclusions, any missing or null allowed value, an
 * empty array or object, a list whose entries are all unusable, and any value of a type this
 * field should never hold. See the header for why the fallback points that way.
 */
export function normaliseTerritories(allowed, excluded) {
  const denied = codesIn(excluded);
  const isWorldwide = typeof allowed === 'string' ? allowed.trim() === WORLDWIDE : allowed == null;
  const permitted = isWorldwide ? [] : codesIn(allowed);

  if (permitted.length === 0) {
    // No allow-list: either the sentinel, or nothing readable. Exclusions, if any, are the
    // whole restriction.
    return denied.length ? freeze(MODE_DENY, denied) : WORLDWIDE_FORM;
  }

  if (denied.length === 0) return freeze(MODE_ALLOW, permitted);

  // ── THE CONTRADICTORY PAIR ───────────────────────────────────────────────────────────────
  // An allow-list AND exclusions. assertTerritories refuses to store this, so reaching here
  // means a hand-edit outside the admin. It is resolved by INTERSECTION — the allow-list minus
  // anything explicitly excluded — because that is the only reading that cannot sell into a
  // country either field says no to, and a licence whose meaning is unclear must fail towards
  // not selling.
  //
  // Note the empty result is kept as an EMPTY ALLOW-LIST, not folded into worldwide. Everywhere
  // else in this file an empty restriction means "no restriction was made"; here a restriction
  // demonstrably was made and it happens to permit nothing, which is a different fact and must
  // not invert into selling everywhere.
  return freeze(MODE_ALLOW, permitted.filter((c) => !denied.includes(c)));
}

/** The canonical form for a whole title record, which is how every call site holds it. */
export function territoriesOf(title) {
  return normaliseTerritories(title?.territoriesAllowed, title?.territoriesExcluded);
}

const isCanonical = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && (v.mode === MODE_WORLDWIDE || v.mode === MODE_ALLOW || v.mode === MODE_DENY)
  && Array.isArray(v.countries);

/**
 * May this licence be sold into this country?
 *
 * @param territories a canonical form from normaliseTerritories(), OR a raw territoriesAllowed
 *        value for the common case where there are no exclusions to consider. The canonical
 *        form is detected by its `mode`; nothing the database stores has that shape.
 * @param country     an alpha-2 code, or null when geography could not be determined.
 * @returns boolean — never null, never undefined. Every caller of this is about to either take
 *          money or refuse to, and neither is a decision that can be deferred.
 *
 * WRITTEN AGAINST THE CANONICAL FORM, NOT THE STORAGE. The three branches are the three modes;
 * a future fourth storage shape is a change to normaliseTerritories and to nothing else.
 *
 * THE NULL-COUNTRY ASYMMETRY, stated once more at the point of use because this is the line
 * that implements it: a worldwide title sells to an unknown country (there is no licence to
 * breach), a restricted one does not (an unreadable geography is not proof of being inside the
 * licence, and the publisher carries the cost of a wrong guess). The choice itself lives in
 * SELL_TO_UNKNOWN_COUNTRY above and is flipped there, in one edit.
 *
 * Case-insensitive on the country: 'gb', 'Gb' and 'GB' are one country.
 */
export function isSellableIn(territories, country) {
  const t = isCanonical(territories) ? territories : normaliseTerritories(territories, null);
  if (t.mode === MODE_WORLDWIDE) return true;

  const code = asCountry(country);
  if (code === null) return SELL_TO_UNKNOWN_COUNTRY;

  if (t.mode === MODE_DENY) return !t.countries.includes(code);
  return t.countries.includes(code);
}

/** The same question asked of a whole title record. The form every call site actually uses. */
export function isTitleSellableIn(title, country) {
  return isSellableIn(territoriesOf(title), country);
}

// ── WRITE-TIME VALIDATION ──────────────────────────────────────────────────────────────────

/**
 * Is this pair of fields storable? Returns { ok } or { ok:false, error } with a message written
 * for the editor who is about to see it, not for a log.
 *
 * Lives here rather than in admin-writes.js so that the rules about what a licence may look
 * like sit beside the rules about what one MEANS — and so the write path and the test suite
 * assert the same function. admin-writes.js calls it; nothing else may write these fields.
 */
export function assertTerritories(allowed, excluded) {
  const hasExclusions = excluded !== undefined && excluded !== null;
  const allowedIsWorldwide = allowed === WORLDWIDE;

  // Codes are checked against the ISO table, not merely against /^[A-Z]{2}$/. A shape check
  // would accept 'ZZ' and 'QQ', and a licence naming a country that does not exist is a licence
  // no matcher can ever satisfy — it would simply never sell, silently, to anyone.
  const badCode = (list) => {
    for (const c of list) {
      if (asCountry(c) !== c) return `“${String(c)}” is not a two-letter country code.`;
      if (!isKnownCountry(c)) return `“${c}” is not an ISO country code.`;
    }
    return null;
  };

  if (!allowedIsWorldwide) {
    if (!Array.isArray(allowed) || allowed.length === 0) {
      return { ok: false, error: 'Choose “Sold worldwide”, or name at least one country.' };
    }
    const bad = badCode(allowed);
    if (bad) return { ok: false, error: bad };
    if (new Set(allowed).size !== allowed.length) {
      return { ok: false, error: 'The same country is listed twice.' };
    }
  }

  if (hasExclusions) {
    if (!Array.isArray(excluded) || excluded.length === 0) {
      // Never null, never [] — an empty exclusion list is "no exclusions", and that is said by
      // omitting the field. Storing an empty array would leave a shape the reader has to
      // interpret and the next editor has to wonder about.
      return { ok: false, error: 'Leave the exclusions off entirely rather than empty.' };
    }
    const bad = badCode(excluded);
    if (bad) return { ok: false, error: bad };
    if (new Set(excluded).size !== excluded.length) {
      return { ok: false, error: 'The same excluded country is listed twice.' };
    }
    if (!allowedIsWorldwide) {
      return {
        ok: false,
        error: 'A country list already says where the book may be sold — remove the exclusions, or switch to “Worldwide, except…”.',
      };
    }
  }

  return { ok: true };
}

// ── THE ADMIN FORM'S SHAPE ─────────────────────────────────────────────────────────────────
//
// The database holds a PAIR of fields; the form holds a MODE and ONE list. These two functions
// are the only place that conversion happens, in either direction, which is what makes a round
// trip through /admin/bookstore lossless and testable without a browser.
//
// ONE LIST, NOT TWO, in the form. An allow-list and exclusions can never both apply — that
// combination is precisely what assertTerritories refuses — and a form able to hold an
// impossible state is a form that will eventually be saved in one.

/** A stored title's rights, as the admin form holds them: { mode, countries }. */
export function territoriesToForm(title) {
  const allowed = Array.isArray(title?.territoriesAllowed) ? [...title.territoriesAllowed] : [];
  const excluded = Array.isArray(title?.territoriesExcluded) ? [...title.territoriesExcluded] : [];
  // An allow-list wins the mode question because it is the only field that can pose one:
  // exclusions exist only alongside '*'.
  if (allowed.length) return { mode: MODE_ALLOW, countries: allowed };
  if (excluded.length) return { mode: MODE_DENY, countries: excluded };
  return { mode: MODE_WORLDWIDE, countries: [] };
}

/**
 * The form's state back into the stored pair.
 *
 * territoriesExcluded is ALWAYS PRESENT, `[]` when unused, never omitted. The write path
 * spreads the existing record, so a key left out of the payload keeps whatever was there
 * before — and an edit that switches a title from "Worldwide, except…" back to "Sold
 * worldwide" has to be able to say so. normaliseTerritoryFields in admin-writes.js turns the
 * empty array into a deleted key on the way to the database.
 */
export function territoriesFromForm(mode, countries) {
  const list = Array.isArray(countries) ? [...countries] : [];
  return {
    territoriesAllowed: mode === MODE_ALLOW ? list : WORLDWIDE,
    territoriesExcluded: mode === MODE_DENY ? list : [],
  };
}

// ── PRESET GROUPS ──────────────────────────────────────────────────────────────────────────
//
// The formulations that actually appear in contracts, as one tap each.
//
// A PRESET IS A FILLER, NOT A VALUE. Choosing one EXPANDS INTO EXPLICIT COUNTRY CODES in the
// form, and it is those codes that are stored — never the preset's name, never a reference to
// it. This is the whole point and it is not a convenience decision:
//
//   A title's rights must mean, in five years, exactly what they meant on the day they were
//   agreed. If 'EU' were stored as 'EU' and this list were later corrected — a member joins, a
//   member leaves, someone decides the group should include the EEA — every title carrying that
//   name would silently acquire different rights than the ones its contract granted. Nobody
//   would see it happen. Codes are a snapshot of a decision; a group name is a live reference
//   to a definition somebody else may edit.
//
// So these lists may be freely corrected: a change here affects only what the NEXT editor is
// offered, and can never reach a title already saved.
export const TERRITORY_PRESETS = Object.freeze([
  Object.freeze({ key: 'north-america', label: 'North America', codes: Object.freeze(['CA', 'MX', 'US']) }),
  Object.freeze({ key: 'uk-ireland', label: 'UK & Ireland', codes: Object.freeze(['GB', 'IE']) }),
  Object.freeze({
    key: 'eu',
    label: 'European Union',
    codes: Object.freeze([
      'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
      'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
    ]),
  }),
  Object.freeze({
    key: 'uk-commonwealth',
    label: 'UK & Commonwealth',
    codes: Object.freeze([
      'AG', 'AU', 'BB', 'BD', 'BN', 'BS', 'BW', 'BZ', 'CA', 'CM', 'CY', 'DM', 'FJ', 'GA',
      'GB', 'GD', 'GH', 'GM', 'GY', 'IN', 'JM', 'KE', 'KI', 'KN', 'LC', 'LK', 'LS', 'MU',
      'MV', 'MW', 'MY', 'MZ', 'NA', 'NG', 'NR', 'NZ', 'PG', 'PK', 'RW', 'SB', 'SC', 'SG',
      'SL', 'SZ', 'TG', 'TO', 'TT', 'TV', 'TZ', 'UG', 'VC', 'VU', 'WS', 'ZA', 'ZM',
    ]),
  }),
]);

// ── THE MARKING VOCABULARY ─────────────────────────────────────────────────────────────────
// R8.3 put the currency mark's words in one place (fallbackNote / fallbackSentence in
// currency.js) so the shelf and the detail page could not drift into saying different things
// about the same fact. The territory mark gets the same treatment and the same register:
// lower case, no punctuation, a fact rather than a warning.

/** Beneath the book on the shelf, in the currency mark's place and its exact quiet register. */
export const TERRITORY_NOTE = 'not sold in your region';

/** Beneath the buy button on the detail page, where the fuller currency sentence goes. */
export const TERRITORY_SENTENCE = 'This title isn’t licensed for sale in your region.';

/**
 * What the buy button reads when it cannot be pressed. NOT a price, and not "Sold out" — the
 * book is not sold out, it is not on sale here, and the catalogue says what it means.
 */
export const UNAVAILABLE_LABEL = 'Unavailable here';

/**
 * A title's rights IN PLAIN WORDS: "Sold worldwide except the United States and Canada".
 *
 * The same renderer serves the admin form's live summary (above the save button, so a mis-tick
 * is visible before it is stored) and the admin list's rights column (so an editor sees at a
 * glance what they saved). One renderer, because the point of showing rights back is that they
 * read the same in both places — a summary that agreed with the form but not with the list
 * would be worse than no summary.
 */
export function describeTerritories(allowed, excluded) {
  const t = normaliseTerritories(allowed, excluded);
  if (t.mode === MODE_WORLDWIDE) return 'Sold worldwide';
  const names = joinNames(t.countries.map(countryPhrase));
  if (t.mode === MODE_DENY) return `Sold worldwide except ${names}`;
  // The contradictory pair resolved down to nothing. Say so plainly rather than printing
  // "Sold only in " and trailing off.
  if (t.countries.length === 0) return 'Not sold anywhere — these rights contradict each other';
  return `Sold only in ${names}`;
}
