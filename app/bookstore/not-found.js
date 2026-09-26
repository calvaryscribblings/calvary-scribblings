// The Book Store's 404 — the house page (app/components/NotFoundPage.js, W2) with the shop's words.
// Reached by notFound() when no title is published yet (the A0 gate) or a slug has no book.
import NotFoundPage, { NOT_FOUND_COPY } from '../components/NotFoundPage';

const COPY = {
  ...NOT_FOUND_COPY,
  eyebrow: 'THE BOOK STORE',
  title: 'This book isn’t on the shelf.',
  body: 'It may have been withdrawn, or the link may be mistyped.',
  home: 'Back to the Book Store',
};

export default function BookstoreNotFound() {
  return <NotFoundPage copy={{ ...COPY, homeHref: '/bookstore' }} />;
}
