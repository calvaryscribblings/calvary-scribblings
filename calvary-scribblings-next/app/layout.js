import { AuthProvider } from './lib/AuthContext';
import './globals.css';

export const metadata = {
  title: 'Calvary Scribblings — Stories That Matter',
  description: 'A literary publication platform featuring flash fiction, short stories, poetry, news and inspiring stories.',
  openGraph: {
    title: 'Calvary Scribblings — Stories That Matter',
    description: 'A literary publication platform featuring flash fiction, short stories, poetry, news and inspiring stories.',
    url: 'https://calvaryscribblings.co.uk',
    siteName: 'Calvary Scribblings',
    images: [
      {
        url: 'https://calvaryscribblings.co.uk/logo-header.jpg',
        width: 1200,
        height: 675,
        alt: 'Calvary Scribblings',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Calvary Scribblings — Stories That Matter',
    description: 'A literary publication platform featuring flash fiction, short stories, poetry, news and inspiring stories.',
    images: ['https://calvaryscribblings.co.uk/logo-header.jpg'],
    creator: '@calvaryscribblings',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}