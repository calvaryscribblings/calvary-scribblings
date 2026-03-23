export const stories = [
  { id: 'rise-and-shine', title: 'Rise and Shine', category: 'flash', categoryName: 'Flash Fiction', url: '/stories/rise-and-shine', cover: '/rise-and-shine-cover.jpeg', author: 'Ufedo Adaji', date: 'Mar 21, 2026' },
  { id: 'an-appetite-for-love', title: 'An Appetite for Love', category: 'poetry', categoryName: 'Poetry', url: '/stories/an-appetite-for-love', cover: '/an-appetite-for-love-cover.png', author: 'Ufedo Adaji', date: 'Mar 19, 2026' },
  { id: 'dont-worry', title: "Don't Worry", category: 'flash', categoryName: 'Flash Fiction', url: '/stories/dont-worry', cover: '/dont-worry-cover.jpeg', author: 'Ufedo Adaji', date: 'Mar 19, 2026' },
  { id: 'terms-and-conditions', title: 'Terms and Conditions', category: 'short', categoryName: 'Short Story', url: '/stories/terms-and-conditions', cover: '/terms-and-conditions-cover.jpeg', author: 'Tricia Ajax', date: 'Mar 18, 2026' },
  { id: 'oscars-2026', title: 'The Oscar Showdowns', category: 'news', categoryName: 'Film', url: '/stories/oscars-2026', cover: '/oscars-2026-cover.jpeg', author: 'Chioma Okonkwo', date: 'Mar 16, 2026' },
  { id: 'how-to-make-peppersoup', title: 'How to Make Peppersoup', category: 'inspiring', categoryName: 'Inspiring', url: '/stories/how-to-make-peppersoup', cover: '/peppersoup-cover.jpeg', author: 'Ufedo Adaji', date: 'Mar 15, 2026' },
  { id: 'this-is-nigeria', title: 'This is Nigeria', category: 'news', categoryName: 'Op-Ed', url: '/stories/this-is-nigeria', cover: '/this-is-nigeria-cover.jpeg', author: 'Ikenna Okpara', date: 'Mar 13, 2026' },
  { id: 'london-tube-strike', title: 'Another London Underground Strike!', category: 'news', categoryName: 'News', url: '/stories/london-tube-strike', cover: '/london-tube-strike-cover.jpeg', author: 'Chioma Okonkwo', date: 'Mar 10, 2026' },
  { id: 'the-bride-box-office', title: 'Why The Bride Struggled at the Box Office', category: 'news', categoryName: 'News', url: '/stories/the-bride-box-office', cover: '/the-bride-box-office-cover.jpeg', author: 'Chioma Okonkwo', date: 'Mar 10, 2026' },
  { id: '1967', title: '1967', category: 'short', categoryName: 'Short Story', url: '/stories/1967', cover: '/1967-cover.jpeg', author: 'Ikenna Okpara', date: 'Mar 7, 2026' },
  { id: 'you-didnt-ask', title: "You Didn't Ask", category: 'short', categoryName: 'Short Story', url: '/stories/you-didnt-ask', cover: '/you-didnt-ask-cover.jpg', author: 'Tricia Ajax', date: 'Mar 4, 2026' },
  { id: 'macbook-neo', title: 'The All New MacBook Neo!', category: 'news', categoryName: 'Tech', url: '/stories/macbook-neo', cover: '/macbook-neo-cover.PNG', author: 'Chioma Okonkwo', date: 'Mar 5, 2026' },
  { id: 'netflix-harry-styles', title: "Netflix to Stream Harry Styles' New Album", category: 'news', categoryName: 'News', url: '/stories/netflix-harry-styles', cover: '/netflix-harry-styles-cover.jpg', author: 'Chioma Okonkwo', date: 'Mar 4, 2026' },
  { id: 'paramount-wbd-plans', title: 'Paramount Reveals Plans for the Future', category: 'news', categoryName: 'News', url: '/stories/paramount-wbd-plans', cover: '/paramount-wbd-plans-cover.jpg', author: 'Calvary', date: 'Mar 2, 2026' },
  { id: 'paramount-warner-bros-discovery', title: 'Hollywood Reacts: Paramount Moves to Take Control of WBD', category: 'news', categoryName: 'News', url: '/stories/paramount-warner-bros-discovery', cover: '/paramount-warner-bros-discovery-cover.jpg', author: 'Chioma Okonkwo', date: 'Feb 28, 2026' },
  { id: 'the-girl-who-sang-through-the-dark', title: 'The Girl Who Sang Through the Dark', category: 'inspiring', categoryName: 'Inspiring', url: '/stories/the-girl-who-sang-through-the-dark', cover: '/the-girl-who-sang-through-the-dark-cover.jpg', author: 'Tricia Ajax', date: 'Feb 26, 2026' },
  { id: 'john-davidson-bafta-tourettes', title: "The Man in the Middle: John Davidson", category: 'news', categoryName: 'News', url: '/stories/john-davidson-bafta-tourettes', cover: '/john-davidson-bafta-cover.jpeg', author: 'Chioma Okonkwo', date: 'Feb 25, 2026' },
  { id: 'bafta-2026', title: 'BAFTA 2026: Winners...', category: 'news', categoryName: 'News', url: '/stories/bafta-2026', cover: '/bafta-2026-cover.webp', author: 'Chioma Okonkwo', date: 'Feb 23, 2026' },
  { id: 'mother-and-other-poems', title: 'Mother and Other Poems', category: 'poetry', categoryName: 'Poetry', url: '/stories/mother-and-other-poems', cover: '/mother-poems-cover.PNG', author: 'Calvary', date: 'Feb 22, 2026' },
  { id: 'early', title: 'Early', category: 'short', categoryName: 'Short Story', url: '/stories/early', cover: '/early-cover.png', author: 'Calvary', date: 'Feb 18, 2026' },
  { id: 'miss-lady', title: 'Miss Lady', category: 'flash', categoryName: 'Flash Fiction', url: '/stories/miss-lady', cover: '/B4E36CD1-7C81-4ED0-BD27-63A125FDFD2D.png', author: 'Calvary', date: 'Feb 17, 2026' },
];

export function parseDate(str) { return new Date(str); }
export function isNew(s) { return (Date.now() - parseDate(s.date)) / 86400000 <= 7; }

export const badgeStyle = {
  news: { background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' },
  flash: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  short: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  poetry: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  inspiring: { background: 'rgba(217,119,6,0.2)', color: '#fcd34d', border: '1px solid rgba(217,119,6,0.4)' },
};

export const categoryMeta = {
  news: { label: 'News & Updates', emoji: '📰', accent: '#ef4444' },
  flash: { label: 'Flash Fiction', emoji: '⚡', accent: '#7c3aed' },
  short: { label: 'Short Stories', emoji: '📖', accent: '#7c3aed' },
  poetry: { label: 'Poetry', emoji: '✍️', accent: '#7c3aed' },
  inspiring: { label: 'Inspiring Stories', emoji: '✨', accent: '#d97706' },
  serial: { label: 'Serial Stories', emoji: '📚', accent: '#7c3aed' },
};
