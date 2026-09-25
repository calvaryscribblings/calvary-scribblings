// THE RETURN BANNER'S WORDS — W3 / MON-09. Pure, so every state is asserted without a browser.
//
// Before W3, /membership?join=success read "SETTING UP YOUR MEMBERSHIP…" for ever: no clock, no
// sign-in prompt, and no way to tell "we are a few seconds behind" from "your card was declined".
// Those are different facts with different things to do about them, so they are different
// banners. The inputs:
//
//   returned  'join' | 'pass' | 'switch' | 'cancelled' | null   (from the query string)
//   settled   the thing they came back for is on the record
//   signedIn / authKnown
//   provider  'paid' | 'pending' | 'failed' | 'unknown'         (/api/membership/return-status)
//   overdue   RETURN_DEADLINE_MS has passed since the page loaded

export const RETURN_DEADLINE_MS = 90_000;
export const HELP_EMAIL = 'contact@calvaryscribblings.co.uk';

/** @returns {null | {title, body, tone?: 'bad', contact?: true, signIn?: true}} */
export function returnBanner({ returned, settled, signedIn, authKnown, provider, overdue }) {
  if (!['join', 'pass', 'switch'].includes(returned) || settled) return null;
  const thing = returned === 'pass' ? 'pass' : returned === 'switch' ? 'new plan' : 'membership';

  if (authKnown && !signedIn) {
    return {
      title: 'SIGN IN TO SEE IT',
      body: `You’re signed out. Sign in with the account you paid from and your ${thing} will appear here.`,
      signIn: true,
    };
  }
  if (provider === 'failed') {
    return {
      tone: 'bad',
      title: 'THE PAYMENT DIDN’T GO THROUGH',
      body: 'The checkout ended before any payment was taken, so nothing has been charged. You can try again below.',
    };
  }
  if (!overdue) {
    return {
      title: returned === 'switch' ? 'CHANGING YOUR PLAN' : returned === 'pass' ? 'SETTING UP YOUR PASS' : 'SETTING UP YOUR MEMBERSHIP',
      body: provider === 'paid'
        ? `Your payment has gone through. Your ${thing} will appear here in a few seconds — this page updates on its own.`
        : 'Checking with the payment provider. This page updates on its own, so there is nothing to refresh.',
    };
  }
  if (provider === 'paid') {
    return {
      tone: 'bad',
      title: 'PAID — BUT NOT SHOWING YET',
      body: `Your payment went through, but your ${thing} hasn’t appeared yet. That is on our side, and we have already been alerted. It usually sorts itself out within a few minutes; if it hasn’t within ten,`,
      contact: true,
    };
  }
  if (provider === 'pending') {
    return {
      title: 'WAITING FOR YOUR BANK',
      body: `Your payment hasn’t been confirmed yet — some banks take a few minutes. If you’re charged and your ${thing} hasn’t appeared within ten minutes,`,
      contact: true,
    };
  }
  return {
    title: 'WE CAN’T CONFIRM IT YET',
    body: `We haven’t been able to confirm this with the payment provider. If you were charged and your ${thing} hasn’t appeared within ten minutes,`,
    contact: true,
  };
}
