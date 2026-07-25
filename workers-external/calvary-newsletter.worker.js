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
        await fetch(`${env.FIREBASE_DATABASE_URL}/subscribers.json?auth=${env.FIREBASE_SECRET}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name: name || "", status: "active", subscribedAt: new Date().toISOString() }),
        });
        const firstName = name ? name.trim().split(" ")[0] : "there";
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: "Calvary Scribblings <newsletter@calvaryscribblings.co.uk>",
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
        const { subject, blocks, issueNumber, testEmail } = await request.json();
        const hasContent = Array.isArray(blocks) && blocks.some((b) => b && (b.type === "text" || b.type === "story"));
        if (!subject || !hasContent) {
          return Response.json({ error: "subject and at least one text or story block are required" }, { status: 400, headers: cors });
        }
        const result = await sendNewsletter({ subject, blocks, issueNumber, testEmail }, env);
        return Response.json(result, { headers: cors });
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
          status: scheduledAt ? "scheduled" : "draft",
        };
        await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts/${draftId}.json?auth=${env.FIREBASE_SECRET}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        return Response.json({ success: true, id: draftId, status: draft.status }, { headers: cors });
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
        await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts/${draftId}.json?auth=${env.FIREBASE_SECRET}`, { method: "DELETE" });
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
    url: s.url || `/stories/${slug}`,
  };
  if (s.publishAt) rec.publishAt = s.publishAt;
  if (s.coverSizes) rec.coverSizes = s.coverSizes;
  const quiz = buildQuizSummaryMirror(s.quizMeta);
  if (quiz) rec.quiz = quiz;
  return rec;
}

async function processScheduled(env) {
  try {
    const res = await fetch(`${env.FIREBASE_DATABASE_URL}/cms_stories.json?auth=${env.FIREBASE_SECRET}`);
    const stories = await res.json();
    if (!stories || typeof stories !== "object") return;
    const now = new Date();
    let published = false;
    for (const [slug, story] of Object.entries(stories)) {
      if (story.published || !story.publishAt) continue;
      const publishTime = new Date(story.publishAt);
      if (publishTime > now) continue;
      try {
        // Flip published AND write the slim index record in ONE atomic multi-path
        // PATCH (root .json). A bare `cms_stories/<slug>/published: true` write would
        // leave the now-live story with NO cms_stories_index entry — invisible on
        // every index-fed surface (homepage, category pages, search, gateway-build,
        // Voices) since the Phase A cut-over. This mirrors the admin's unhideStory():
        // the story object read here is still pre-flip, so project { ...story,
        // published: true } to get published:true into the index record.
        const indexRecord = buildIndexRecordMirror(slug, { ...story, published: true });
        await fetch(`${env.FIREBASE_DATABASE_URL}/.json?auth=${env.FIREBASE_SECRET}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [`cms_stories/${slug}/published`]: true,
            [`cms_stories_index/${slug}`]: indexRecord,
          }),
        });
        published = true;
      } catch (err) {
        console.error(`Failed to publish story ${slug}:`, err);
      }
    }
    const draftsRes = await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts.json?auth=${env.FIREBASE_SECRET}`);
    const drafts = await draftsRes.json();
    if (drafts && typeof drafts === "object") {
      for (const [id, draft] of Object.entries(drafts)) {
        if (draft.status !== "scheduled" || !draft.scheduledAt) continue;
        const scheduledTime = new Date(draft.scheduledAt);
        if (scheduledTime > now) continue;
        try {
          await sendNewsletter({ subject: draft.subject, blocks: draft.blocks, intro: draft.intro, stories: draft.stories, issueNumber: draft.issueNumber }, env);
          await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_drafts/${id}.json?auth=${env.FIREBASE_SECRET}`, { method: "DELETE" });
        } catch (err) {
          console.error(`Failed to send scheduled newsletter ${id}:`, err);
        }
      }
    }
    if (published) {
      try {
        await fetch("https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/df2479ae-06a5-4ff3-a319-29b7b94dd106", { method: "POST" });
      } catch (err) {
        console.error("Deploy hook failed:", err);
      }
    }
  } catch (err) {
    console.error("Cron error:", err);
  }
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

async function sendNewsletter({ subject, blocks, intro, stories, issueNumber, testEmail }, env) {
  const normalisedBlocks = normaliseBlocks({ blocks, intro, stories });
  const subsRes = await fetch(`${env.FIREBASE_DATABASE_URL}/subscribers.json?auth=${env.FIREBASE_SECRET}`);
  const subsData = await subsRes.json();
  let emails = [];
  if (subsData && typeof subsData === "object") {
    emails = Object.values(subsData).filter((s) => s.email && s.status !== "unsubscribed").map((s) => s.email);
  }
  if (testEmail) emails = [testEmail];
  if (emails.length === 0) return { error: "No active subscribers" };
  const html = buildEmail({ subject, blocks: normalisedBlocks, issueNumber });
  const BATCH_SIZE = 50;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const batchPayload = batch.map((email) => ({
      from: `Calvary Scribblings <${env.FROM_EMAIL}>`,
      to: [email],
      subject: testEmail ? `[TEST] ${subject}` : subject,
      html: html.replace("token=TOKEN", `token=${btoa(email)}`),
    }));
    const resendRes = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify(batchPayload),
    });
    if (resendRes.ok) { sent += batch.length; } else { failed += batch.length; }
  }
  if (!testEmail) {
    await fetch(`${env.FIREBASE_DATABASE_URL}/newsletter_sends.json?auth=${env.FIREBASE_SECRET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        issueNumber: issueNumber || null,
        sentAt: new Date().toISOString(),
        recipientCount: sent,
        failedCount: failed,
        storySlugs: normalisedBlocks.filter((b) => b.type === "story").map((b) => b.slug),
      }),
    });
  }
  return { success: true, mode: testEmail ? "test" : "live", sent, failed };
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
      const paras = String(b.content || "")
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p style="color:#1a1a2e;font-size:16px;line-height:1.75;margin:0 0 16px;">${escHtml(p)}</p>`)
        .join("");
      if (!paras) return "";
      return `<tr><td style="padding:20px 40px;">${paras}</td></tr>`;
    }
    if (b.type === "divider") {
      return `<tr><td><hr style="border:none;border-top:2px solid ${purple};width:100%;margin:24px 0;"/></td></tr>`;
    }
    if (b.type === "story") {
      return `<tr><td style="padding:12px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          ${b.cover ? `<td width="110" valign="top"><img src="${b.cover}" width="110" height="70" style="border-radius:6px;object-fit:cover;display:block;" /></td>` : ""}
          <td valign="top" style="padding-left:${b.cover ? "16px" : "0"};">
            <p style="color:${purple};font-size:10px;letter-spacing:2px;text-transform:uppercase;margin:0 0 4px;font-family:Arial,sans-serif;font-weight:600;">${b.category || "Fiction"}</p>
            <a href="https://calvaryscribblings.co.uk/stories/${b.slug}" style="text-decoration:none;">
              <h2 style="color:#1a1a2e;font-size:17px;font-weight:700;margin:0 0 4px;font-family:Georgia,serif;">${b.title}</h2>
            </a>
            <p style="color:#666680;font-size:12px;margin:0 0 6px;font-family:Arial,sans-serif;">by ${b.author}</p>
            ${b.excerpt ? `<p style="color:#444460;font-size:13px;line-height:1.6;margin:0 0 8px;">${b.excerpt.slice(0, 120)}${b.excerpt.length > 120 ? "…" : ""}</p>` : ""}
            <a href="https://calvaryscribblings.co.uk/stories/${b.slug}" style="color:${purple};font-size:12px;font-weight:600;font-family:Arial,sans-serif;">Read on Calvary Scribblings →</a>
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
