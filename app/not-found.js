// W2 / BS-13 — the root 404. In a static export this becomes out/404.html, which Cloudflare Pages
// serves for every address it has no file for. See app/components/NotFoundPage.js.
import NotFoundPage from './components/NotFoundPage';

export default function NotFound() {
  return <NotFoundPage />;
}
