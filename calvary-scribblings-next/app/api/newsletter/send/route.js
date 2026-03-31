export const dynamic = "force-dynamic";

import { Resend } from "resend";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { render } from "@react-email/render";
import WeeklyDigest from "@/emails/WeeklyDigest";

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

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.NEWSLETTER_SEND_SECRET;
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return Response.json({ error: "Unauthorised" }, { status: 401 });
    }
    const body = await request.json();
    const { subject, intro, stories, issueNumber, testEmail } = body;
    if (!subject || !intro) {
      return Response.json({ error: "subject and intro are required" }, { status: 400 });
    }
    const html = await render(WeeklyDigest({ subject, intro, stories: stories || [], issueNumber }));
    const resend = new Resend(process.env.RESEND_API_KEY);
    if (testEmail) {
      const { data, error } = await resend.emails.send({
        from: `Calvary Scribblings <${process.env.FROM_EMAIL}>`,
        to: [testEmail],
        subject: `[TEST] ${subject}`,
        html,
      });
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ success: true, mode: "test", id: data?.id });
    }
    getFirebaseAdmin();
    const db = getDatabase();
    const snapshot = await db.ref("subscribers").once("value");
    const subscribersData = snapshot.val();
    if (!subscribersData) return Response.json({ error: "No subscribers found" }, { status: 404 });
    const emails = Object.values(subscribersData)
      .filter((s) => s.email && s.status !== "unsubscribed")
      .map((s) => s.email);
    if (emails.length === 0) return Response.json({ error: "No active subscribers" }, { status: 404 });
    const BATCH_SIZE = 50;
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      const batchPayload = batch.map((email) => ({
        from: `Calvary Scribblings <${process.env.FROM_EMAIL}>`,
        to: [email],
        subject,
        html: html.replace("token=TOKEN", `token=${Buffer.from(email).toString("base64")}`),
      }));
      const { error } = await resend.batch.send(batchPayload);
      if (error) { failed += batch.length; } else { sent += batch.length; }
    }
    const sendRef = db.ref("newsletter_sends").push();
    await sendRef.set({
      subject,
      issueNumber: issueNumber || null,
      sentAt: new Date().toISOString(),
      recipientCount: sent,
      failedCount: failed,
      storySlugs: (stories || []).map((s) => s.slug),
    });
    return Response.json({ success: true, mode: "live", sent, failed, total: emails.length });
  } catch (err) {
    console.error("Newsletter send error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}// placeholder