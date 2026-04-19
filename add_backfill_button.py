#!/usr/bin/env python3
"""
Adds a temporary "Backfill Author UIDs" button to the Calvary Scribblings
admin page, and its handler function.

Run from repo root:
    python3 add_backfill_button.py

Edits:  calvary-scribblings-next/app/admin/page.js
"""

from pathlib import Path
import sys

FILE = Path("calvary-scribblings-next/app/admin/page.js")

if not FILE.exists():
    print(f"ERROR: {FILE} not found. Run this script from the repo root.")
    sys.exit(1)

content = FILE.read_text()

# ---- EDIT 1: Add backfillAuthorUids function after deleteStory ----

OLD_1 = "  function openEdit(story) {"

NEW_1 = """  async function backfillAuthorUids() {
    if (!confirm('This will scan all stories and fill in missing authorUid fields. Continue?')) return;
    setMsg('Backfilling author UIDs…');
    try {
      const { ref, get, update } = await import('firebase/database');
      const usersSnap = await get(ref(db, 'users'));
      if (!usersSnap.exists()) { setMsg('No users found.'); return; }
      const nameToUid = {};
      Object.entries(usersSnap.val()).forEach(([uid, u]) => {
        if (u.displayName) nameToUid[u.displayName] = uid;
      });
      const storiesSnap = await get(ref(db, 'cms_stories'));
      if (!storiesSnap.exists()) { setMsg('No stories found.'); return; }
      const stories = storiesSnap.val();
      let updated = 0;
      const skipped = [];
      for (const [slug, story] of Object.entries(stories)) {
        if (story.authorUid && story.authorUid.trim()) continue;
        const uid = nameToUid[story.author];
        if (uid) {
          await update(ref(db, `cms_stories/${slug}`), { authorUid: uid });
          updated += 1;
        } else {
          skipped.push(`${slug} (author: "${story.author}")`);
        }
      }
      const skippedMsg = skipped.length
        ? ` Skipped ${skipped.length}: ${skipped.join(', ')}`
        : '';
      setMsg(`Backfill complete. ${updated} updated.${skippedMsg}`);
      loadStories();
    } catch (e) {
      setMsg('Backfill error: ' + e.message);
    }
  }
  function openEdit(story) {"""

if OLD_1 not in content:
    print("ERROR: Could not find openEdit function anchor. Aborting.")
    sys.exit(1)

if "backfillAuthorUids" in content:
    print("SKIP: backfillAuthorUids already exists.")
else:
    content = content.replace(OLD_1, NEW_1, 1)
    print("OK: Added backfillAuthorUids function.")

# ---- EDIT 2: Add button next to "+ New Story" ----

OLD_2 = '              <button style={s.btn} onClick={openNew}>+ New Story</button>'

NEW_2 = '''              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button style={{ ...s.btn, background: '#6b2fad', opacity: 0.85 }} onClick={backfillAuthorUids}>Backfill UIDs</button>
                <button style={s.btn} onClick={openNew}>+ New Story</button>
              </div>'''

if OLD_2 not in content:
    print("ERROR: Could not find '+ New Story' button. Aborting.")
    sys.exit(1)

if "Backfill UIDs" in content:
    print("SKIP: Backfill UIDs button already exists.")
else:
    content = content.replace(OLD_2, NEW_2, 1)
    print("OK: Added Backfill UIDs button.")

FILE.write_text(content)
print(f"\nDone. {FILE} updated.")
print("Next: commit, push, visit /admin, click 'Backfill UIDs'.")