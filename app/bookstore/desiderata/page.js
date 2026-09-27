// /bookstore/desiderata — the reader's own list of books marked to come back to. W22 §5.
//
// The room sets robots noindex ITSELF rather than inheriting it from app/bookstore/layout.js:
// launch day takes noindex off the layout so the shop can be found, and a reader's private list
// must not become indexable on the same morning. The page is a client room behind the curtain.
import DesiderataRoom from './room';

export const metadata = {
  title: 'Desiderata — The Book Store',
  robots: { index: false, follow: false },
};

export default function DesiderataPage() {
  return <DesiderataRoom />;
}
