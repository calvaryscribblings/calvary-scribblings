import "./globals.css";

export const metadata = {
  title: "Calvary Scribblings - Stories That Matter",
  description: "Bringing you compelling fiction, breaking news, heartwarming real-life stories, and thought-provoking articles from around the world.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/favicon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}