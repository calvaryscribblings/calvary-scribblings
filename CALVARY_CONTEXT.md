# Calvary Scribblings — Full Project Context
*Handoff document for new Claude session — last updated March 22, 2026*

---

## Platform Overview
- **Site:** calvaryscribblings.co.uk
- **Hosting:** Cloudflare Pages (from GitHub repo: calvaryscribblings/calvary-scribblings)
- **Current stack:** Static HTML/CSS/JS
- **Next.js migration:** IN PROGRESS — see Next.js section below
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

✅ **Firebase security rules FIXED** — updated to scoped rules (Mar 16, 2026):
```json
{
  "rules": {
    "stories": {
      ".read": true,
      ".write": true
    }
  }
}
```

---

## Next.js Migration
- **Status:** Project created and running in GitHub Codespaces
- **Codespace:** calvary-scribblings repo → Codespaces (silver robot)
- **Next.js project folder:** `calvary-scribblings-next` (inside the Codespace workspace)
- **Dev server:** runs on port 3000 via `npm run dev` from inside `calvary-scribblings-next`
- **Setup used:** No TypeScript, ESLint yes, Tailwind CSS yes, No src/ dir, App Router yes, No Turbopack, No import alias customisation
- **Next step:** Build the homepage in Next.js, then migrate all pages, then add Firebase Auth + Get Paid to Read features
- **Deployment target:** Still Cloudflare Pages — will switch domain over when Next.js version is ready

---

## Get Paid to Read — Campaign Plan
A reader engagement initiative. Full plan:

### Monthly Leaderboard (£25)
- Top reader by total page reads at end of each month wins £25
- Requires: user accounts + read tracking per user + leaderboard page
- Leaderboard resets on the 1st of each month

### Bi-weekly Quiz (£25 / £15 / £10)
- Top 3 scorers in story quizzes win prizes
- Quiz structure per selected story:
  1. **Hardball unlock question** — open text, manually reviewed by Ikenna, acts as AI-cheat deterrent and read verification
  2. **15 MCQs** — a/b/c/d, one correct answer, auto-marked
  3. **3 theory questions** — written answers, manually reviewed
- Results published one day before payment
- Not every story has a quiz — selected stories only

### User Accounts
- Required for leaderboard tracking and quiz participation
- Auth method: Firebase Authentication (email/password + Google login)
- All to be built in the Next.js version

### Payment
- Manual bank transfer / PayPal by Ikenna to winners
- No payment gateway needed

---

## File Structure (current static site)
- Story HTML files → `stories/` folder in repo
- All other files (covers, index.html, category pages, scripts.js, styles.css, etc.) → repo root
- Cover images → repo root
- Favicon → `favicon.png` in root

---

## Key Files
- `index.html` — Homepage with Top 10, Just Added strip, category rows
- `scripts.js` — Hamburger menu, form handling, scroll animations
- `styles.css` — Global styles (includes Times New Roman rule for italic text, badge-poetry fix)
- `search.html` — Search engine (live search, category filters, keyword highlighting)
- `news.html`, `inspiring.html`, `flash.html`, `short.html`, `poetry.html`, `serial.html`, `creative.html`, `offline.html` — Category pages
- `logo-header.jpg` — Header logo used on all pages
- `favicon.png` — Site favicon (purple S + fountain pen)

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
| Why The Bride Struggled at the Box Office... | the-bride-box-office.html | news | Chioma Okonkwo | Mar 10, 2026 | the-bride-box-office-cover.jpeg |
| 1967 | 1967.html | short | Ikenna Okpara | Mar 7, 2026 | 1967-cover.jpeg |
| You Didn't Ask | you-didnt-ask.html | short | Tricia Ajax | Mar 4, 2026 | you-didnt-ask-cover.jpg |
| The All New MacBook Neo! | macbook-neo.html | news | Chioma Okonkwo | Mar 5, 2026 | macbook-neo-cover.PNG |
| Netflix to Stream Harry Styles' New Album... | netflix-harry-styles.html | news | Chioma Okonkwo | Mar 4, 2026 | netflix-harry-styles-cover.jpg |
| Following the Deal Agreements with WBD... | paramount-wbd-plans.html | news | Calvary | Mar 2, 2026 | paramount-wbd-plans-cover.jpg |
| Hollywood Reacts: Paramount Moves... | paramount-warner-bros-discovery.html | news | Chioma Okonkwo | Feb 28, 2026 | paramount-warner-bros-discovery-cover.jpg |
| The Girl Who Sang Through the Dark | the-girl-who-sang-through-the-dark.html | inspiring | Tricia Ajax | Feb 26, 2026 | the-girl-who-sang-through-the-dark-cover.jpg |
| The Man in the Middle: John Davidson... | john-davidson-bafta-tourettes.html | news | Chioma Okonkwo | Feb 25, 2026 | john-davidson-bafta-cover.jpeg |
| BAFTA 2026: Winners... | bafta-2026.html | news | Chioma Okonkwo | Feb 23, 2026 | bafta-2026-cover.webp |
| Mother and Other Poems | mother-and-other-poems.html | poetry | Calvary | Feb 22, 2026 | mother-poems-cover.PNG |
| Early | early.html | short | Calvary | Feb 18, 2026 | early-cover.png |
| Miss Lady | miss-lady.html | flash | Calvary | Feb 17, 2026 | B4E36CD1-7C81-4ED0-BD27-63A125FDFD2D.png |

---

## Story Page Template Rules
Every story page must have:
1. Google Analytics tag in `<head>`
2. Favicon links: `<link rel="icon" type="image/png" href="../favicon.png">` and `<link rel="apple-touch-icon" href="../favicon.png">`
3. Full Open Graph + Twitter Card meta tags (absolute URLs)
4. Firebase + Disqus SDK scripts
5. Logo: `<div class="logo-icon" style="background:none;padding:0;"><img src="../logo-header.jpg" ...></div>`
6. Cover banner: `.story-cover-banner` with gradient overlay, badge above title, title at `1.1–1.4rem` (NOT 3–4rem)
7. Back link INSIDE `article-container`, below the banner (not above the banner)
8. `article-container` + `article-content` structure
9. Font: `1.15rem / 1.8 line-height` (mobile: `1rem`)
10. Firebase hit counter using `id="hit-count"` pattern
11. Footer meta row with badge + author/date
12. Disqus comments with Comments heading
13. Standard footer

Story pages use `../` relative paths for assets. Category pages use root-relative paths.

---

## Poetry Page Template Rules
Poetry collections follow the same template PLUS:
- `poem-collection-intro` class for "a collection of poems" subtitle (italic, Times New Roman via styles.css)
- `poem-contents` block with purple left border listing poem titles
- Purple gradient divider after contents block, before first poem
- Purple gradient dividers between each poem
- `poem-title` class for each poem title (Cochin, purple)
- `poem-stanza` class for poem body text (Cochin — NOT Times New Roman)
- Badge uses `badge-poetry` class (purple, defined in styles.css)

---

## Nav Structure (all pages)
The Search link must be INSIDE the `<ul>` tag — it was previously floating outside causing misalignment on desktop. Fixed across all pages Mar 22, 2026.

```html
<ul>
  <li>Home</li>
  <li class="has-dropdown">Stories...</li>
  <li>About</li>
  <li>Subscribe</li>
  <li>Contact</li>
  <li><a href="search.html">Search (with SVG icon)</a></li>
</ul>
```

---

## Homepage Features
- **Just Added strip** — 5 most recent stories, stable sort using array index as tiebreaker for same-date stories
- **Top 10** — sorted by Firebase hit count, horizontal scroll
- **Category rows** — News, Inspiring, Flash, Short, Poetry, Serial
- **NEW badge** — appears on cards for stories ≤7 days old (auto-expires)

---

## Category Pages
All dynamic — stories defined in a JS array at the bottom of each page. To add a new story: add entry to the array in the relevant category page AND in index.html AND in search.html.

---

## Search Page (search.html)
- Dark navy hero, live search, category filter pills
- Keyword highlighting in results
- Suggestion pills on idle screen
- URL parameter support: `search.html?q=keyword`

---

## Design System
- **Primary purple:** `#6b46c1`
- **Light purple:** `#8b5cf6`
- **Accent/gradient:** `linear-gradient(135deg, #6b46c1, #8b5cf6)`
- **Body font:** Cochin/Georgia serif
- **Italic text:** Times New Roman (enforced globally in styles.css)
- **Section dividers:** `<div style="width:100px;height:2px;background:linear-gradient(90deg,transparent,#6b46c1,transparent);margin:3rem auto;"></div>`
- **Cover banners:** gradient overlay `rgba(0,0,0,0.88)` bottom to transparent, title `1.1–1.4rem`
- **Category badges:** badge-news (red), badge-short (purple), badge-flash (purple), badge-poetry (purple), badge-inspiring (amber)
- **styles.css includes:** Times New Roman rule for italics, badge-poetry definition, poem-collection-intro and poem-contents p font rules

---

## Known Issues / Resolved
- ✅ Firebase security rules — fixed Mar 16
- ✅ Nav search link misalignment — fixed Mar 22 across all pages
- ✅ Favicon added to all pages — Mar 22
- ✅ badge-poetry was missing from styles.css — fixed Mar 22
- ✅ Just Added strip sort order for same-date stories — fixed with stable sort (array index tiebreaker)
- ⚠️ Cloudflare cache can be slow to update — purge via dashboard when needed

---

## What NOT to do
- Never put story titles in 3–4rem font on cover banners (keep at 1.1–1.4rem)
- Never move back link above the banner (it goes inside article-container, below banner)
- Never use `section.section > div.container` structure for story pages
- Never set poem stanza text to Times New Roman (Cochin only — Times is for italics only)
- Always add new stories to: story HTML + index.html + category page + search.html
- Always include favicon links on new story pages
- Always keep Search `<li>` inside the nav `<ul>`
