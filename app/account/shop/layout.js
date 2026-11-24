// SHOP-B2 — the paperback shop's handoff page (docs/ACCOUNT-CONTRACT.md §6.2 (a)).
// Reached only from the shop's confirmation page: never indexed, never in the sitemap, linked from
// nowhere on this site, and never claimed by an app (docs/APP-DEEP-LINKS.md §4). No referrer leaves
// it, so the shop's state in its address goes nowhere but back to the shop.
import { SHOP_COPY } from '../../lib/shopHandoff';

export const metadata = {
  title: SHOP_COPY.title,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShopHandoffLayout({ children }) {
  return children;
}
