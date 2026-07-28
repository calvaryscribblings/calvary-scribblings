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
import { formatGbp } from './fields';

export default function BuyButton({ title, className, align = 'flex-start' }) {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [showAuth, setShowAuth] = useState(false);

  // R5 sells in GBP only; the display toggle is R9. Keep the currency the button shows and
  // the currency it charges in as one decision, not two.
  const price = formatGbp(title?.prices?.gbp);

  const onClick = async () => {
    setError(null);

    // Signed out: the platform's affordance everywhere else (open-pages, my-library) is to
    // raise AuthModal in place rather than route away, so a reader never loses their page.
    if (!user) { setShowAuth(true); return; }

    setPending(true);
    try {
      const url = await createCheckoutSession(user, title?.id, 'gbp');
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
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Opening…' : (price ? `Buy · ${price}` : 'Buy')}
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
