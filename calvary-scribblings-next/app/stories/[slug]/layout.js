import { stories } from '../../lib/stories';

export async function generateStaticParams() {
  return stories.map((s) => ({ slug: s.id }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const story = stories.find(s => s.id === slug);
  if (!story) return {};

  const url = `https://calvaryscribblings.co.uk/stories/${slug}`;
  const image = `https://calvaryscribblings.co.uk${story.cover}`;

  return {
    title: `${story.title} — Calvary Scribblings`,
    description: `By ${story.author} · ${story.categoryName} · Calvary Scribblings`,
    openGraph: {
      title: story.title,
      description: `By ${story.author} · ${story.categoryName}`,
      url,
      siteName: 'Calvary Scribblings',
      images: [{ url: image, width: 1200, height: 675, alt: story.title }],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: story.title,
      description: `By ${story.author} · ${story.categoryName}`,
      images: [image],
    },
  };
}

export default function StoryLayout({ children }) {
  return children;
}