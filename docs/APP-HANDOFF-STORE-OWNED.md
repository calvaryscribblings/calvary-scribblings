# App hand-off: STORE-OWNED (29 Oct 2026)

What the app must mirror from the web round. Nothing else in STORE-OWNED needs app work.

## 241: owned books say so

- **Owned** means `bookstore_purchases/{uid}/{titleId}` exists with `status === 'active'`: a sale, a
  complimentary copy (`source: 'comp'`) or a free copy (`rail: 'free'`). A `revoked` copy is not
  owned. This is the same test `/api/bookstore/stream` makes before it hands over the book.
- Wherever the app offers to buy or get a title, an owned title shows **In My Library** instead,
  and it opens the reader's library. That covers paid and free titles, and a title not licensed in
  the reader's region: a held book opens anywhere.

## The refusal

Both checkouts now refuse an owner before anything is created:

```
POST /api/bookstore/checkout            → 409
POST /api/bookstore/paystack-checkout   → 409
  { "error": "This title is already in your library.",
    "code": "already_owned",
    "library": "/my-library" }
```

- Show `error` as given. It's the same shape as `free_title`, which carries `claim` instead of `library`.
- The wording is ruled (257, 31 Oct 2026). Read it from the response; don't copy it into the app.
- If the server can't read the reader's copy, it lets the checkout through rather than block a sale.

## 245: the author photo, if A48 hasn't done it

On a book's full details page, the author photo has **12px corners**. Its size, its 4:5 ratio, its
crop, its tone, its hairline and its shadow don't change, and the hairline and the shadow follow the
rounded corner. If A48 already shipped this, there's nothing to do.
