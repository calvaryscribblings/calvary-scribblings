// NOTIF-B2 — the notifications list and its settings: a reader's own, so never indexed.
export const metadata = {
  title: 'Notifications · Calvary Scribblings',
  robots: { index: false, follow: false },
};

export default function NotificationsLayout({ children }) {
  return children;
}
