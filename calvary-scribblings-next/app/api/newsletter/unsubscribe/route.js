export const dynamic = "force-dynamic";

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

function getFirebaseAdmin() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) return new Response(page("Invalid link.", false), { headers: { "Content-Type": "text/html" } });
  try {
    const email = Buffer.from(token, "base64").toString("utf-8");
    if (!email || !email.includes("@")) return new Response(page("Invalid unsubscribe link.", false), { headers: { "Content-Type": "text/html" } });
    getFirebaseAdmin();
    const db = getDatabase();
    const snapshot = await db.ref("subscribers").once("value");
    const data = snapshot.val();
    if (!data) return new Response(page("You were not found in our list.", false), { headers: { "Content-Type": "text/html" } });
    const entry = Object.entries(data).find(([, v]) => v.email === email);
    if (!entry) return new Response(page("That email was not found in our list.", false), { headers: { "Content-Type": "text/html" } });
    const [key] = entry;
    await db.ref(`subscribers/${key}`).update({ status: "unsubscribed" });
    return new Response(page(email, true), { headers: { "Content-Type": "text/html" } });
  } catch (err) {
    console.error("Unsubscribe error:", err);
    return new Response(page("Something went wrong. Please try again.", false), { headers: { "Content-Type": "text/html" } });
  }
}

function page(emailOrMessage, success) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${success ? "Unsubscribed" : "Error"} · Calvary Scribblings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, serif; background: #f8f7fc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(107,47,173,0.08); }
    .logo { color: #6b2fad; font-size: 13px; letter-spacing: 3px; text-transform: uppercase; font-family: Arial, sans-serif; font-weight: 700; margin-bottom: 32px; }
    .icon { font-size: 40px; margin-bottom: 20px; }
    h1 { color: #1a1a2e; font-size: 22px; margin-bottom: 12px; }
    p { color: #666680; font-size: 15px; line-height: 1.7; margin-bottom: 28px; }
    a { color: #6b2fad; font-family: Arial, sans-serif; font-size: 13px; font-weight: 600; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Calvary Scribblings</div>
    <div class="icon">${success ? "✓" : "✕"}</div>
    <h1>${success ? "You're unsubscribed" : "Something went wrong"}</h1>
    <p>${success ? `<strong>${emailOrMessage}</strong> has been removed from our weekly newsletter.` : emailOrMessage}</p>
    <a href="https://calvaryscribblings.co.uk">← Back to Calvary Scribblings</a>
  </div>
</body>
</html>`;
}