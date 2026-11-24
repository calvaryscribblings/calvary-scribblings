// SHOP-B3 — THE PAPERBACK SHOP'S ORDERS: what the filing call accepts, and the one switch.
// docs/ACCOUNT-CONTRACT.md §6.2 (b); docs/SHOP-HANDOFF.md is the shop's copy of the rules.
// Pure: the Function (functions/api/account/shop-orders.js) imports it, and B4's reader view will.

/**
 * ⭑ THE SWITCH (Ikenna's ruling, 24 Nov 2026). Until SHOP-B4 is live with its /privacy update, the
 * filing call accepts TEST orders only (order.test === true, the shop's Paystack test mode) and
 * answers a real one with `not_open_yet`, writing nothing and leaving its code unused. B4 flips this
 * to true in the same round that ships the reader's view and the /privacy copy, never before.
 */
export const SHOP_ORDERS_OPEN = false;

/**
 * The books the shop sells, by the slug the shop sends. A fixed list: a new book is a code change
 * here, reviewed like any other, never a value the shop can widen by sending it.
 */
export const SHOP_TITLES = Object.freeze(['after-the-fact', 'where-the-story-begins']);

/** How many copies one order may hold, as the shop counts them. Far above any real order. */
export const COPIES_MAX = 99;

/** An order's amount, in whole kobo: at least ₦1 (100 kobo), at most ₦10,000,000. */
export const AMOUNT_MIN = 100;
export const AMOUNT_MAX = 1_000_000_000;
export const SHOP_CURRENCY = 'NGN';

/** paidAt may be no earlier than this (the shop did not exist before it), and no later than now + skew. */
export const PAID_AT_FLOOR = Date.UTC(2026, 0, 1);

/** A test order is removed by the scrub this long after it was filed (ruling, SHOP-B3). */
export const TEST_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A used code's marker is kept this long, so a retry can still be answered; then the scrub removes it. */
export const USED_MARKER_TTL_MS = 24 * 60 * 60 * 1000;

/** Server-only: order number → the account that holds it. One order, one account. */
export const ORDER_INDEX_PATH = 'print_order_index';
export const ORDERS_PATH = 'print_orders';
