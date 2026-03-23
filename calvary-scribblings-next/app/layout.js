import { AuthProvider } from './lib/AuthContext';
import './globals.css';

export const metadata = {
  title: 'Calvary Scribblings',
  description: 'Stories That Matter',
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