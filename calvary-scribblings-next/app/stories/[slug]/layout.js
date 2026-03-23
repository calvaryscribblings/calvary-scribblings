import { stories } from '../../lib/stories';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const story = stories.find(s => s.id === slug);

  if (!story) {
    return {
      title: 'Story Not Found | Calvary Scribblings',
    };
  }

  const coverUrl = story.cover.startsWith('/')
    ? `https://calvaryscribblings.co.uk${story.cover}`
    : story.cover;

  const description = `${story.categoryName} by ${story.author} — published ${story.date} on Calvary Scribblings.`;

  return {
    title: `${story.title} | Calvary Scribblings`,
    description,
    openGraph: {
      title: story.title,
      description,
      url: `https://calvaryscribblings.co.uk${story.url}`,
      siteName: 'Calvary Scribblings',
      images: [
        {
          url: coverUrl,
          width: 1200,
          height: 675,
          alt: story.title,
        },
      ],
      type: 'article',
      publishedTime: story.date,
      authors: [story.author],
      tags: [story.categoryName],
    },
    twitter: {
      card: 'summary_large_image',
      title: story.title,
      description,
      images: [coverUrl],
      creator: '@calvaryscribblings',
    },
    alternates: {
      canonical: `https://calvaryscribblings.co.uk${story.url}`,
    },
  };
}

export default function StoryLayout({ children }) {
  return children;
}