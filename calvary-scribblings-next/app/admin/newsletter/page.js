"use client";
import { useState, useEffect } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, get } from "firebase/database";
import { initializeApp, getApps } from "firebase/app";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

function getFirebaseApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp(firebaseConfig);
}

const ALLOWED_EMAILS = ["Ikennaworksfromhome@gmail.com", "fynbecki@gmail.com"];
const CATEGORY_COLOURS = { flash: "#e05c2a", short: "#2a7ae0", poetry: "#6b2fad", news: "#1a9e6b", inspiring: "#c4a200" };
function categoryColour(cat) { return CATEGORY_COLOURS[(cat || "").toLowerCase()] || "#6b2fad"; }

export default function NewsletterPage() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [subject, setSubject] = useState("");
  const [intro, setIntro] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [selectedStories, setSelectedStories] = useState([]);
  const [allStories, setAllStories] = useState([]);
  const [subscriberCount, setSubscriberCount] = useState(null);
  const [sendHistory, setSendHistory] = useState([]);
  const [tab, setTab] = useState("compose");
  const [status, setStatus] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [storySearch, setStorySearch] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [draftId, setDraftId] = useState(null);
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    const app = getFirebaseApp();
    const auth = getAuth(app);
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthChecked(true); });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const app = getFirebaseApp();
    const db = getDatabase(app);
    get(ref(db, "cms_stories")).then((snap) => {
      if (snap.exists()) {
        const list = Object.entries(snap.val()).map(([id, s]) => ({ id, ...s }));
        setAllStories(list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)));
      }
    });
    get(ref(db, "subscribers")).then((snap) => {
      if (snap.exists()) {
        const active = Object.values(snap.val()).filter((s) => s.email && s.status !== "unsubscribed");
        setSubscriberCount(active.length);
      } else { setSubscriberCount(0); }
    });
    // Load drafts from Worker
    fetch('https://calvary-newsletter.calvarymediauk.workers.dev/drafts', {
      headers: { Authorization: 'Bearer ddd5f8404323f52bc4e5aff5ff5be117cdf593ced85d5e309fa1e5ff745972ca' }
    }).then(r => r.json()).then(data => {
      if (data && typeof data === 'object') {
        const list = Object.values(data).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
        setDrafts(list);
      }
    }).catch(() => {});

    get(ref(db, 'newsletter_sends')).then((snap) => {
      if (snap.exists()) {
        const list = Object.entries(snap.val()).map(([id, s]) => ({ id, ...s })).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
        setSendHistory(list);
      }
    });
  }, [user]);

  function toggleStory(story) {
    setSelectedStories((prev) => {
      const exists = prev.find((s) => s.id === story.id);
      if (exists) return prev.filter((s) => s.id !== story.id);
      return [...prev, { id: story.id, slug: story.slug, title: story.title, author: story.author, category: story.category, cover: story.cover || story.coverUrl || "", excerpt: story.excerpt || story.summary || "" }];
    });
  }

  function moveStory(index, dir) {
    const next = [...selectedStories];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setSelectedStories(next);
  }


  async function handleSaveDraft(scheduleTime) {
    if (!subject.trim() && !intro.trim()) {
      setStatus("error");
      setStatusMsg("Add a subject or intro before saving.");
      return;
    }
    setStatus("loading");
    setStatusMsg(scheduleTime ? "Scheduling newsletter..." : "Saving draft...");
    try {
      const res = await fetch("https://calvary-newsletter.calvarymediauk.workers.dev/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer ddd5f8404323f52bc4e5aff5ff5be117cdf593ced85d5e309fa1e5ff745972ca" },
        body: JSON.stringify({
          id: draftId || undefined,
          subject: subject.trim(),
          intro: intro.trim(),
          stories: selectedStories,
          issueNumber: issueNumber ? parseInt(issueNumber) : undefined,
          scheduledAt: scheduleTime || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setDraftId(data.id);
      setStatus("success");
      setStatusMsg(scheduleTime ? "Newsletter scheduled!" : "Draft saved!");
    } catch (err) {
      setStatus("error");
      setStatusMsg(err.message);
    }
  }

  async function handleSend(isTest) {
    if (!subject.trim() || !intro.trim()) { setStatus("error"); setStatusMsg("Subject and intro are required."); return; }
    if (isTest && !testEmail.trim()) { setStatus("error"); setStatusMsg("Enter a test email address."); return; }
    setStatus("loading");
    setStatusMsg(isTest ? "Sending test email…" : "Sending to all subscribers…");
    try {
      const res = await fetch("https://calvary-newsletter.calvarymediauk.workers.dev/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer ddd5f8404323f52bc4e5aff5ff5be117cdf593ced85d5e309fa1e5ff745972ca" },
        body: JSON.stringify({ subject: subject.trim(), intro: intro.trim(), stories: selectedStories, issueNumber: issueNumber ? parseInt(issueNumber) : undefined, testEmail: isTest ? testEmail.trim() : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setStatus("success");
      setStatusMsg(isTest ? `Test sent to ${testEmail}!` : `Newsletter sent to ${data.sent} subscribers.`);
      if (!isTest) setTimeout(() => window.location.reload(), 2000);
    } catch (err) { setStatus("error"); setStatusMsg(err.message); }
  }

  const filteredStories = allStories.filter((s) => {
    const q = storySearch.toLowerCase();
    return !q || s.title?.toLowerCase().includes(q) || s.author?.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q);
  });

  if (!authChecked) return <div style={s.centred}><div style={s.dot} /></div>;
  if (user && !ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(user.email?.toLowerCase())) {
    return (
      <div style={s.centred}><div style={s.authCard}><div style={s.logoMark}>CS</div><h2 style={{color:"#1a1a2e",fontSize:20,marginBottom:8}}>Access denied</h2><p style={{color:"#666680",fontSize:14,marginBottom:24}}>You do not have permission to access the newsletter studio.</p><a href="/" style={s.btnPrimary}>Go to Homepage</a></div></div>
    );
  }
  if (!user) return (
    <div style={s.centred}>
      <div style={s.authCard}>
        <div style={s.logoMark}>CS</div>
        <h2 style={{ color: "#1a1a2e", fontSize: 20, marginBottom: 8 }}>Admin access required</h2>
        <p style={{ color: "#666680", fontSize: 14, marginBottom: 24 }}>Please sign in to access the newsletter studio.</p>
        <a href="/admin" style={s.btnPrimary}>Go to Admin Login</a>
      </div>
    </div>
  );

  return (
    <div style={s.page}>
      <aside style={s.sidebar}>
        <div style={s.sidebarLogo}>
          <span style={s.logoMark}>CS</span>
          <div>
            <div style={s.logoTitle}>Calvary Scribblings</div>
            <div style={s.logoSub}>Newsletter Studio</div>
          </div>
        </div>
        <nav style={s.nav}>
          {["compose","preview","history"].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ ...s.navBtn, ...(tab === t ? s.navBtnActive : {}) }}>
              <span style={s.navIcon}>{t === "compose" ? "✏️" : t === "preview" ? "👁" : "📋"}</span>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <div style={s.sidebarStats}>
          <div style={s.statLabel}>Active Subscribers</div>
          <div style={s.statValue}>{subscriberCount === null ? "—" : subscriberCount.toLocaleString()}</div>
          <div style={{ ...s.statLabel, marginTop: 12 }}>Stories Selected</div>
          <div style={s.statValue}>{selectedStories.length}</div>
        </div>
        <a href="/admin" style={s.backLink}>← Back to CMS</a>
      </aside>

      <main style={s.main}>
        {tab === "compose" && (
          <div style={s.tabContent}>
            <div style={s.tabHeader}>
              <h1 style={s.tabTitle}>Compose Newsletter</h1>
              <p style={s.tabSubtitle}>Write your intro, pick stories, then send or preview.</p>
            </div>
            {status && (
              <div style={{ ...s.banner, background: status === "success" ? "#edfaf3" : status === "error" ? "#fef2f2" : "#f3eefb", borderColor: status === "success" ? "#1a9e6b" : status === "error" ? "#dc2626" : "#6b2fad", color: status === "success" ? "#1a9e6b" : status === "error" ? "#dc2626" : "#6b2fad" }}>
                {statusMsg}
              </div>
            )}
            <div style={s.grid}>
              <div style={s.leftCol}>
                <div style={s.fieldGroup}>
                  <label style={s.label}>Issue Number</label>
                  <input style={s.input} type="number" placeholder="e.g. 1" value={issueNumber} onChange={(e) => setIssueNumber(e.target.value)} />
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.label}>Subject Line *</label>
                  <input style={s.input} placeholder="This Week on Calvary Scribblings" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  <div style={s.charCount}>{subject.length} chars</div>
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.label}>Opening Intro *</label>
                  <textarea style={s.textarea} placeholder="Write a warm opening for your readers…" value={intro} onChange={(e) => setIntro(e.target.value)} rows={5} />
                  <div style={s.charCount}>{intro.length} chars</div>
                </div>
                {selectedStories.length > 0 && (
                  <div style={s.fieldGroup}>
                    <label style={s.label}>Featured Stories</label>
                    <div style={s.selectedList}>
                      {selectedStories.map((st, i) => (
                        <div key={st.slug} style={s.selectedItem}>
                          <span style={{ ...s.catDot, background: categoryColour(st.category) }} />
                          <span style={s.selectedTitle}>{st.title}</span>
                          <div style={s.reorderBtns}>
                            <button style={s.reorderBtn} onClick={() => moveStory(i, -1)} disabled={i === 0}>↑</button>
                            <button style={s.reorderBtn} onClick={() => moveStory(i, 1)} disabled={i === selectedStories.length - 1}>↓</button>
                            <button style={{ ...s.reorderBtn, color: "#dc2626" }} onClick={() => toggleStory(st)}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={s.sendRow}>
                  <div style={s.fieldGroup}>
                    <label style={s.label}>Schedule Send (optional)</label>
                    <input style={s.input} type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                  </div>
                  <div style={s.testRow}>
                    <input style={{ ...s.input, flex: 1, marginBottom: 0 }} type="email" placeholder="test@email.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                    <button style={s.btnSecondary} onClick={() => handleSend(true)} disabled={status === "loading"}>Send Test</button>
                  </div>
                  <div style={s.testRow}>
                    <button style={s.btnSecondary} onClick={() => handleSaveDraft(null)} disabled={status === "loading"}>Save Draft</button>
                    {scheduledAt && <button style={{ ...s.btnSecondary, color: "#1a9e6b", border: "2px solid #1a9e6b" }} onClick={() => handleSaveDraft(scheduledAt)} disabled={status === "loading"}>Schedule</button>}
                  </div>
                  <button style={s.btnPrimary} onClick={() => handleSend(false)} disabled={status === "loading"}>
                    {status === "loading" ? "Sending…" : `Send to ${subscriberCount ?? "—"} Subscribers`}
                  </button>
                </div>
              </div>
              <div style={s.rightCol}>
                <div style={s.pickerHeader}>
                  <span style={s.label}>Pick Stories</span>
                  <input style={s.searchInput} placeholder="Search stories…" value={storySearch} onChange={(e) => setStorySearch(e.target.value)} />
                </div>
                <div style={s.storyPicker}>
                  {filteredStories.length === 0 && <div style={s.empty}>No stories found.</div>}
                  {filteredStories.map((st) => {
                    const isSelected = selectedStories.find((x) => x.id === st.id);
                    return (
                      <div key={st.id} onClick={() => toggleStory(st)} style={{ ...s.storyCard, ...(isSelected ? s.storyCardSelected : {}) }}>
                        {(st.cover || st.coverUrl) && <img src={st.cover || st.coverUrl} alt="" style={s.storyCover} />}
                        <div style={s.storyInfo}>
                          <div style={s.storyCategory}><span style={{ ...s.catDot, background: categoryColour(st.category) }} />{st.category}</div>
                          <div style={s.storyTitle}>{st.title}</div>
                          <div style={s.storyAuthor}>{st.author}</div>
                        </div>
                        <div style={s.checkMark}>{isSelected ? "✓" : "+"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "preview" && (
          <div style={s.tabContent}>
            <div style={s.tabHeader}>
              <h1 style={s.tabTitle}>Email Preview</h1>
              <p style={s.tabSubtitle}>This is roughly how the email will appear in inboxes.</p>
            </div>
            <div style={s.previewShell}>
              <div style={s.emailChrome}>
                <div style={{ display: "flex", gap: 8, fontSize: 12, color: "#1a1a2e", marginBottom: 4 }}><span style={{ color: "#666680", width: 50 }}>From</span><span>Calvary Scribblings &lt;newsletter@calvaryscribblings.co.uk&gt;</span></div>
                <div style={{ display: "flex", gap: 8, fontSize: 12, color: "#1a1a2e" }}><span style={{ color: "#666680", width: 50 }}>Subject</span><span style={{ fontWeight: 600 }}>{subject || "( no subject )"}</span></div>
              </div>
              <div style={s.emailBody}>
                <div style={s.pvHeader}>
                  <div style={s.pvIssue}>Issue #{issueNumber || "—"} · Weekly Digest</div>
                  <div style={s.pvLogo}>Calvary Scribblings</div>
                  <div style={s.pvTagline}>The Story Island 🏝️</div>
                </div>
                <div style={s.pvIntro}>{intro || <em style={{ color: "#aaa" }}>( intro will appear here )</em>}</div>
                <hr style={{ border: "none", borderTop: "1px solid #ede8f5", margin: "0 40px" }} />
                {selectedStories.length > 0 && (
                  <div style={{ padding: "20px 40px 0" }}>
                    <div style={s.pvSectionLabel}>This Week's Stories</div>
                    {selectedStories.map((st) => (
                      <div key={st.slug} style={s.pvStoryRow}>
                        {st.cover && <img src={st.cover} alt="" style={s.pvStoryCover} />}
                        <div>
                          <div style={{ ...s.pvStoryCategory, color: categoryColour(st.category) }}>{st.category}</div>
                          <div style={s.pvStoryTitle}>{st.title}</div>
                          <div style={s.pvStoryAuthor}>by {st.author}</div>
                          {st.excerpt && <div style={s.pvStoryExcerpt}>{st.excerpt.slice(0, 120)}{st.excerpt.length > 120 ? "…" : ""}</div>}
                          <div style={s.pvReadLink}>Read Story →</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={s.pvCTA}>
                  <div style={{ fontSize: 14, color: "#1a1a2e", marginBottom: 12 }}>More stories are waiting for you on the platform.</div>
                  <div style={s.pvCTABtn}>Visit Calvary Scribblings</div>
                </div>
                <div style={s.pvFooter}>
                  You're receiving this because you subscribed to Calvary Scribblings.<br />
                  <span style={{ textDecoration: "underline" }}>Unsubscribe</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "history" && (
          <div style={s.tabContent}>
            <div style={s.tabHeader}>
              <h1 style={s.tabTitle}>Send History</h1>
              <p style={s.tabSubtitle}>A log of all newsletters sent from Calvary Scribblings.</p>
            </div>
            
              {drafts.length > 0 && (
                <div style={{marginBottom: 24}}>
                  <div style={{color: "#6b2fad", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", fontWeight: 700, marginBottom: 12}}>Drafts & Scheduled</div>
                  <div style={{display:"flex", flexDirection:"column", gap:8}}>
                    {drafts.map((d) => (
                      <div key={d.id} style={{background:"#fff", border:"1px solid #ede8f5", borderRadius:10, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:16}}>
                        <div>
                          <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:4}}>
                            <span style={{background: d.status === "scheduled" ? "#edfaf3" : "#f3eefb", color: d.status === "scheduled" ? "#1a9e6b" : "#6b2fad", fontSize:10, fontWeight:700, letterSpacing:1, textTransform:"uppercase", padding:"2px 8px", borderRadius:4}}>{d.status}</span>
                          </div>
                          <div style={{fontSize:15, fontWeight:700, color:"#1a1a2e", marginBottom:4}}>{d.subject || "(no subject)"}</div>
                          <div style={{fontSize:12, color:"#666680"}}>
                            {d.status === "scheduled" ? "Sends: " + new Date(d.scheduledAt).toLocaleString("en-GB") : "Saved: " + new Date(d.savedAt).toLocaleString("en-GB")}
                          </div>
                        </div>
                        <div style={{display:"flex", gap:8}}>
                          <button onClick={() => { setSubject(d.subject||""); setIntro(d.intro||""); setSelectedStories(d.stories||[]); setIssueNumber(d.issueNumber||""); setDraftId(d.id); setScheduledAt(d.scheduledAt||""); setTab("compose"); }}
                            style={{background:"#f3eefb", color:"#6b2fad", border:"none", borderRadius:6, padding:"8px 14px", fontSize:12, fontWeight:700, cursor:"pointer"}}>Edit</button>
                          <button onClick={async () => {
                            await fetch("https://calvary-newsletter.calvarymediauk.workers.dev/draft/" + d.id, { method:"DELETE", headers:{Authorization:"Bearer ddd5f8404323f52bc4e5aff5ff5be117cdf593ced85d5e309fa1e5ff745972ca"} });
                            setDrafts(prev => prev.filter(x => x.id !== d.id));
                          }} style={{background:"#fef2f2", color:"#dc2626", border:"none", borderRadius:6, padding:"8px 14px", fontSize:12, fontWeight:700, cursor:"pointer"}}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
{sendHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                <div style={{ color: "#666680", fontSize: 15 }}>No newsletters sent yet.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sendHistory.map((h) => (
                  <div key={h.id} style={s.historyCard}>
                    <div>
                      {h.issueNumber && <div style={s.historyIssue}>Issue #{h.issueNumber}</div>}
                      <div style={s.historySubject}>{h.subject}</div>
                      <div style={s.historyDate}>{new Date(h.sentAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={s.historyStatBox}><div style={s.historyStatNum}>{h.recipientCount ?? "—"}</div><div style={s.historyStatLabel}>Sent</div></div>
                      <div style={s.historyStatBox}><div style={s.historyStatNum}>{(h.storySlugs || []).length}</div><div style={s.historyStatLabel}>Stories</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

const purple = "#6b2fad";
const s = {
  page: { display: "flex", minHeight: "100vh", background: "#f8f7fc", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  sidebar: { width: 240, background: "#1a1a2e", display: "flex", flexDirection: "column", padding: "28px 20px", flexShrink: 0, position: "sticky", top: 0, height: "100vh" },
  sidebarLogo: { display: "flex", alignItems: "center", gap: 12, marginBottom: 36 },
  logoMark: { background: purple, color: "#fff", width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, letterSpacing: 1, flexShrink: 0 },
  logoTitle: { color: "#fff", fontSize: 13, fontWeight: 700 },
  logoSub: { color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  nav: { display: "flex", flexDirection: "column", gap: 4 },
  navBtn: { background: "none", border: "none", color: "rgba(255,255,255,0.5)", padding: "10px 12px", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600, textAlign: "left", display: "flex", alignItems: "center", gap: 10 },
  navBtnActive: { background: "rgba(107,47,173,0.3)", color: "#fff" },
  navIcon: { fontSize: 15 },
  sidebarStats: { marginTop: "auto", background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 16, marginBottom: 16 },
  statLabel: { color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  statValue: { color: "#fff", fontSize: 24, fontWeight: 700, marginTop: 2 },
  backLink: { color: "rgba(255,255,255,0.35)", fontSize: 12, textDecoration: "none" },
  main: { flex: 1, overflow: "auto" },
  tabContent: { padding: "40px 48px", maxWidth: 1100 },
  tabHeader: { marginBottom: 32 },
  tabTitle: { color: "#1a1a2e", fontSize: 26, fontWeight: 700, margin: 0 },
  tabSubtitle: { color: "#666680", fontSize: 14, marginTop: 6 },
  banner: { padding: "12px 16px", borderRadius: 8, border: "1px solid", fontSize: 14, fontWeight: 600, marginBottom: 24 },
  grid: { display: "flex", gap: 32, alignItems: "flex-start" },
  leftCol: { flex: 1, minWidth: 0 },
  rightCol: { width: 320, flexShrink: 0 },
  fieldGroup: { marginBottom: 24 },
  label: { display: "block", color: "#1a1a2e", fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 },
  input: { width: "100%", padding: "11px 14px", border: "1px solid #ede8f5", borderRadius: 8, fontSize: 14, color: "#1a1a2e", background: "#fff", outline: "none", boxSizing: "border-box" },
  textarea: { width: "100%", padding: "11px 14px", border: "1px solid #ede8f5", borderRadius: 8, fontSize: 14, color: "#1a1a2e", background: "#fff", outline: "none", resize: "vertical", lineHeight: 1.6, fontFamily: "Georgia, serif", boxSizing: "border-box" },
  charCount: { textAlign: "right", fontSize: 11, color: "#666680", marginTop: 4 },
  selectedList: { display: "flex", flexDirection: "column", gap: 6, background: "#fff", border: "1px solid #ede8f5", borderRadius: 8, padding: 8 },
  selectedItem: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#f3eefb", borderRadius: 6 },
  catDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  selectedTitle: { flex: 1, fontSize: 13, color: "#1a1a2e", fontWeight: 500 },
  reorderBtns: { display: "flex", gap: 4 },
  reorderBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#666680", padding: "2px 5px", borderRadius: 4 },
  sendRow: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8 },
  testRow: { display: "flex", gap: 8 },
  btnPrimary: { background: purple, color: "#fff", border: "none", padding: "13px 24px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", textDecoration: "none", textAlign: "center", display: "block" },
  btnSecondary: { background: "#fff", color: purple, border: `2px solid ${purple}`, padding: "11px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 },
  pickerHeader: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 },
  searchInput: { width: "100%", padding: "9px 12px", border: "1px solid #ede8f5", borderRadius: 7, fontSize: 13, color: "#1a1a2e", outline: "none", boxSizing: "border-box" },
  storyPicker: { maxHeight: 520, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 },
  storyCard: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #ede8f5", borderRadius: 8, cursor: "pointer" },
  storyCardSelected: { border: `2px solid ${purple}`, background: "#f3eefb" },
  storyCover: { width: 52, height: 36, objectFit: "cover", borderRadius: 5, flexShrink: 0 },
  storyInfo: { flex: 1, minWidth: 0 },
  storyCategory: { display: "flex", alignItems: "center", gap: 5, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#666680", marginBottom: 2 },
  storyTitle: { fontSize: 13, fontWeight: 600, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  storyAuthor: { fontSize: 11, color: "#666680", marginTop: 2 },
  checkMark: { fontSize: 16, color: purple, fontWeight: 700, flexShrink: 0, width: 20, textAlign: "center" },
  empty: { color: "#666680", fontSize: 13, padding: 12, textAlign: "center" },
  previewShell: { background: "#fff", border: "1px solid #ede8f5", borderRadius: 12, overflow: "hidden", maxWidth: 680 },
  emailChrome: { background: "#f1f0f5", borderBottom: "1px solid #ede8f5", padding: "12px 20px" },
  emailBody: { padding: 0 },
  pvHeader: { background: purple, padding: "32px 40px 24px", textAlign: "center" },
  pvIssue: { color: "rgba(255,255,255,0.55)", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", marginBottom: 8 },
  pvLogo: { color: "#fff", fontSize: 26, fontWeight: 700, fontFamily: "Georgia, serif", marginBottom: 4 },
  pvTagline: { color: "rgba(255,255,255,0.65)", fontSize: 12, letterSpacing: 1 },
  pvIntro: { padding: "28px 40px", fontSize: 15, color: "#1a1a2e", lineHeight: 1.75, fontFamily: "Georgia, serif" },
  pvSectionLabel: { color: purple, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", fontWeight: 700, marginBottom: 16 },
  pvStoryRow: { display: "flex", gap: 14, paddingBottom: 20, marginBottom: 20, borderBottom: "1px solid #ede8f5" },
  pvStoryCover: { width: 100, height: 66, objectFit: "cover", borderRadius: 5, flexShrink: 0 },
  pvStoryCategory: { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, marginBottom: 4 },
  pvStoryTitle: { fontSize: 16, fontWeight: 700, color: "#1a1a2e", fontFamily: "Georgia, serif", marginBottom: 4 },
  pvStoryAuthor: { fontSize: 11, color: "#666680", marginBottom: 6 },
  pvStoryExcerpt: { fontSize: 12, color: "#444460", lineHeight: 1.5, marginBottom: 6 },
  pvReadLink: { fontSize: 12, color: purple, fontWeight: 600 },
  pvCTA: { background: "#f3eefb", margin: "20px 40px", borderRadius: 10, padding: 20, textAlign: "center" },
  pvCTABtn: { background: purple, color: "#fff", display: "inline-block", padding: "10px 22px", borderRadius: 6, fontSize: 12, fontWeight: 600 },
  pvFooter: { background: "#1a1a2e", padding: "24px 40px", textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.7 },
  historyCard: { background: "#fff", border: "1px solid #ede8f5", borderRadius: 10, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 },
  historyIssue: { color: purple, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 },
  historySubject: { fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 },
  historyDate: { fontSize: 12, color: "#666680" },
  historyStatBox: { background: "#f3eefb", borderRadius: 8, padding: "10px 16px", textAlign: "center" },
  historyStatNum: { fontSize: 20, fontWeight: 700, color: purple },
  historyStatLabel: { fontSize: 10, color: "#666680", letterSpacing: 1, textTransform: "uppercase" },
  centred: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f7fc" },
  authCard: { background: "#fff", borderRadius: 12, padding: 48, textAlign: "center", boxShadow: "0 4px 24px rgba(107,47,173,0.08)" },
  dot: { width: 14, height: 14, background: purple, borderRadius: "50%" },
};