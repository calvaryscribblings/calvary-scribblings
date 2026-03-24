# Calvary Scribblings — Full Project Context
*Handoff document for new Claude session — last updated March 24, 2026*

---

## Platform Overview
- **Site:** calvaryscribblings.co.uk
- **Hosting:** Cloudflare Pages (from GitHub repo: calvaryscribblings/calvary-scribblings)
- **Current stack:** Static HTML/CSS/JS (live site on `main` branch)
- **Next.js migration:** IN PROGRESS — on `nextjs-preview` branch, deployed to Cloudflare preview URL
- **Hit tracking:** Firebase Realtime Database
- **Comments:** Disqus (calvaryscribblings.disqus.com)
- **Analytics:** Google Analytics G-W3B4WHBM8B
- **Push notifications:** OneSignal (App ID: ad1599c2-80a8-43ac-bbc2-e65301101cd0)
- **Favicon:** `favicon.png` in root — the purple S + fountain pen logo

---

## Firebase Config
```javascript
apiKey: "AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY"
authDomain: "calvary-scribblings.firebaseapp.com"
databaseURL: "https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app"
projectId: "calvary-scribblings"
storageBucket: "calvary-scribblings.firebasestorage.app"
messagingSenderId: "1052137412283"
appId: "1:1052137412283:web:509400c5a2bcc1ca63fb9e"
```

✅ Firebase security rules fixed and working.
✅ Firebase Auth enabled: Email/Password + Google sign-in (both enabled in Firebase console)

---

## Next.js Migration — Status & Structure

### Environment
- **Codespace:** calvary-scribblings repo → Codespaces (silver robot)
- **Next.js project folder:** `calvary-scribblings-next` (inside the Codespace at `/workspaces/calvary-scribblings/calvary-scribblings-next`)
- **Dev server:** `cd /workspaces/calvary-scribblings/calvary-scribblings-next && npm run dev`
- **Port:** 3000
- **Dev script:** `"dev": "next dev"` (no turbopack flag — removed to fix MDX compatibility)
- **Preview branch:** `nextjs-preview` — deployed to Cloudflare Pages preview URL
- **Cloudflare build command:** `cd calvary-scribblings-next && npm install && npm run build`
- **Cloudflare build output:** `calvary-scribblings-next/out`

### Design Direction
**"Netflix but for reading"** — cinematic dark mode, premium aesthetics, smooth hover effects, rich interactions. Background: `#0a0a0a`. Accent: purple `#7c3aed` / `#a855f7`. Font: Cochin/Georgia serif (Cormorant Garamond from Google Fonts on story pages).

### What's Built
- ✅ `app/layout.js` — root layout with AuthProvider + viewport meta tag + globals.css import
- ✅ `app/globals.css` — clean dark mode base styles
- ✅ `app/components/Navbar.js` — **clean standalone navbar component** with:
  - Logo (favicon.png)
  - Desktop links (Home, About, Subscribe, Contact + Stories dropdown)
  - Hamburger button (CSS media query at 768px — works on real mobile)
  - Mobile drawer with grouped links: main links → Creative Writing section → News/Inspiring/Search → Sign In
  - Scroll-aware background (transparent → dark blur on scroll)
  - Firebase auth integration (Sign In / Sign Out)
- ✅ `app/page.js` — full homepage with:
  - Navbar via `<Navbar />` component
  - **Hero carousel** — auto-rotates every 6s through 5 most recent photographic stories
  - **Just Added** — horizontal scroll cards (image left, title/author/date right, NEW badge overlay)
  - **Top 10** — Netflix-style with large ghost numbers + **tap-to-toggle hover state on mobile** (Top10Card component with useEffect dismiss)
  - **Category rows** — News, Inspiring, Flash Fiction, Short Stories, Poetry (Row component)
  - **Subscribe section** + **Footer**
- ✅ `app/lib/stories.js` — shared data file (all stories, parseDate, isNew, badgeStyle, categoryMeta)
- ✅ `app/lib/storyContent.js` — extracted HTML content for all 21 stories
- ✅ `app/lib/firebase.js` — Firebase app + auth + db initialisation
- ✅ `app/lib/AuthContext.js` — React context (user, loading, logout) via onAuthStateChanged
- ✅ `app/components/AuthModal.js` — cinematic auth modal
- ✅ All category pages (news, flash, short, poetry, inspiring, serial)
- ✅ `app/stories/[slug]/page.js` — individual story page
- ✅ `app/stories/[slug]/layout.js` — contains `generateStaticParams()` for static export

### Key Technical Notes
- **params in Next.js 16:** `const { slug } = use(params)` in client components; `const { slug } = await params` in server components/layouts
- **Turbopack disabled:** `package.json` dev script is `"next dev"` (no `--turbopack`)
- **output: 'export'** in `next.config.mjs` — required for Cloudflare Pages deployment
- **generateStaticParams** lives in `app/stories/[slug]/layout.js` (NOT page.js which is 'use client')
- **Viewport meta tag** in `app/layout.js` `<head>` — fixes mobile scaling
- **favicon.png** copied to `public/` folder for Next.js
- **Google sign-in:** Works on deployed domain; popup blocked in Codespace preview

---

## Mobile Polish — Session March 24, 2026

### Completed
- ✅ Top 10 tap-to-toggle hover state (Top10Card component with useEffect dismiss on touchstart)
- ✅ Just Added card alignment fixed — horizontal layout matching live site
- ✅ Category rows restored after accidental deletion during editing
- ✅ Viewport meta tag added — fixes mobile scaling
- ✅ Hamburger menu working on real mobile (CSS media query approach, clean Navbar component)
- ✅ MacBook Neo article images restored (downloaded from live site, added to public/)
- ✅ Preview deployment working on nextjs-preview branch

### Still To Do (Next Session Priority Order)
1. **Hamburger drawer** — confirm latest commit (0856ab2) deployed cleanly and drawer looks right
2. **MacBook Neo story** — inline article images still not displaying correctly in Next.js story page; pullquote N·e·o styling broken
3. **Mother and Other Poems** — poem stanzas not displaying in verses on Next.js
4. **Category rows mobile** — need horizontal scroll on mobile (currently showing as grid)
5. **StoryCard component** — "This is Nigeria" card text bleeding outside container
6. **Deploy to production** — merge nextjs-preview → main when mobile is ready

---

## Re-extracting Content (if new stories added to static site)
```bash
python3 << 'EOF'
import os, re
stories_dir = '/workspaces/calvary-scribblings/stories'
output = {}
for fname in sorted(os.listdir(stories_dir)):
    if fname.endswith('.html'):
        with open(os.path.join(stories_dir, fname)) as f:
            html = f.read()
        match = re.search(r'<article class="article-content">(.*?)</article>', html, re.DOTALL)
        if match:
            content = match.group(1)
            content = re.split(r'<div class="hit-counter">', content)[0]
            content = re.sub(r'\s+', ' ', content).strip()
            slug = fname.replace('.html', '')
            output[slug] = content
with open('/workspaces/calvary-scribblings/calvary-scribblings-next/app/lib/storyContent.js', 'w') as f:
    f.write('export const storyContent = {\n')
    for slug, content in output.items():
        safe = content.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
        f.write(f'  "{slug}": `{safe}`,\n')
    f.write('};\n')
print(f"Done! Extracted {len(output)} stories")
EOF
```

---

## Get Paid to Read — Campaign Plan

### Monthly Leaderboard (£25)
- Top reader by total page reads at end of each month wins £25
- Requires: user accounts + read tracking per user + leaderboard page
- Leaderboard resets on the 1st of each month

### Bi-weekly Quiz (£25 / £15 / £10)
- Top 3 scorers in story quizzes win prizes
- Quiz structure per selected story:
  1. **Hardball unlock question** — open text, manually reviewed by Ikenna
  2. **15 MCQs** — a/b/c/d, auto-marked
  3. **3 theory questions** — written answers, manually reviewed
- Results published one day before payment
- Selected stories only

### User Accounts
- ✅ Firebase Authentication: email/password + Google login — BUILT

### Payment
- Manual bank transfer/PayPal by Ikenna to winners

---

## File Structure (current static site — still live)
- Story HTML files → `stories/` folder in repo root
- Cover images → repo root
- `favicon.png` → root
- `logo-header.jpg` → root

---

## Contributors / Authors
- **Calvary** — platform pen name
- **Chioma Okonkwo** — staff writer (news)
- **Tricia Ajax** — contributing writer
- **Ikenna Okpara** — contributing writer
- **Ufedo Adaji** — contributing writer

---

## Published Stories (complete list, newest first)

| Title | File | Category | Author | Date | Cover |
|---|---|---|---|---|---|
| Rise and Shine | rise-and-shine.html | flash | Ufedo Adaji | Mar 21, 2026 | rise-and-shine-cover.jpeg |
| An Appetite for Love | an-appetite-for-love.html | poetry | Ufedo Adaji | Mar 19, 2026 | an-appetite-for-love-cover.png |
| Don't Worry | dont-worry.html | flash | Ufedo Adaji | Mar 19, 2026 | dont-worry-cover.jpeg |
| Terms and Conditions | terms-and-conditions.html | short | Tricia Ajax | Mar 18, 2026 | terms-and-conditions-cover.jpeg |
| The Oscar Showdowns | oscars-2026.html | news (Film) | Chioma Okonkwo | Mar 16, 2026 | oscars-2026-cover.jpeg |
| How to Make Peppersoup | how-to-make-peppersoup.html | inspiring | Ufedo Adaji | Mar 15, 2026 | peppersoup-cover.jpeg |
| This is Nigeria | this-is-nigeria.html | news (Op-Ed) | Ikenna Okpara | Mar 13, 2026 | this-is-nigeria-cover.jpeg |
| Another London Underground Strike! | london-tube-strike.html | news | Chioma Okonkwo | Mar 10, 2026 | london-tube-strike-cover.jpeg |
| Why The Bride Struggled at the Box Office | the-bride-box-office.html | news | Chioma Okonkwo | Mar 10, 2026 | the-bride-box-office-cover.jpeg |
| 1967 | 1967.html | short | Ikenna Okpara | Mar 7, 2026 | 1967-cover.jpeg |
| You Didn't Ask | you-didnt-ask.html | short | Tricia Ajax | Mar 4, 2026 | you-didnt-ask-cover.jpg |
| The All New MacBook Neo! | macbook-neo.html | news | Chioma Okonkwo | Mar 5, 2026 | macbook-neo-cover.PNG |
| Netflix to Stream Harry Styles' New Album | netflix-harry-styles.html | news | Chioma Okonkwo | Mar 4, 2026 | netflix-harry-styles-cover.jpg |
| Following the Deal Agreements with WBD | paramount-wbd-plans.html | news | Calvary | Mar 2, 2026 | paramount-wbd-plans-cover.jpg |
| Hollywood Reacts: Paramount Moves... | paramount-warner-bros-discovery.html | news | Chioma Okonkwo | Feb 28, 2026 | paramount-warner-bros-discovery-cover.jpg |
| The Girl Who Sang Through the Dark | the-girl-who-sang-through-the-dark.html | inspiring | Tricia Ajax | Feb 26, 2026 | the-girl-who-sang-through-the-dark-cover.jpg |
| The Man in the Middle: John Davidson | john-davidson-bafta-tourettes.html | news | Chioma Okonkwo | Feb 25, 2026 | john-davidson-bafta-cover.jpeg |
| BAFTA 2026: Winners... | bafta-2026.html | news | Chioma Okonkwo | Feb 23, 2026 | bafta-2026-cover.webp |
| Mother and Other Poems | mother-and-other-poems.html | poetry | Calvary | Feb 22, 2026 | mother-poems-cover.PNG |
| Early | early.html | short | Calvary | Feb 18, 2026 | early-cover.png |
| Miss Lady | miss-lady.html | flash | Calvary | Feb 17, 2026 | B4E36CD1-7C81-4ED0-BD27-63A125FDFD2D.png |

---

## Static Site — Story Page Template Rules
Every story page must have:
1. Google Analytics tag in `<head>`
2. Favicon: `<link rel="icon" type="image/png" href="../favicon.png">` and apple-touch-icon
3. Full Open Graph + Twitter Card meta tags (absolute URLs)
4. Firebase + Disqus SDK scripts
5. Logo: `<div class="logo-icon" style="background:none;padding:0;"><img src="../logo-header.jpg" ...></div>`
6. Cover banner: `.story-cover-banner` with gradient overlay, badge above title, title at `1.1–1.4rem`
7. Back link INSIDE `article-container`, below the banner
8. `article-container` + `article-content` structure
9. Font: `1.15rem / 1.8 line-height` (mobile: `1rem`)
10. Firebase hit counter using `id="hit-count"` pattern
11. Footer meta row with badge + author/date
12. Disqus comments
13. Standard footer
14. Search `<li>` must be INSIDE the nav `<ul>`

---

## Poetry Page Template Rules (static site)
- `poem-collection-intro` class for subtitle (italic, Times New Roman)
- `poem-contents` block with purple left border
- Purple gradient dividers between poems
- `poem-stanza` class: Cochin (NOT Times New Roman)
- Badge: `badge-poetry` (purple)

---

## Design System (static site)
- **Primary purple:** `#6b46c1` | **Light purple:** `#8b5cf6`
- **Body font:** Cochin/Georgia serif | **Italic text:** Times New Roman
- **Section dividers:** `width:100px;height:2px;background:linear-gradient(90deg,transparent,#6b46c1,transparent);margin:3rem auto;`
- **Cover banners:** gradient `rgba(0,0,0,0.88)` bottom to transparent, title `1.1–1.4rem`

## Design System (Next.js)
- **Background:** `#0a0a0a` | **Accent:** `#7c3aed` / `#a855f7` / `#c4b5fd`
- **Font:** Cormorant Garamond (Google Fonts) + Cochin/Georgia serif fallback
- **Card hover:** `scale(1.05)` + purple glow box-shadow
- **Navbar:** transparent → `rgba(10,10,10,0.96)` with blur on scroll
- **Carousel:** photographic covers only (news/inspiring/short), excludes illustrated covers
- **Story page prose:** `font-size: 1.22rem`, `line-height: 1.85`, `color: #e8e0d4`, `font-weight: 400`
- **Category accent colours:** news `#ef4444`, flash/short/poetry/serial `#7c3aed`, inspiring `#d97706`
- **Poetry page styles** (added to `[slug]/page.js` prose CSS):
  - `.poem-collection-intro` — italic, Times New Roman
  - `.poem-contents` — purple left border, italic list items
  - `.poem-stanza` — Cormorant Garamond, `margin-bottom: 2em`, line-height 1.7, `p::first-letter { all: unset }`
  - `h3` — italic, `#c4b5a0`, font-weight 400
  - Drop cap suppressed for poetry via `story.category === 'poetry'` check

---

## Known Issues / Resolved
- ✅ Firebase security rules — fixed
- ✅ Nav search link misalignment — fixed
- ✅ Favicon added to all static pages
- ✅ badge-poetry missing from styles.css — fixed
- ✅ Just Added strip stable sort — fixed
- ✅ Poem stanza font (Cochin not Times) — fixed
- ✅ Next.js params async — fixed with `use(params)`
- ✅ Turbopack MDX incompatibility — fixed
- ✅ Drop cap on closing paragraphs — fixed with `p:first-of-type::first-letter`
- ✅ Story links from homepage/category pages — all working
- ✅ Firebase Auth email/password — working
- ✅ Google sign-in popup — blocked in Codespace preview (works on deployed domain)
- ✅ Mobile viewport scaling — fixed with meta tag in layout.js
- ✅ Hamburger menu — working on real mobile via CSS media queries
- ✅ Top 10 tap-to-toggle — working on mobile
- ✅ Just Added cards — alignment fixed
- ✅ MacBook Neo images — restored from live site
- ⚠️ MacBook Neo story — inline images + pullquote styling broken in Next.js
- ⚠️ Mother and Other Poems — verses not displaying correctly in Next.js
- ⚠️ Category rows — no horizontal scroll on mobile in Next.js
- ⚠️ Cloudflare cache slow to update — purge via dashboard when needed
- ⚠️ No welcome email on registration yet — needs EmailJS integration

---

## What NOT to do
- Never put story titles in 3–4rem font on cover banners (static site — keep at 1.1–1.4rem)
- Never set poem stanza text to Times New Roman (Cochin only)
- Always add new stories to: story HTML + index.html + category page + search.html (static site)
- Always add new stories to: `app/lib/stories.js` (Next.js) + re-run content extraction script
- Always include favicon links on new story pages
- Keep Search `<li>` inside the nav `<ul>` (static site)
- Don't use illustrated/text-heavy covers in the Next.js carousel
- Don't add `--turbopack` back to the dev script
- Don't put `generateStaticParams` in a 'use client' file — it must be in a server component (layout.js)
- Don't use JavaScript (isMobile state) for responsive navbar — use CSS media queries only
