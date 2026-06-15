'use client';
import './globals.css';
import { AuthProvider } from './lib/AuthContext';
import CookieBanner from './components/CookieBanner';
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <AuthProvider>
          {children}
          <CookieBanner />
        </AuthProvider>
      </body>
    </html>
  );
}