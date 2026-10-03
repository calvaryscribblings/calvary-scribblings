// W33 — the held-book door carries nothing for a crawler: no title (the page is static and names
// no book), and no index. A private door is not a page of the site.
export const metadata = {
  title: 'My Library — Calvary Scribblings',
  robots: { index: false, follow: false },
};

export default function HeldBookLayout({ children }) {
  return children;
}
