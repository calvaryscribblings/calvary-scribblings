// PROOFS — the shell. A static page with no story data in it (everything arrives after sign-in
// from /api/proofs), and never indexed: a crawler that reached it would find only the shell, but
// the address itself is nobody's business.
export const metadata = {
  title: 'Proofs — Calvary Scribblings',
  robots: { index: false, follow: false },
};

export default function ProofsLayout({ children }) {
  return children;
}
