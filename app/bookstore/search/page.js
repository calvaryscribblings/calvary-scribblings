// /bookstore/search — the shelves, searched. W22 §6.
//
// noindex set HERE, not only inherited: launch day takes noindex off app/bookstore/layout.js,
// and a page whose content is whatever a query string says is not a page a crawler should keep.
import SearchRoom from './room';

export const metadata = {
  title: 'Search the shelves — The Book Store',
  robots: { index: false, follow: false },
};

export default function BookStoreSearchPage() {
  return <SearchRoom />;
}
