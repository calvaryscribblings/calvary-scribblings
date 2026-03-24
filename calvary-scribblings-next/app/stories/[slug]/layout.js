import { stories } from '../../lib/stories';

export async function generateStaticParams() {
  return stories.map((s) => ({ slug: s.id }));
}

export default function StoryLayout({ children }) {
  return children;
}
