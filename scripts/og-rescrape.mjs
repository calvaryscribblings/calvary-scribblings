// OG RE-SCRAPE — force Facebook to forget a cached empty card.
//
//   node scripts/og-rescrape.mjs                    # PLAN. Lists the URLs, sends nothing.
//   node scripts/og-rescrape.mjs --apply            # re-scrape every published story.
//   node scripts/og-rescrape.mjs --apply --slug foo # one story.
//   node scripts/og-rescrape.mjs --verify           # ask Facebook what it holds, without
//                                                   # asking it to re-fetch. Read-only.
//
// Token comes from FB_APP_TOKEN in the environment. See "WHERE THE TOKEN COMES FROM" below.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
// ════════════════════════════════════════════════════════════════════════════════════════
// Every published story's og:image returned `502 Image fetch failed` for months, because the
// generated covers had no public-read rule in storage.rules and the OG worker re-fetches them
// without their download token. The rule is fixed and all 170 now serve a real PNG.
//
// THAT HEALS NOTHING ALREADY IN THE WILD. Facebook caches the RESULT of a scrape, including a
// failed one, and it does not re-scrape on its own on any schedule a publisher can rely on. A
// link shared last month keeps rendering the bare card it rendered last month. The only way to
// clear it is to ask for a re-scrape per URL, which the Sharing Debugger does one click at a
// time and this does in a batch.
//
// ⚠ THIS IS FACEBOOK ONLY. WhatsApp maintains a SEPARATE preview cache, exposes no debugger
// and no API, and there is no supported way to force it. It typically expires in about a
// month. So a link already shared on WhatsApp stays bare until it does; a NEWLY shared one is
// correct immediately. Anyone who has been reporting this deserves that answer plainly rather
// than being told the fix is total.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// WHERE THE TOKEN COMES FROM
// ════════════════════════════════════════════════════════════════════════════════════════
// An APP token, not a personal one — it does not expire and is not tied to anyone's login.
//
//   1. developers.facebook.com/apps → the Calvary Scribblings app (create one, type
//      "Business", if there is none — no review or permissions are needed for this).
//   2. Settings → Basic. Copy the App ID and the App Secret (Show).
//   3. The token is literally the two joined by a pipe:  FB_APP_TOKEN="<APP_ID>|<APP_SECRET>"
//
// The App Secret is a credential. Pass it in the environment, never on the command line where
// it lands in shell history, and never commit it.
//
//   FB_APP_TOKEN="123456789|abcdef..." node scripts/og-rescrape.mjs --apply
//
// A user token from the Graph API Explorer also works and is fine for a one-off, but it
// expires in an hour or two, which is why the app token is the documented route.

import { readFileSync } from 'node:fs';

const GRAPH = 'https://graph.facebook.com/v21.0/';
const SITE = 'https://calvaryscribblings.co.uk';
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify');
const ONLY = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;
const TOKEN = process.env.FB_APP_TOKEN;

// Concurrency is deliberately low. Facebook rate-limits scrape calls per app, and 170 URLs is
// small enough that there is nothing to win by pushing it — a 429 costs more than it saves.
const CONCURRENCY = 3;
const PAUSE_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Published slugs, read straight from the CMS node rather than from sitemap.xml — the sitemap
 *  is a build artefact and is currently one short (midday-in-peckham is published and absent
 *  from it). The cache to clear is keyed on URLs people actually shared, so the source of
 *  truth has to be the record, not the index. */
async function publishedSlugs() {
  const res = await fetch(`${DB}/cms_stories.json`);
  if (!res.ok) throw new Error(`cms_stories read failed: ${res.status}`);
  const all = await res.json();
  return Object.entries(all || {})
    .filter(([, s]) => s && typeof s === 'object' && s.published)
    .map(([slug]) => slug)
    .sort();
}

/** Ask Facebook to re-fetch a URL. `scrape=true` is the API behind the Sharing Debugger's
 *  "Scrape Again" button, and the response carries the OG data it just parsed — so the reply
 *  doubles as proof of what Facebook now holds, which is why the image is printed back. */
async function scrape(url) {
  const body = new URLSearchParams({ id: url, scrape: 'true', access_token: TOKEN });
  const res = await fetch(GRAPH, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** Read what Facebook holds WITHOUT asking it to re-fetch. Used by --verify. */
async function inspect(url) {
  const qs = new URLSearchParams({ id: url, fields: 'og_object{image},image,title', access_token: TOKEN });
  const res = await fetch(`${GRAPH}?${qs}`);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const imageOf = (j) => {
  const img = j?.image?.[0]?.url || j?.og_object?.image?.[0]?.url || j?.image?.url;
  return img || null;
};

async function main() {
  const slugs = ONLY ? [ONLY] : await publishedSlugs();
  const urls = slugs.map((s) => `${SITE}/stories/${s}`);

  console.log(`${urls.length} published story URL(s).`);

  if (!APPLY && !VERIFY) {
    console.log('\nPLAN — nothing sent. Re-run with --apply to clear Facebook\'s cache.\n');
    for (const u of urls.slice(0, 8)) console.log('   ', u);
    if (urls.length > 8) console.log(`    … and ${urls.length - 8} more`);
    console.log('\nNeeds FB_APP_TOKEN. See the header of this file for where to get one.');
    return;
  }

  if (!TOKEN) {
    console.error('\nREFUSED — FB_APP_TOKEN is not set.');
    console.error('  FB_APP_TOKEN="<APP_ID>|<APP_SECRET>" node scripts/og-rescrape.mjs --apply');
    console.error('  See the header of this file for where the two halves come from.');
    process.exit(1);
  }

  const verb = VERIFY ? 'inspecting' : 're-scraping';
  console.log(`\n${verb} ${urls.length} URL(s), ${CONCURRENCY} at a time…\n`);

  let ok = 0, withImage = 0;
  const failures = [];
  const queue = [...urls];

  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      const slug = url.split('/').pop();
      try {
        const { status, json } = VERIFY ? await inspect(url) : await scrape(url);
        if (json.error) {
          failures.push([slug, `${json.error.code}/${json.error.error_subcode ?? '-'} ${json.error.message}`]);
          console.log(`  ✗ ${slug.padEnd(46)} ${json.error.message}`);
        } else {
          ok++;
          const img = imageOf(json);
          if (img) withImage++;
          console.log(`  ${img ? '✓' : '·'} ${slug.padEnd(46)} ${status} ${img ? 'image ✓' : 'NO IMAGE IN RESPONSE'}`);
        }
      } catch (e) {
        failures.push([slug, e.message]);
        console.log(`  ✗ ${slug.padEnd(46)} ${e.message}`);
      }
      await sleep(PAUSE_MS);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n${ok}/${urls.length} succeeded · ${withImage} report an image`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILED:`);
    for (const [s, m] of failures) console.log(`   ${s}: ${m}`);
    // Error code 4 / subcode 2446079 is the app-level rate limit — wait and re-run; the
    // operation is idempotent, so a second pass over the whole list costs nothing but time.
    console.log('\n(Code 4 is the app rate limit. Wait ~15 minutes and re-run — this is idempotent.)');
    process.exit(1);
  }
  if (withImage < ok) {
    console.log('\n⚠ Some URLs came back with no image. Check the og:image on those pages directly.');
    process.exit(1);
  }
  console.log('\nFacebook\'s cache is cleared for every URL above.');
  console.log('⚠ WhatsApp caches separately, has no debugger, and typically expires in ~1 month.');
}

main().catch((e) => { console.error(e); process.exit(1); });
