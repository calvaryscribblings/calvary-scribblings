// ─────────────────────────────────────────────────────────────────────────────
// calvary-newsletter — Cloudflare Worker
// (subscribe / newsletter send + drafts / unsubscribe / scheduled-publish cron).
//
// DASHBOARD-MANAGED: the live source is edited in the Cloudflare dashboard, not in
// this repo's CI. THIS FILE is the deployable mirror — keep it byte-identical to
// what is pasted into the dashboard. Edit here, paste to the dashboard (or paste
// the dashboard source back here), and commit, so this Worker is never unversioned
// again.
//
// STORY-INDEX CONTRACT: buildIndexRecordMirror()/buildQuizSummaryMirror() below
// MIRROR app/lib/storyIndex.js (buildIndexRecord/buildQuizSummary) in the
// calvary-scribblings repo. The scheduled-publish flip writes cms_stories_index
// through them in the SAME atomic update that flips published, exactly as the
// admin's unhideStory() does. If that projection changes in the repo — a field
// added, removed, renamed, or a default tweaked — THIS Worker MUST change with it,
// or scheduled stories go live carrying a stale/partial index record and vanish
// from every index-fed surface (homepage, category pages, search, gateway-build,
// Voices). scripts/audit-stories-index.mjs has a scheduled-publish integrity
// section that flags exactly this drift; run it after any scheduled publish.
//
// CS-INLINE-V1 CONTRACT: renderInlineHtmlMirror()/renderInlineTextMirror() below
// MIRROR app/lib/newsletterRender.js under the same rule. Text blocks carrying
// format:"cs-inline-v1" are rendered through them; blocks WITHOUT a format field
// keep the original escape-everything path, byte for byte, so every issue and
// draft written before this change mails exactly as it always did. The repo copy
// drives the admin's live preview and the Worker copy drives the actual mail —
// if they drift, the preview lies, and mail cannot be recalled once sent.
// tests/newsletter/render.test.mjs is the contract for both.
// tests/newsletter/preview-parity.test.mjs is the other half of that contract:
// it asserts the admin preview's paragraphs — and its image blocks — are
// byte-identical to what buildEmail below actually emits, by slicing buildEmail
// out of THIS file and running it. Inline parity alone was not enough; the
// preview also has to segment paragraphs and gate formats the same way.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "https://calvaryscribblings.co.uk",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method === "POST" && url.pathname === "/subscribe") {
      try {
        const { email, name } = await request.json();
        if (!email || !email.includes("@")) {
          return Response.json({ error: "Valid email required" }, { status: 400, headers: cors });
        }
        const subsRes = await fetch(`${env.FIREBASE_DATABASE_URL}/subscribers.json?auth=${env.FIREBASE_SECRET}`);
        const subsData = await subsRes.json();
        if (subsData) {
          const existing = Object.values(subsData).find((s) => s.email === email);
          if (existing && existing.status !== "unsubscribed") {
            return Response.json({ error: "Already subscribed" }, { status: 409, headers: cors });
          }
        }
        // The write response was previously discarded. A rejected write — a
        // rules change, a bad secret, a validate failure on an over-long name —
        // was therefore invisible: the subscriber got a welcome email for a
        // subscription that had not been stored. Fail loudly instead.
        const writeRes = await fetch(`${env.FIREBASE_DATABASE_URL}/subscribers.json?auth=${env.FIREBASE_SECRET}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name: name || "", status: "active", subscribedAt: new Date().toISOString() }),
        });
        if (!writeRes.ok) {
          const detail = await writeRes.text();
          console.error("[subscribe] subscriber write failed:", writeRes.status, detail.slice(0, 300));
          return Response.json({ error: "Could not record subscription." }, { status: 502, headers: cors });
        }
        const firstName = name ? name.trim().split(" ")[0] : "there";
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
          body: JSON.stringify({
            // One identity, one source. This was the only hardcoded FROM in the
            // file; issues have always used env.FROM_EMAIL.
            from: `Calvary Scribblings <${env.FROM_EMAIL}>`,
            to: [email],
            subject: "You're on The Story Island — welcome to the newsletter",
            html: buildNewsletterWelcome({ email, firstName }),
          }),
        });
        return Response.json({ success: true }, { headers: cors });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: cors });
      }
    }

    if (request.method === "POST" && url.pathname === "/send") {
      try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || authHeader !== `Bearer ${env.NEWSLETTER_SEND_SECRET}`) {
          return Response.json({ error: "Unauthorised" }, { status: 401, headers: cors });
        }
        const body = await request.json();
        const { subject, blocks, issueNumber } = body;
        // testTo is the spec name; testEmail is what the admin UI has always
        // sent. Both accepted so the existing test button keeps working.
        const testEmail = body.testTo ?? body.testEmail;
        // A valid image counts as content; an invalid one does not, so an
        // image-only issue whose image is malformed cannot pass as "has body".
        const hasContent = Array.isArray(blocks) && blocks.some((b) => b && (b.type === "text" || b.type === "story" || (b.type === "image" && !imageBlockErrorMirror(b))));
        if (!subject || !hasContent) {
          return Response.json({ error: "subject and at least one text, image, or story block are required" }, { status: 400, headers: cors });
        }
        // Reject a bad image OUT LOUD rather than relying on the renderer's
        // fail-closed path. The renderer drops an invalid block silently, which
        // is right for the cron (there is nobody to tell, and holding the whole
        // issue over one picture is worse), but wrong here: an author who
        // forgot the alt text would watch the send succeed and never learn the
        // image was not in it. Mail cannot be recalled — say no first.
        const badImage = (blocks || []).filter((b) => b && b.type === "image").map((b) => imageBlockErrorMirror(b)).find(Boolean);
        if (badImage) {
          return Response.json({ error: badImage }, { status: 400, headers: cors });
        }
        // W6: a Send pressed on a saved or scheduled draft LOCKS that draft first, so the cron
        // cannot mail the same issue again at its scheduled time (before W6 it did: the draft
        // stayed 'scheduled' and was sent twice).
        const draftId = !testEmail && typeof body.draftId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.draftId) ? body.draftId : null;
        if (draftId) {
          const lock = await patchDraft(env, draftId, { status: "sending", sendingSince: new Date().toISOString() });
          if (!lock.ok) return Response.json({ error: `Could not lock the draft (HTTP ${lock.status}). Nothing was sent.` }, { status: 502, headers: cors });
        }
        const result = await sendNewsletter({ subject, blocks, issueNumber, testEmail }, env);
        if (draftId) await settleDraftAfterSend(env, draftId, result);
        // The addresses stay in the archive record (for the retry); the admin gets the counts.
        const { failedRecipients: _addresses, ...answer } = result;
        return Response.json(answer, { status: result.error ? (result.status || 400) : 200, headers: cors });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: cors });
      }
    }

    // W6: "Retry the ones that failed" — mails the failedRecipients of one newsletter_sends record,
    // and nobody else, then writes the outcome back onto that record.
    if (request.method === "POST" && url.pathname === "/retry") {
      try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || authHeader !== `Bearer ${env.NEWSLETTER_SEND_SECRET}`) {
          return Response.json({ error: "Unauthorised" }, { status: 401, headers: cors });
        }
        const { sendId } = await request.json();
        if (typeof sendId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sendId)) {
          return Response.json({ error: "sendId required" }, { status: 400, headers: cors });
        }
        const recUrl = `${env.FIREBASE_DATABASE_URL}/newsletter_sends/${sendId}.json?auth=${env.FIREBASE_SECRET}`;
        const recRes = await fetch(recUrl);
        if (!recRes.ok) return Response.json({ error: `Could not read that send (HTTP ${recRes.status}). Nothing was sent.` }, { status: 502, headers: cors });
        const rec = await recRes.json();
        const pending = Array.isArray(rec?.failedRecipients) ? rec.failedRecipients : [];
        if (!pending.length) return Response.json({ error: "Nobody is waiting on that send. Nothing was sent." }, { status: 409, headers: cors });
        // Lock: clear the list before sending, so two taps cannot mail it twice.
        const lock = await fetch(recUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ failedRecipients: null, retrying: true }) });
        if (!lock.ok) return Response.json({ error: `Could not lock that send (HTTP ${lock.status}). Nothing was sent.` }, { status: 502, headers: cors });
        const result = await sendNewsletter({ subject: rec.subject, blocks: rec.blocks, issueNumber: rec.issueNumber, onlyTo: pending, archive: false }, env);
        const sentNow = result.sent || 0;
        // Anything not confirmed sent is still owed: on a refusal before any batch, that is all of them.
        const still = Array.isArray(result.failedRecipients) && (result.sent || result.failed) ? result.failedRecipients : pending;
        const stillFailed = still.length;
        await fetch(recUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientCount: (rec.recipientCount || 0) + sentNow,
            failedCount: stillFailed,
            failedRecipients: stillFailed > 0 ? still : null,
            retrying: null,
            retriedAt: new Date().toISOString(),
          }),
        });
        const { failedRecipients: _addresses, ...answer } = result;
        return Response.json({ ...answer, retriedFor: pending.length, stillFailed }, { status: result.error ? (result.status || 400) : 200, headers: cors });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: cors });
      }
    }

    if (request.method === "POST" && url.pathname === "/draft") {
      try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || authHeader !== `Bearer ${env.NEWSLETTER_SEND_SECRET}`) {
          return Response.json({ error: "Unauthorised" }, { status: 401, headers: cors });
        }
        const body = await request.json();
        const { id, subject, issueNumber, scheduledAt } = body;
        const blocks = Array.isArray(body.blocks)
          ? body.blocks
          : [
              ...(body.intro && body.intro.trim() ? [{ type: "text", id: Date.now().toString(), content: body.intro }] : []),
              ...((body.stories || []).map((s, i) => ({ type: "story", id: (Date.now() + i + 1).toString(), ...s }))),
            ];
        const draftId = id || Date.now().toString();
        const draft = {
          id: draftId,
          subject: subject || "",
          blocks,
          issueNumber: issueNumber || null,
          scheduledAt: scheduledAt || null,
          savedAt: new Date().toISOString(),
          // W6: scheduledAt arrives as UTC ISO from the admin; see scheduledMs() for older drafts.
          status: scheduledAt ? "scheduled" : "draft",
        };
        const put = await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts/${draftId}.json?auth=${env.FIREBASE_SECRET}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        // W6: the write's own answer. A refused PUT used to come back as "Draft saved!".
        if (!put.ok) return Response.json({ error: `The draft was not saved (database refused it: HTTP ${put.status}).` }, { status: 502, headers: cors });
        return Response.json({ success: true, id: draftId, status: draft.status, scheduledAt: draft.scheduledAt }, { headers: cors });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: cors });
      }
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/draft/")) {
      try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || authHeader !== `Bearer ${env.NEWSLETTER_SEND_SECRET}`) {
          return Response.json({ error: "Unauthorised" }, { status: 401, headers: cors });
        }
        const draftId = url.pathname.split("/draft/")[1];
        const del = await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts/${draftId}.json?auth=${env.FIREBASE_SECRET}`, { method: "DELETE" });
        if (!del.ok) return Response.json({ error: `The draft was not deleted (database refused it: HTTP ${del.status}).` }, { status: 502, headers: cors });
        return Response.json({ success: true }, { headers: cors });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: cors });
      }
    }

    if (request.method === "GET" && url.pathname === "/drafts") {
      try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || authHeader !== `Bearer ${env.NEWSLETTER_SEND_SECRET}`) {
          return Response.json({ error: "Unauthorised" }, { status: 401, headers: cors });
        }
        const res = await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts.json?auth=${env.FIREBASE_SECRET}`);
        const data = await res.json();
        return Response.json(data || {}, { headers: cors });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: cors });
      }
    }

    if (request.method === "GET" && url.pathname === "/unsubscribe") {
      const token = url.searchParams.get("token");
      if (!token) return new Response(unsubscribePage("Invalid link.", false), { headers: { "Content-Type": "text/html" } });
      try {
        const email = atob(token);
        if (!email || !email.includes("@")) {
          return new Response(unsubscribePage("Invalid unsubscribe link.", false), { headers: { "Content-Type": "text/html" } });
        }
        const dbUrl = `${env.FIREBASE_DATABASE_URL}/subscribers.json?auth=${env.FIREBASE_SECRET}`;
        const subsRes = await fetch(dbUrl);
        const subsData = await subsRes.json();
        if (!subsData) return new Response(unsubscribePage("Email not found.", false), { headers: { "Content-Type": "text/html" } });
        const entry = Object.entries(subsData).find(([, v]) => v.email === email);
        if (!entry) return new Response(unsubscribePage("Email not found in our list.", false), { headers: { "Content-Type": "text/html" } });
        const [key] = entry;
        await fetch(`${env.FIREBASE_DATABASE_URL}/subscribers/${key}.json?auth=${env.FIREBASE_SECRET}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "unsubscribed" }),
        });
        return new Response(unsubscribePage(email, true), { headers: { "Content-Type": "text/html" } });
      } catch (err) {
        return new Response(unsubscribePage("Something went wrong.", false), { headers: { "Content-Type": "text/html" } });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(processScheduled(env));
  },
};

// buildIndexRecordMirror / buildQuizSummaryMirror — see the STORY-INDEX CONTRACT
// header. These are a hand-copy of app/lib/storyIndex.js:buildIndexRecord and
// buildQuizSummary; the Worker cannot import that module, so the projection is
// duplicated here and MUST be kept in lockstep with it.
function buildQuizSummaryMirror(quizMeta) {
  const q = quizMeta || {};
  return q.hasQuiz ? { hasQuiz: true, scribblesReward: q.scribblesReward ?? 50 } : null;
}

// indexReadTimeMirror — mirrors app/lib/storyIndex.js:indexReadTime, itself a
// byte-for-byte reimplementation of the app's lib/storyDerived.ts:37. 220 wpm,
// empty/missing content → 0.
//
//   ⚠ PRESERVE THE QUIRK: this counts RAW HTML TOKENS — there is no stripHtml, so
//   markup counts as words (`<p>` is one token, `<a href="…">` is two). That is NOT
//   a bug to fix here. The app renders this exact number on the story page today,
//   and the index exists so its search/profile/author-list surfaces can show THE
//   SAME number without fetching content. A scheduled publish that "corrected" the
//   count would ship a story whose index readTime disagrees with its own story
//   page — cross-platform parity outranks correctness. If it is ever fixed, it is
//   fixed in lib/storyDerived.ts, app/lib/storyIndex.js AND here, in one change.
function indexReadTimeMirror(content) {
  if (!content || typeof content !== "string") return 0;
  return Math.ceil(content.split(/\s+/).filter(Boolean).length / 220);
}

// publishedAtMsMirror — mirrors app/lib/storyAccess.js:publishedAtMsFor.
//
//   ⚠ THIS ONE IS NOT COSMETIC. Every other field in the projection below decides
//   how a card LOOKS. This one decides whether a reader can READ the story: the
//   story-serving endpoint resolves the most-recent-5 free floor with an ordered
//   query on cms_stories_index.publishedAtMs, so a scheduled publish that omits it
//   writes a record the floor cannot see. See STORY-SERVING-CONTRACT.md §3.2, §8.
//
//   Epoch MILLISECONDS, UTC, a NUMBER — never an ISO string, which would compare
//   against a clock as a string and never expire. publishAt wins over the display
//   date because it is the real publication moment written by code rather than typed
//   by a person; a dayless "Jan 2026" takes the 1st, the earliest day it can mean;
//   anything unreadable is null and is NOT guessed at.
//
//   Date.UTC, never new Date(str) — the latter parses in the runtime's LOCAL zone,
//   and this Worker's zone is whatever Cloudflare picked.
function publishedAtMsMirror(story) {
  const s = story || {};
  if (typeof s.publishAt === "string" && s.publishAt) {
    const t = Date.parse(s.publishAt);
    if (Number.isFinite(t)) return t;
  }
  const str = String(s.date || "").trim();
  if (!str) return null;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mi = (w) => MONTHS.indexOf(String(w || "").toLowerCase().slice(0, 3));
  let m = /^([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s+(\d{4})$/.exec(str);
  if (m) {
    const i = mi(m[1]); const d = Number(m[2]);
    return i >= 0 && d >= 1 && d <= 31 ? Date.UTC(Number(m[3]), i, d) : null;
  }
  m = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(str);
  if (m) { const i = mi(m[1]); return i >= 0 ? Date.UTC(Number(m[2]), i, 1) : null; }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

function buildIndexRecordMirror(slug, story) {
  const s = story || {};
  const rec = {
    title: s.title || "",
    author: s.author || "",
    authorUid: s.authorUid || "",
    // authorHandle + readTime feed the app's search / profile myStories / user
    // author-list surfaces, which read the index alone. Nothing in the Worker or
    // the main repo reads them back — they are still load-bearing.
    authorHandle: s.authorHandle || "",
    category: s.category || "",
    categoryName: s.categoryName || "",
    subcategory: s.subcategory || "",
    cover: s.cover || "",
    coverHash: s.coverHash || "",
    trailerQuote: s.trailerQuote || "",
    date: s.date || "",
    published: s.published !== false,
    featuredPin: s.featuredPin === true,
    readerMode: s.readerMode === true,
    bookReader: s.bookReader === true,
    readTime: indexReadTimeMirror(s.content),
    publishedAtMs: publishedAtMsMirror(s),
    url: s.url || `/stories/${slug}`,
  };
  if (s.publishAt) rec.publishAt = s.publishAt;
  if (s.coverSizes) rec.coverSizes = s.coverSizes;
  const quiz = buildQuizSummaryMirror(s.quizMeta);
  if (quiz) rec.quiz = quiz;
  return rec;
}

// One cron tick, TWO independent jobs. They used to share a single try and a
// single early `return`: an empty cms_stories read — or a throwing one, since a
// Firebase 5xx answers with HTML and res.json() throws — skipped every due
// newsletter for that tick and said so only as "Cron error". The drafts were not
// deleted, so the next tick retried and the issue went out late; a persistent
// fault on the stories read held the mail indefinitely, silently. Neither half
// may take the other down. tests/newsletter/cron-path.test.mjs is the acceptance.
async function processScheduled(env) {
  const now = new Date();
  let published = false;
  try {
    published = await publishDueStories(env, now);
  } catch (err) {
    console.error("Cron error (story publish):", err);
  }
  try {
    await sendDueNewsletters(env, now);
  } catch (err) {
    console.error("Cron error (scheduled newsletters):", err);
  }
  // W4 (Ikenna's rulings, 24–25 Sep 2026) — THE REBUILD AFTER EVERY LONDON MIDNIGHT.
  // The site is a static export and the free week ends at Monday 00:00 London, when the whole
  // week goes to the archive; the archive gate itself switches on at 30 Sept 00:00 London (a
  // Wednesday). A story page built before either instant carries a body that has just become
  // an archive story's, so a build must run right after. This tick is the first after every
  // London midnight — which covers every Monday and the switch without this Worker holding a
  // copy of any date. London's hour comes from Intl, so it stays right across BST/GMT. Until
  // the new build is live the story page refuses the body itself (app/lib/storyLock.js).
  const midnight = isFirstTickAfterLondonMidnight(now);
  if (midnight) console.log("London midnight: firing the rebuild for the free week / archive gate.");
  let hook = null;
  if (published || midnight) hook = await fireDeployHook(env);
  // W7: the heartbeat scripts/launch-check.mjs reads — the tick ran to its end. A tick that never
  // runs (a disabled cron, a broken deploy) leaves it stale, and stale is red.
  try {
    const hb = await fetch(`${env.FIREBASE_DATABASE_URL}/ops/publish_heartbeat.json?auth=${env.FIREBASE_SECRET}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastTickAt: now.getTime(), published, midnight, hook }),
    });
    if (!hb.ok) console.error(`Heartbeat not written: HTTP ${hb.status}`);
  } catch (err) {
    console.error(`Heartbeat not written (${err?.name || "Error"})`);
  }
}

// True in the first 15 minutes after 00:00 Europe/London — exactly one */15 tick per day.
function isFirstTickAfterLondonMidnight(now) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour").value);
    const minute = Number(parts.find((p) => p.type === "minute").value);
    return hour === 0 && minute < 15;
  } catch {
    return false;
  }
}

// W1 (24 Sep 2026) — THE HOOK IS A WORKER SECRET, NEVER A LITERAL. This line used to hold
// the URL itself, and this file is mirrored into a PUBLIC repo. That URL was one of the two
// rotated on 26 Aug (tests/ci/deploy-hook-secrecy.test.mjs), so from then until W1 every
// scheduled flip POSTed a hook that no longer existed — Cloudflare answered 404 "The deploy
// hook you have specified does not exist", and fetch() does not throw on a 404, so nothing
// was logged. The flipped stories still had pages (the build pre-renders anything with a
// publishAt), but every baked list waited for an unrelated deploy.
//
// Set it in the dashboard: calvary-newsletter → Settings → Variables and Secrets → Secret
// CMS_DEPLOY_HOOK_URL — the same hook the Pages project uses for stories. Absent, or refused,
// is now said out loud rather than swallowed. The URL is never printed.
async function fireDeployHook(env) {
  const hook = env.CMS_DEPLOY_HOOK_URL;
  if (!hook) {
    console.error("Deploy hook NOT fired: CMS_DEPLOY_HOOK_URL is not set on this Worker. Stories went live; the site was NOT rebuilt.");
    return "unconfigured";
  }
  try {
    const res = await fetch(hook, { method: "POST" });
    if (!res.ok) {
      console.error(`Deploy hook refused: HTTP ${res.status}. Stories went live; the site was NOT rebuilt.`);
      return "refused";
    }
    return "fired";
  } catch (err) {
    console.error(`Deploy hook unreachable (${err?.name || "Error"}). Stories went live; the site was NOT rebuilt.`);
    return "unreachable";
  }
}

// W6 (ADM-04, ADM-05) — WHICH STORIES THIS TICK MAY PUBLISH. Pure; tests/ci/w6-worker.test.mjs
// slices it out of this file and runs it.
//
//   'publish'      published:false, a publishAt that has arrived, a generated cover, no hold
//   'hidden'       an editor took it down (hiddenAt). Before W6, Hide wrote only published:false,
//                  and this loop republished any published:false story with a past publishAt —
//                  48 live stories carried one — so a Hide lasted until the next */15 tick.
//   'no_cover'     still held for its cover (coverHold), or carrying no generated cover at all.
//                  Before W6 this loop ignored coverHold, so a story whose cover worker was late
//                  or red went live coverless. It is skipped, and an alert is written.
//   null           not due (already live, never scheduled, or scheduled for later)
function publishDecision(story, now) {
  if (!story || typeof story !== "object") return null;
  if (story.published || !story.publishAt) return null;
  const at = new Date(story.publishAt).getTime();
  if (!Number.isFinite(at) || at > now.getTime()) return null;
  if (story.hiddenAt) return "hidden";
  if (story.coverHold === true || !/covers-typographic/.test(String(story.cover || ""))) return "no_cover";
  return "publish";
}

// Returns true if anything went live, which is what earns the rebuild.
async function publishDueStories(env, now) {
  const res = await fetch(`${env.FIREBASE_DATABASE_URL}/cms_stories.json?auth=${env.FIREBASE_SECRET}`);
  if (!res.ok) throw new Error(`cms_stories read failed: HTTP ${res.status}`);
  const stories = await res.json();
  let published = false;
  if (stories && typeof stories === "object") {
    for (const [slug, story] of Object.entries(stories)) {
      const decision = publishDecision(story, now);
      if (!decision || decision === "hidden") continue;
      if (decision === "no_cover") {
        await alertSkippedPublish(env, slug, story, now);
        continue;
      }
      try {
        // Flip published AND write the slim index record in ONE atomic multi-path
        // PATCH (root .json). A bare `cms_stories/<slug>/published: true` write would
        // leave the now-live story with NO cms_stories_index entry — invisible on
        // every index-fed surface (homepage, category pages, search, gateway-build,
        // Voices) since the Phase A cut-over. This mirrors the admin's unhideStory():
        // the story object read here is still pre-flip, so project { ...story,
        // published: true } to get published:true into the index record.
        const indexRecord = buildIndexRecordMirror(slug, { ...story, published: true });
        const flip = await fetch(`${env.FIREBASE_DATABASE_URL}/.json?auth=${env.FIREBASE_SECRET}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [`cms_stories/${slug}/published`]: true,
            [`cms_stories_index/${slug}`]: indexRecord,
            // A skip alert for this story, if one was raised, is answered by this publish.
            [`ops/publish_skips/${slug}`]: null,
          }),
        });
        // W6: the write's own answer. fetch() does not throw on a refusal, so a PATCH the
        // database turned down used to count as a publish and earn a rebuild.
        if (!flip.ok) { console.error(`Publish of ${slug} refused: HTTP ${flip.status}`); continue; }
        published = true;
      } catch (err) {
        console.error(`Failed to publish story ${slug}:`, err);
      }
    }
  }
  return published;
}

// W6 (ADM-05): a scheduled story reached its time without a cover. It is NOT published; the
// alert lands at ops/publish_skips/{slug}, which /admin shows at the top of the story list
// until the story publishes (the flip above clears it) or a founder dismisses it. Written
// once per story, not on every tick.
async function alertSkippedPublish(env, slug, story, now) {
  const url = `${env.FIREBASE_DATABASE_URL}/ops/publish_skips/${slug}.json?auth=${env.FIREBASE_SECRET}`;
  try {
    const existing = await (await fetch(url)).json();
    if (existing) return;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        title: String(story.title || slug).slice(0, 200),
        publishAt: story.publishAt,
        reason: story.coverHold === true ? "held_for_cover" : "no_generated_cover",
        at: now.getTime(),
      }),
    });
    console.error(`NOT PUBLISHED: ${slug} was due at ${story.publishAt} but has no cover. Alert ${res.ok ? "raised" : `FAILED (HTTP ${res.status})`}.`);
  } catch (err) {
    console.error(`NOT PUBLISHED: ${slug} has no cover, and the alert could not be written (${err?.name || "Error"}).`);
  }
}

// W6 (ADM-22) — WHEN A DRAFT IS DUE. The admin now sends `scheduledAt` as UTC ISO ("…Z"). Drafts
// saved before W6 carry a zoneless datetime-local string ("2026-10-01T09:00"), which workerd reads
// as UTC — so every one scheduled during BST sent an hour late. A zoneless value is Europe/London
// wall time, which is what the person typing it meant. Pure; mirrored by app/lib/londonTime.js and
// held to the same cases by tests/ci/w6-worker.test.mjs.
function londonWallToUtcMs(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(wall || "").trim());
  if (!m) return NaN;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const offsetAt = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}
function scheduledMs(value) {
  const v = String(value || "").trim();
  if (!v) return NaN;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)) return Date.parse(v);
  return londonWallToUtcMs(v);
}

async function patchDraft(env, id, fields) {
  return fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts/${id}.json?auth=${env.FIREBASE_SECRET}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

async function sendDueNewsletters(env, now) {
  const draftsRes = await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts.json?auth=${env.FIREBASE_SECRET}`);
  if (!draftsRes.ok) throw new Error(`newsletter_drafts read failed: HTTP ${draftsRes.status}`);
  const drafts = await draftsRes.json();
  if (!drafts || typeof drafts !== "object") return;
  for (const [id, draft] of Object.entries(drafts)) {
    if (draft.status !== "scheduled" || !draft.scheduledAt) continue;
    const at = scheduledMs(draft.scheduledAt);
    if (!Number.isFinite(at) || at > now.getTime()) continue;
    try {
      // W6: LOCK FIRST. Only a 'scheduled' draft is picked up, so a draft marked 'sending' can
      // never be mailed twice — not by the next tick, not by a Send pressed on it in the admin.
      const lock = await patchDraft(env, id, { status: "sending", sendingSince: now.toISOString() });
      if (!lock.ok) { console.error(`Scheduled newsletter ${id} not sent: the lock was refused (HTTP ${lock.status}).`); continue; }
      const result = await sendNewsletter({ subject: draft.subject, blocks: draft.blocks, intro: draft.intro, stories: draft.stories, issueNumber: draft.issueNumber }, env);
      await settleDraftAfterSend(env, id, result);
    } catch (err) {
      console.error(`Failed to send scheduled newsletter ${id}:`, err);
      try { await patchDraft(env, id, { status: "failed", failure: String(err?.message || err).slice(0, 300) }); } catch { /* logged above */ }
    }
  }
}

// After a send that came from a draft: a clean send removes the draft (the issue is archived in
// newsletter_sends); anything else keeps it, marked 'failed' with the counts, so it is neither
// lost nor re-sent by a later tick. Before W6 the draft was deleted whatever happened.
async function settleDraftAfterSend(env, id, result) {
  if (result && result.success && result.failed === 0) {
    const del = await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts/${id}.json?auth=${env.FIREBASE_SECRET}`, { method: "DELETE" });
    if (!del.ok) console.error(`Newsletter ${id} was sent, but its draft could not be removed (HTTP ${del.status}).`);
    return;
  }
  await patchDraft(env, id, {
    status: "failed",
    failure: result?.error ? String(result.error).slice(0, 300) : null,
    sent: result?.sent ?? 0,
    failedCount: result?.failed ?? 0,
    sendId: result?.sendId ?? null,
  });
}

function normaliseBlocks({ blocks, intro, stories }) {
  if (Array.isArray(blocks)) return blocks;
  const out = [];
  if (typeof intro === "string" && intro.trim()) {
    out.push({ type: "text", id: Date.now().toString(), content: intro });
  }
  (stories || []).forEach((s, i) => {
    out.push({ type: "story", id: (Date.now() + i + 1).toString(), ...s });
  });
  return out;
}

// Resolves { success, mode, sent, failed, allowlistOpen, sendId } — or { error, status } when
// nothing was sent. W6: `status` is the HTTP status the /send route answers with, so a refusal is a
// refusal on the wire too (before W6 every one of these came back as HTTP 200, and the admin, which
// checked only res.ok, said "Test sent" for a test the allowlist had refused).
//
// `onlyTo` (W6) sends to exactly those addresses — the retry of a partial send, which must mail the
// ones that failed and nobody who already has the issue.
async function sendNewsletter({ subject, blocks, intro, stories, issueNumber, testEmail, onlyTo, archive = true }, env) {
  const normalisedBlocks = normaliseBlocks({ blocks, intro, stories });
  let emails = [];
  if (Array.isArray(onlyTo)) {
    emails = onlyTo.filter((e) => typeof e === "string" && e.includes("@"));
  } else {
    const subsRes = await fetch(`${env.FIREBASE_DATABASE_URL}/subscribers.json?auth=${env.FIREBASE_SECRET}`);
    if (!subsRes.ok) return { error: `Could not read the subscriber list (HTTP ${subsRes.status}). Nothing was sent.`, status: 502 };
    const subsData = await subsRes.json();
    if (subsData && typeof subsData === "object") {
      emails = Object.values(subsData).filter((s) => s.email && s.status !== "unsubscribed").map((s) => s.email);
    }
  }
  let allowlistOpen = false;
  if (testEmail) {
    // A single-address test send already existed; what it lacked was any limit
    // on WHICH address. TEST_SEND_ALLOWLIST (comma-separated, case-insensitive)
    // closes that. It fails OPEN when unset rather than closed, deliberately:
    // the acceptance test for a freshly pasted Worker IS a test send, and a
    // Worker that could not send one until an env var existed would be
    // unverifiable at exactly the moment verification matters. The response
    // reports allowlistOpen so an unconfigured Worker says so out loud.
    const raw = String(env.TEST_SEND_ALLOWLIST || "").trim();
    if (!raw) {
      allowlistOpen = true;
    } else {
      const allowed = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (!allowed.includes(String(testEmail).trim().toLowerCase())) {
        return { error: `Test sends are restricted. ${testEmail} is not on TEST_SEND_ALLOWLIST. Nothing was sent.`, status: 403 };
      }
    }
    emails = [testEmail];
  }
  if (emails.length === 0) return { error: "No active subscribers. Nothing was sent.", status: 409 };
  const html = buildEmail({ subject, blocks: normalisedBlocks, issueNumber });
  const text = buildEmailText({ subject, blocks: normalisedBlocks, issueNumber });
  const BATCH_SIZE = 50;
  let sent = 0;
  let failed = 0;
  const failedRecipients = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const batchPayload = batch.map((email) => ({
      from: `Calvary Scribblings <${env.FROM_EMAIL}>`,
      to: [email],
      subject: testEmail ? `[TEST] ${subject}` : subject,
      html: html.replace("token=TOKEN", `token=${btoa(email)}`),
      text: text.replace("token=TOKEN", `token=${btoa(email)}`),
    }));
    let ok = false;
    try {
      const resendRes = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify(batchPayload),
      });
      ok = resendRes.ok;
      if (!ok) console.error(`[send] Resend refused a batch of ${batch.length}: HTTP ${resendRes.status}`);
    } catch (err) {
      console.error(`[send] a batch of ${batch.length} could not reach Resend (${err?.name || "Error"})`);
    }
    if (ok) { sent += batch.length; } else { failed += batch.length; failedRecipients.push(...batch); }
  }
  let sendId = null;
  if (!testEmail && archive) {
    const logRes = await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_sends.json?auth=${env.FIREBASE_SECRET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        issueNumber: issueNumber || null,
        sentAt: new Date().toISOString(),
        recipientCount: sent,
        failedCount: failed,
        // W6: who did NOT get it, so "Retry the ones that failed" can reach exactly them.
        failedRecipients: failedRecipients.length ? failedRecipients : null,
        retryOf: Array.isArray(onlyTo) ? "retry" : null,
        storySlugs: normalisedBlocks.filter((b) => b.type === "story").map((b) => b.slug),
        // The archive. Until now this record held metadata only, so the body of
        // every issue ever sent was unrecoverable the moment the draft was
        // deleted — seven issues are already gone that way. Storing the blocks
        // makes a sent issue reproducible: the same array through the same
        // renderer yields the same mail. `formats` is a cheap census so a future
        // grammar version can find which archived issues predate it.
        blocks: normalisedBlocks,
        formats: [...new Set(normalisedBlocks.filter((b) => b.type === "text").map((b) => b.format || "legacy-escaped"))],
      }),
    });
    if (logRes.ok) { try { sendId = (await logRes.json())?.name || null; } catch { /* the mail went; only the id is missing */ } }
    else console.error(`[send] the issue was mailed but its archive record was refused (HTTP ${logRes.status})`);
  }
  if (sent === 0) return { error: `The mail service refused every batch. None of the ${failed} emails went.`, status: 502, sent, failed, sendId, failedRecipients };
  return { success: true, mode: testEmail ? "test" : "live", sent, failed, allowlistOpen, sendId, failedRecipients };
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── cs-inline-v1 ─────────────────────────────────────────────────────────────
// Hand-copy of app/lib/newsletterRender.js — see the CS-INLINE-V1 CONTRACT note
// in the header. Keep character-identical to that module.
//
//   **bold**  *italic*  __underline__  [text](https://…)  \* \_ \[ \] \\
//
// Escape first, then substitute only recognised markers. Unrecognised input —
// a stray <, an unclosed **, a javascript: URL — stays escaped as literal text.
const CS_L0 = "\u0000";
const CS_E0 = "\u0001";
const CS_SENTINELS = /[\u0000\u0001]/g;
const CS_LINK_SLOT = /\u0000(\d+)\u0000/g;
const CS_ESC_SLOT = /\u0001(\d+)\u0001/g;
const CS_SAFE_URL = /^https?:\/\//i;
const CS_LINK = /\[([^\]\n]*)\]\(([^\s)]+)\)/g;
const CS_BACKSLASH = /\\([*_[\]\\])/g;

function csEmphasisHtml(s) {
  return s
    .replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^\n]+?)__/g, '<u style="text-decoration:underline;">$1</u>')
    .replace(/\*([^\n*]+?)\*/g, "<em>$1</em>");
}

function csEmphasisStrip(s) {
  return s
    .replace(/\*\*([^\n]+?)\*\*/g, "$1")
    .replace(/__([^\n]+?)__/g, "$1")
    .replace(/\*([^\n*]+?)\*/g, "$1");
}

function csExtract(src) {
  let s = String(src ?? "").replace(CS_SENTINELS, "");
  const escaped = [];
  s = s.replace(CS_BACKSLASH, (_m, ch) => `${CS_E0}${escaped.push(ch) - 1}${CS_E0}`);
  const links = [];
  s = s.replace(CS_LINK, (m, text, url) => {
    if (!CS_SAFE_URL.test(url)) return m;
    return `${CS_L0}${links.push({ text, url }) - 1}${CS_L0}`;
  });
  return { s, escaped, links };
}

function renderInlineHtmlMirror(src) {
  const { s: raw, escaped, links } = csExtract(src);
  let s = csEmphasisHtml(escHtml(raw));
  s = s.replace(CS_LINK_SLOT, (_m, i) => {
    const { text, url } = links[Number(i)];
    return `<a href="${escHtml(url)}" style="color:#6b2fad;">${csEmphasisHtml(escHtml(text))}</a>`;
  });
  return s.replace(CS_ESC_SLOT, (_m, i) => escHtml(escaped[Number(i)]));
}

function renderInlineTextMirror(src) {
  const { s: raw, escaped, links } = csExtract(src);
  let s = csEmphasisStrip(raw);
  s = s.replace(CS_LINK_SLOT, (_m, i) => {
    const { text, url } = links[Number(i)];
    return `${csEmphasisStrip(text)} (${url})`;
  });
  return s.replace(CS_ESC_SLOT, (_m, i) => escaped[Number(i)]);
}

// ── Image blocks ─────────────────────────────────────────────────────────────
// Hand-copy of app/lib/newsletterRender.js:imageBlockError / renderImageHtml /
// renderImageText, under the same lockstep rule as the inline renderers above.
//
// 540 = the 620px shell minus the 40px cell padding on each side. Hard-coded in
// the width attribute because Outlook's Word engine ignores CSS width on images
// and will otherwise render the intrinsic pixel size; max-width:100% and
// height:auto then let every other client scale it down on narrow screens.
//
// FAIL CLOSED. A block with a non-https src, or with no alt text, renders
// NOTHING — no img, no empty cell, no placeholder. The composer refuses to save
// such a block and this refuses to render one, so a malformed block cannot
// reach an inbox by any route. https only: mail clients increasingly refuse
// mixed content, and an http image in an https mail view is a broken picture.
const IMAGE_WIDTH_MIRROR = 540;
const IMAGE_SRC_MIRROR = /^https:\/\//i;

function imageBlockErrorMirror(block) {
  const b = block || {};
  const src = String(b.src ?? "").trim();
  const alt = String(b.alt ?? "").trim();
  if (!src) return "Image needs a source — upload a file first.";
  if (!IMAGE_SRC_MIRROR.test(src)) return "Image source must be an absolute https:// URL.";
  if (!alt) return "Alt text is required — most mail clients block images, and alt text is all those readers get.";
  return null;
}

function renderImageHtmlMirror(block) {
  if (imageBlockErrorMirror(block)) return "";
  const src = String(block.src).trim();
  const alt = String(block.alt).trim();
  return `<img src="${escHtml(src)}" alt="${escHtml(alt)}" width="${IMAGE_WIDTH_MIRROR}" style="display:block;max-width:100%;height:auto;border-radius:6px;" />`;
}

function renderImageTextMirror(block) {
  if (imageBlockErrorMirror(block)) return "";
  return `[image: ${String(block.alt).trim()}]`;
}

// The mail's text/plain part, derived from the SAME block array the HTML came
// from so the two parts cannot drift. Resend previously received only `html`,
// which meant no author-controlled plain-text alternative existed at all.
function buildEmailText({ subject, blocks, issueNumber }) {
  const lines = [`Calvary Scribblings — Issue #${issueNumber || "—"}`, subject || "", ""];
  for (const b of blocks || []) {
    if (!b || !b.type) continue;
    if (b.type === "text") {
      const body = b.format === "cs-inline-v1"
        ? renderInlineTextMirror(b.content)
        : String(b.content || "");
      const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
      if (paras.length) lines.push(paras.join("\n\n"), "");
    } else if (b.type === "divider") {
      lines.push("—".repeat(24), "");
    } else if (b.type === "image") {
      // `[image: alt]`, not the URL — the src is a signed storage link that is
      // unreadable noise in a text mail, while the alt text is the actual
      // information the picture was carrying.
      const line = renderImageTextMirror(b);
      if (line) lines.push(line, "");
    } else if (b.type === "story") {
      lines.push(
        `${b.category || "Fiction"} — ${b.title || ""}`,
        `by ${b.author || ""}`,
        ...(b.excerpt ? [String(b.excerpt).slice(0, 120)] : []),
        `https://calvaryscribblings.co.uk/stories/${b.slug}`,
        ""
      );
    }
  }
  lines.push(
    "More stories are waiting for you: https://calvaryscribblings.co.uk",
    "",
    "You're receiving this because you subscribed to Calvary Scribblings.",
    "Calvary Media UK Ltd. · calvaryscribblings.co.uk",
    "Unsubscribe: https://calvary-newsletter.calvarymediauk.workers.dev/unsubscribe?token=TOKEN"
  );
  return lines.join("\n");
}

function buildNewsletterWelcome({ email, firstName }) {
  const purple = "#6b2fad";
  const unsubToken = btoa(email);
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f8f7fc;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0;">
    <table width="620" cellpadding="0" cellspacing="0" style="background:#fff;max-width:620px;width:100%;">
      <tr><td style="background:${purple};padding:36px 40px 28px;text-align:center;">
        <h1 style="color:#fff;font-size:30px;font-weight:700;margin:0 0 6px;font-family:Georgia,serif;">Calvary Scribblings</h1>
        <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0;font-family:Arial,sans-serif;letter-spacing:1px;">The Story Island 🏝️</p>
      </td></tr>
      <tr><td style="padding:40px 40px 16px;">
        <h2 style="color:#1a1a2e;font-size:22px;font-weight:700;margin:0 0 20px;font-family:Georgia,serif;">You've arrived on The Story Island.</h2>
        <p style="color:#444460;font-size:16px;line-height:1.75;margin:0 0 16px;">Thank you for subscribing. From now on, we'll be landing in your inbox with the best of what's happening on Calvary Scribblings — new stories, fresh voices, and the occasional note from the editorial desk.</p>
        <p style="color:#444460;font-size:16px;line-height:1.75;margin:0 0 16px;">We publish original fiction, poetry, and creative non-fiction from writers who mean it. No filler, no noise — just the kind of writing that makes you forget where you are for a moment.</p>
        <p style="color:#444460;font-size:16px;line-height:1.75;margin:0 0 32px;">In the meantime, the island is open. Come have a read.</p>
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${purple};">
          <a href="https://calvaryscribblings.co.uk" style="color:#fff;font-size:14px;font-weight:600;font-family:Arial,sans-serif;padding:13px 28px;display:inline-block;text-decoration:none;">Visit The Story Island</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:32px 40px 0;"><hr style="border:none;border-top:1px solid #ede8f5;"/></td></tr>
      <tr><td style="padding:16px 40px;">
        <p style="color:#999;font-size:13px;line-height:1.6;margin:0;">You can unsubscribe at any time via the link below.</p>
      </td></tr>
      <tr><td style="background:#1a1a2e;padding:28px 40px;text-align:center;">
        <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;font-family:Arial,sans-serif;line-height:1.6;">You're receiving this because you subscribed at calvaryscribblings.co.uk<br/>Calvary Media UK Ltd. · London, United Kingdom</p>
        <a href="https://calvary-newsletter.calvarymediauk.workers.dev/unsubscribe?token=${unsubToken}" style="color:rgba(255,255,255,0.35);font-size:11px;font-family:Arial,sans-serif;">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function buildEmail({ subject, blocks, issueNumber }) {
  const purple = "#6b2fad";
  const blocksHtml = (blocks || []).map((b) => {
    if (!b || !b.type) return "";
    if (b.type === "text") {
      // A block WITHOUT a format field takes the original escape-everything
      // path unchanged — every draft and issue predating cs-inline-v1 renders
      // byte for byte as it always did.
      const inline = b.format === "cs-inline-v1" ? renderInlineHtmlMirror : escHtml;
      const paras = String(b.content || "")
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p style="color:#1a1a2e;font-size:16px;line-height:1.75;margin:0 0 16px;">${inline(p)}</p>`)
        .join("");
      if (!paras) return "";
      return `<tr><td style="padding:20px 40px;">${paras}</td></tr>`;
    }
    if (b.type === "divider") {
      return `<tr><td><hr style="border:none;border-top:2px solid ${purple};width:100%;margin:24px 0;"/></td></tr>`;
    }
    if (b.type === "image") {
      // The same padded cell a text block uses, which is what makes 540 the
      // right width. An invalid block renders nothing at all — not an empty
      // cell — so it leaves no trace in the mail.
      const img = renderImageHtmlMirror(b);
      if (!img) return "";
      return `<tr><td style="padding:20px 40px;">${img}</td></tr>`;
    }
    if (b.type === "story") {
      // Story fields were the ONE place in this function interpolating raw —
      // title, author, excerpt, cover and slug all went in unescaped while text
      // blocks beside them were fully escaped. Source is admin-controlled CMS
      // data, so it was never an open injection, but an apostrophe-carrying
      // title is enough to break the markup. Same escHtml as everything else.
      const slug = escHtml(b.slug);
      const cover = escHtml(b.cover);
      const excerpt = String(b.excerpt || "");
      return `<tr><td style="padding:12px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          ${b.cover ? `<td width="110" valign="top"><img src="${cover}" width="110" height="70" alt="" style="border-radius:6px;object-fit:cover;display:block;" /></td>` : ""}
          <td valign="top" style="padding-left:${b.cover ? "16px" : "0"};">
            <p style="color:${purple};font-size:10px;letter-spacing:2px;text-transform:uppercase;margin:0 0 4px;font-family:Arial,sans-serif;font-weight:600;">${escHtml(b.category || "Fiction")}</p>
            <a href="https://calvaryscribblings.co.uk/stories/${slug}" style="text-decoration:none;">
              <h2 style="color:#1a1a2e;font-size:17px;font-weight:700;margin:0 0 4px;font-family:Georgia,serif;">${escHtml(b.title)}</h2>
            </a>
            <p style="color:#666680;font-size:12px;margin:0 0 6px;font-family:Arial,sans-serif;">by ${escHtml(b.author)}</p>
            ${excerpt ? `<p style="color:#444460;font-size:13px;line-height:1.6;margin:0 0 8px;">${escHtml(excerpt.slice(0, 120))}${excerpt.length > 120 ? "…" : ""}</p>` : ""}
            <a href="https://calvaryscribblings.co.uk/stories/${slug}" style="color:${purple};font-size:12px;font-weight:600;font-family:Arial,sans-serif;">Read on Calvary Scribblings →</a>
          </td>
        </tr></table>
      </td></tr>`;
    }
    return "";
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f8f7fc;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0;">
    <table width="620" cellpadding="0" cellspacing="0" style="background:#fff;max-width:620px;width:100%;">
      <tr><td style="background:${purple};padding:36px 40px 28px;text-align:center;">
        <p style="color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 8px;font-family:Arial,sans-serif;">Issue #${issueNumber || "—"} · Weekly Digest</p>
        <h1 style="color:#fff;font-size:30px;font-weight:700;margin:0 0 6px;font-family:Georgia,serif;">Calvary Scribblings</h1>
        <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0;font-family:Arial,sans-serif;letter-spacing:1px;">The Story Island 🏝️</p>
      </td></tr>
      ${blocksHtml}
      <tr><td style="padding:24px 40px 36px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f3eefb;border-radius:10px;padding:24px 28px;text-align:center;">
          <p style="color:#1a1a2e;font-size:15px;margin:0 0 14px;">More stories are waiting for you on the platform.</p>
          <a href="https://calvaryscribblings.co.uk" style="background:${purple};color:#fff;padding:12px 28px;border-radius:6px;font-size:13px;font-family:Arial,sans-serif;font-weight:600;text-decoration:none;display:inline-block;">Visit Calvary Scribblings</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="background:#1a1a2e;padding:28px 40px;text-align:center;">
        <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;font-family:Arial,sans-serif;line-height:1.6;">You're receiving this because you subscribed to Calvary Scribblings.<br/>Calvary Media UK Ltd. · calvaryscribblings.co.uk</p>
        <a href="https://calvary-newsletter.calvarymediauk.workers.dev/unsubscribe?token=TOKEN" style="color:rgba(255,255,255,0.35);font-size:11px;font-family:Arial,sans-serif;">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function unsubscribePage(emailOrMessage, success) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>${success ? "Unsubscribed" : "Error"} · Calvary Scribblings</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Georgia,serif;background:#f8f7fc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}.card{background:#fff;border-radius:12px;padding:48px 40px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(107,47,173,0.08);}.logo{color:#6b2fad;font-size:13px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;font-weight:700;margin-bottom:32px;}.icon{font-size:40px;margin-bottom:20px;}h1{color:#1a1a2e;font-size:22px;margin-bottom:12px;}p{color:#666680;font-size:15px;line-height:1.7;margin-bottom:28px;}a{color:#6b2fad;font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;}</style>
</head><body><div class="card">
  <div class="logo">Calvary Scribblings</div>
  <div class="icon">${success ? "✓" : "✕"}</div>
  <h1>${success ? "You're unsubscribed" : "Something went wrong"}</h1>
  <p>${success ? `<strong>${emailOrMessage}</strong> has been removed from our weekly newsletter.` : emailOrMessage}</p>
  <a href="https://calvaryscribblings.co.uk">← Back to Calvary Scribblings</a>
</div></body></html>`;
}
