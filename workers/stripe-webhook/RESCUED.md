Recovered verbatim from `stash@{0}^3` (blob 0770015) on 2026-07-28 — byte-identical, unmodified.

Pre-adaptation: still writes the old Dead End paywall node `purchases/{uid}/{slug}` and hardcodes `DEFAULT_SLUG = 'dead-end-a-halfway-around-the-moon-story'`; our node is `bookstore_purchases/{uid}/{titleId}`.

R5 will port this into `functions/api/bookstore/` — keep the signature verification and service-account OAuth minting, retarget the write.
