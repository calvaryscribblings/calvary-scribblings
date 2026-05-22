// Bookstore schema definitions and validators (v2).
// Shape-only validation: referential integrity (publisherId existence) is the loader's job.
//
// v2 changes (from v1):
//   - coverUrl and epubPath may be null for drafts/unpublished titles. Required for 'published'.
//     Empty string '' is rejected in either status — forces an explicit null.
//   - migrateTitle in loader.js promotes legacy v1 docs (empty-string assets) to v2 (null assets).
//
// Currency keys are lowercase ISO-4217 internally (gbp, ngn, usd) to match Stripe convention.
// Normalise to uppercase only at integration boundaries (Paystack, accounting exports, publisher reports).
//
// Prices stored as integer minor units. GBP and USD are pence/cents (£4.99 = 499). NGN is kobo
// (₦4,500 = 450000). Display layer divides all currencies by 100. NGN-as-kobo matches Paystack
// API convention.

export const SCHEMA_VERSION = 2;

export const GENRES = [
  'literary-fiction',
  'romance',
  'thriller-suspense',
  'sci-fi-fantasy',
  'historical',
  'short-story-collection',
  'poetry',
  'memoir-biography',
  'essays',
  'self-development',
  'business-finance',
  'politics-society',
];

export const TITLE_STATUSES = ['draft', 'published', 'unpublished'];
export const PUBLISHER_STATUSES = ['active', 'pending', 'suspended'];
export const SUPPORTED_CURRENCIES = ['gbp', 'ngn', 'usd'];

export const TITLE_SCHEMA = {
  schemaVersion: 'integer',
  slug: 'string',
  title: 'string',
  author: 'string',
  publisherId: 'string',
  isbn: 'string?',
  synopsis: 'string',
  excerpt: 'string?',
  coverUrl: 'string|null',
  epubPath: 'string|null',
  prices: 'object',
  genre: 'enum:GENRES',
  tags: 'array<string>?',
  pageCount: 'integer?',
  publishedDate: 'iso-date',
  addedAt: 'integer',
  updatedAt: 'integer',
  status: 'enum:TITLE_STATUSES',
  featured: 'boolean',
  bestseller: 'boolean',
  territoriesAllowed: "'*' | array<string>",
  salesCount: 'integer',
  ratingAverage: 'float|null',
  ratingCount: 'integer',
};

export const PUBLISHER_SCHEMA = {
  schemaVersion: 'integer',
  name: 'string',
  slug: 'string',
  contactEmail: 'string',
  paymentDetails: 'object?',
  salesSplit: 'float',
  status: 'enum:PUBLISHER_STATUSES',
  titlesCount: 'integer',
  addedAt: 'integer',
  updatedAt: 'integer',
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isBool = (v) => typeof v === 'boolean';
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateTitle(doc) {
  const errors = [];
  if (!isPlainObj(doc)) return { valid: false, errors: ['doc is not an object'] };

  // Required scalar fields.
  if (!isInt(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');
  if (!isStr(doc.slug)) errors.push('slug is required');
  else if (!SLUG_RE.test(doc.slug)) errors.push('slug must be kebab-case (lowercase, digits, hyphens)');
  if (!isStr(doc.title)) errors.push('title is required');
  if (!isStr(doc.author)) errors.push('author is required');
  if (!isStr(doc.publisherId)) errors.push('publisherId is required');
  if (!isStr(doc.synopsis)) errors.push('synopsis is required');

  // v2: coverUrl and epubPath are required only when publishing. For draft/unpublished they may
  // be null, but never empty string (forces explicit null at the data layer).
  const isPublishing = doc.status === 'published';
  for (const field of ['coverUrl', 'epubPath']) {
    const v = doc[field];
    if (isPublishing) {
      if (!isStr(v)) errors.push(`${field} is required when status is 'published'`);
    } else {
      if (v === '' ) errors.push(`${field} must be null (not empty string) when not published`);
      else if (v !== null && !isStr(v)) errors.push(`${field} must be a non-empty string or null`);
    }
  }

  // Optional strings — only check type if present.
  if (doc.isbn !== undefined && doc.isbn !== null && !isStr(doc.isbn)) errors.push('isbn must be a string when present');
  if (doc.excerpt !== undefined && doc.excerpt !== null && !isStr(doc.excerpt)) errors.push('excerpt must be a string when present');

  // Prices — integer minor units. GBP/USD = pence/cents (£4.99 = 499). NGN = kobo (₦4,500 = 450000).
  if (!isPlainObj(doc.prices)) {
    errors.push('prices must be an object');
  } else {
    const priceKeys = Object.keys(doc.prices);
    const supported = priceKeys.filter((k) => SUPPORTED_CURRENCIES.includes(k));
    if (supported.length === 0) errors.push('prices must contain at least one of gbp, ngn, usd');
    for (const k of priceKeys) {
      if (!SUPPORTED_CURRENCIES.includes(k)) {
        errors.push(`prices.${k} is not a supported currency`);
        continue;
      }
      const v = doc.prices[k];
      if (!isInt(v) || v <= 0) {
        errors.push(`prices.${k} must be a positive integer in minor units (pence/cents/kobo)`);
      }
    }
  }

  // Genre.
  if (!GENRES.includes(doc.genre)) errors.push(`genre must be one of: ${GENRES.join(', ')}`);

  // Tags (optional).
  if (doc.tags !== undefined && doc.tags !== null) {
    if (!Array.isArray(doc.tags)) errors.push('tags must be an array when present');
    else if (doc.tags.some((t) => !isStr(t))) errors.push('tags entries must be non-empty strings');
  }

  // Page count (optional).
  if (doc.pageCount !== undefined && doc.pageCount !== null) {
    if (!isInt(doc.pageCount) || doc.pageCount <= 0) errors.push('pageCount must be a positive integer when present');
  }

  // Dates and timestamps.
  if (!isStr(doc.publishedDate) || !ISO_DATE_RE.test(doc.publishedDate)) errors.push('publishedDate must be an ISO date string (YYYY-MM-DD)');
  if (!isInt(doc.addedAt) || doc.addedAt <= 0) errors.push('addedAt must be a positive integer (millisecond timestamp)');
  if (!isInt(doc.updatedAt) || doc.updatedAt <= 0) errors.push('updatedAt must be a positive integer (millisecond timestamp)');

  // Status.
  if (!TITLE_STATUSES.includes(doc.status)) errors.push(`status must be one of: ${TITLE_STATUSES.join(', ')}`);

  // Booleans (defaults applied at write time, so presence + type required here).
  if (!isBool(doc.featured)) errors.push('featured must be a boolean');
  if (!isBool(doc.bestseller)) errors.push('bestseller must be a boolean');

  // Territories allowed: '*' means worldwide; otherwise a non-empty array of alpha-2 codes.
  // null is rejected — we want an explicit choice so misconfigs fail closed, not open.
  if (doc.territoriesAllowed === '*') {
    // valid
  } else if (Array.isArray(doc.territoriesAllowed)) {
    if (doc.territoriesAllowed.length === 0) {
      errors.push('territoriesAllowed must be a non-empty array (use "*" for worldwide)');
    } else if (doc.territoriesAllowed.some((c) => !isStr(c) || !/^[A-Z]{2}$/.test(c))) {
      errors.push('territoriesAllowed entries must be ISO 3166-1 alpha-2 codes (e.g. "GB")');
    }
  } else {
    errors.push('territoriesAllowed must be the string "*" or a non-empty array of ISO 3166-1 alpha-2 codes');
  }

  // Sales / ratings.
  if (!isInt(doc.salesCount) || doc.salesCount < 0) errors.push('salesCount must be a non-negative integer');
  if (doc.ratingAverage !== null && doc.ratingAverage !== undefined) {
    if (!isFiniteNum(doc.ratingAverage) || doc.ratingAverage < 0 || doc.ratingAverage > 5) {
      errors.push('ratingAverage must be null or a number between 0 and 5');
    }
  }
  if (!isInt(doc.ratingCount) || doc.ratingCount < 0) errors.push('ratingCount must be a non-negative integer');

  return { valid: errors.length === 0, errors };
}

export function validatePublisher(doc) {
  const errors = [];
  if (!isPlainObj(doc)) return { valid: false, errors: ['doc is not an object'] };

  if (!isInt(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');
  if (!isStr(doc.name)) errors.push('name is required');
  if (!isStr(doc.slug)) errors.push('slug is required');
  else if (!SLUG_RE.test(doc.slug)) errors.push('slug must be kebab-case');
  if (!isStr(doc.contactEmail)) errors.push('contactEmail is required');
  else if (!EMAIL_RE.test(doc.contactEmail)) errors.push('contactEmail must look like an email address');

  if (doc.paymentDetails !== undefined && doc.paymentDetails !== null) {
    if (!isPlainObj(doc.paymentDetails)) {
      errors.push('paymentDetails must be an object when present');
    } else {
      if (doc.paymentDetails.method !== undefined && !['bank_transfer', 'paystack'].includes(doc.paymentDetails.method)) {
        errors.push('paymentDetails.method must be bank_transfer or paystack');
      }
      if (doc.paymentDetails.notes !== undefined && !isStr(doc.paymentDetails.notes)) {
        errors.push('paymentDetails.notes must be a non-empty string when present');
      }
    }
  }

  if (!isFiniteNum(doc.salesSplit) || doc.salesSplit < 0 || doc.salesSplit > 1) {
    errors.push('salesSplit must be a number between 0 and 1');
  }

  if (!PUBLISHER_STATUSES.includes(doc.status)) errors.push(`status must be one of: ${PUBLISHER_STATUSES.join(', ')}`);
  if (!isInt(doc.titlesCount) || doc.titlesCount < 0) errors.push('titlesCount must be a non-negative integer');
  if (!isInt(doc.addedAt) || doc.addedAt <= 0) errors.push('addedAt must be a positive millisecond timestamp');
  if (!isInt(doc.updatedAt) || doc.updatedAt <= 0) errors.push('updatedAt must be a positive millisecond timestamp');

  return { valid: errors.length === 0, errors };
}
