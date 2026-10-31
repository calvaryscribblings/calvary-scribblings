// W2 / BS-13 — the root 404. In a static export this becomes out/404.html, which Cloudflare Pages
// serves for every address it has no file for. See app/components/NotFoundPage.js.
// UNRELEASED-1: on a /stories/<slug> address it first asks whether the story has just gone live
// and its page is not built yet. See app/components/NotFoundOrLiveStory.js.
import NotFoundOrLiveStory from './components/NotFoundOrLiveStory';

export default function NotFound() {
  return <NotFoundOrLiveStory />;
}
