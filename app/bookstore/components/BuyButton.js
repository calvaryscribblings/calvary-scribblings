'use client';
// The one buy button. Both surfaces that sell — the storefront window (app/bookstore/page.js)
// and the detail page (app/bookstore/[slug]/page-detail.js) — render this rather than each
// owning a copy of the sign-in gate, the pending state and the failure register. The two
// differ only in CSS class, which is what `className` is for.
//
// QuickLookModal deliberately does NOT use this: its buy control is a link through to the
// detail page, so there is exactly one place in the bookstore where a charge can begin.
//
// Failure is reported inline, in the catalogue's own voice — never alert(). A modal dialog
// over a shelf of hand-set type would read as a browser error, and this is a bookshop.
import { useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import AuthModal from '../../components/AuthModal';
import { createCheckoutSession } from '../../lib/bookstore/checkout';
import { useCurrency, useRegionCountry, priceLine } from '../../lib/bookstore/currency';
import { UNAVAILABLE_LABEL } from '../../lib/bookstore/territory';

export default function BuyButton({ title, className, align = 'flex-start' }) {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [currency] = useCurrency();

  // R8.3 — THE BUTTON NAMES THE SUM THAT WILL BE CHARGED, NEVER THE BROWSING CURRENCY.
  //
  // priceFor() returns the EFFECTIVE currency: the reader's selection when the title carries
  // that price, and the fallback when it does not. Both the label and the rail read from this
  // one value, which is what keeps them from ever disagreeing — the original file's own
  // instruction ("keep the currency the button shows and the currency it charges in as one
  // decision, not two"), now that there is more than one currency for it to be true of.
  //
  // A button reading "Buy · ₦4,500" that charges £4.99 is the single worst outcome available
  // in this round, so it is made structurally impossible rather than merely avoided.
  // R8.4 — THE TERRITORY CHECK IS ADVISORY HERE, AND ONLY HERE.
  //
  // This button is a courtesy: it stops a reader walking into a refusal they could have been
  // told about on the shelf. It is NOT the enforcement. The enforcement is in
  // functions/api/bookstore/checkout.js and paystack-checkout.js, which resolve the country
  // themselves from the Cloudflare edge and refuse with 403 not_in_territory — because
  // everything below runs on the reader's machine and can be edited by anyone who wants to.
  // If this check and the server's ever disagree, the server's is the one that is true.
  //
  // `country` comes from the same one-shot region probe that already picked the currency, so
  // this costs no request. Null (Cloudflare could not place them) marks nothing and disables
  // nothing: the button stays live and the server gives them an honest answer, which beats a
  // shelf of warnings the shop is guessing at. See SELL_TO_UNKNOWN_COUNTRY in territory.js.
  const country = useRegionCountry();
  const { price, priced: effective, sellable } = priceLine(title, currency, country);

  const onClick = async () => {
    setError(null);
    if (!sellable) return;   // belt and braces: the button is already disabled below.

    // Signed out: the platform's affordance everywhere else (open-pages, my-library) is to
    // raise AuthModal in place rather than route away, so a reader never loses their page.
    if (!user) { setShowAuth(true); return; }

    setPending(true);
    try {
      // The same `effective.currency` the label printed — never `currency`. createCheckoutSession
      // picks the rail from it: 'ngn' → Paystack, 'gbp'/'usd' → Stripe.
      const url = await createCheckoutSession(user, title?.id, effective?.currency || 'gbp');
      // Leaving for Stripe — deliberately no setPending(false); the button stays in its
      // pending state until the navigation takes the page, so it cannot be double-fired.
      window.location.assign(url);
    } catch (e) {
      setError(e?.message || 'Checkout could not be opened. Please try again.');
      setPending(false);
    }
  };

  return (
    <>
      {/* DISABLED, NOT REMOVED. The button keeps its place, its size and its position in the
          tab order's neighbourhood, so the page does not reflow around a reader's geography
          and so a screen reader meets the control and is told it is unavailable — rather than
          finding a book with no way to buy it and no explanation. `aria-disabled` is the
          announcement; the native `disabled` is what makes the claim true, because an
          aria-only disable is a promise the DOM does not keep. The detail page's sentence
          beneath says why. */}
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={pending || !sellable}
        aria-disabled={!sellable || undefined}
        data-unavailable={!sellable || undefined}
        aria-busy={pending || undefined}
      >
        {!sellable ? UNAVAILABLE_LABEL : (pending ? 'Opening…' : (price ? `Buy · ${price}` : 'Buy'))}
      </button>

      {error && (
        <p
          role="alert"
          style={{
            margin: '.55rem 0 0',
            maxWidth: '30ch',
            alignSelf: align,
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: '.82rem',
            fontStyle: 'italic',
            lineHeight: 1.5,
            color: 'rgba(214,138,110,.92)',
          }}
        >
          {error}
        </p>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
