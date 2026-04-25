import os

FIREBASE_CONFIG = '''{
      apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
      authDomain: 'calvary-scribblings.firebaseapp.com',
      databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
      projectId: 'calvary-scribblings',
      storageBucket: 'calvary-scribblings.firebasestorage.app',
      messagingSenderId: '1052137412283',
      appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
    }'''

CMS_FETCH = '''
  useEffect(() => {
    async function fetchCMS() {
      try {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getDatabase, ref, get } = await import('firebase/database');
        const firebaseConfig = ''' + FIREBASE_CONFIG + ''';
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getDatabase(app);
        const snap = await get(ref(db, 'cms_stories'));
        if (snap.exists()) {
          const now = Date.now();
          const cms = Object.entries(snap.val())
            .map(([id, s]) => ({ ...s, id }))
            .filter(s => s.category === cat && (!s.publishAt || new Date(s.publishAt).getTime() <= now));
          setAllStories(prev => {
            const merged = [...cms, ...prev].filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);
            return merged.sort((a, b) => new Date(b.date) - new Date(a.date));
          });
        }
      } catch(e) { console.error('CMS fetch error:', e); }
    }
    fetchCMS();
  }, []);
'''

categories = ['flash', 'short', 'poetry', 'news', 'inspiring']

for cat in categories:
    path = f'app/{cat}/page.js'
    if not os.path.exists(path):
        print(f'Skipping {path} - not found')
        continue

    with open(path, 'r') as f:
        content = f.read()

    # Skip if already patched
    if 'fetchCMS' in content:
        print(f'Already patched: {path}')
        continue

    # Add useEffect to imports
    content = content.replace(
        "import { useState } from 'react';",
        "import { useState, useEffect } from 'react';"
    )

    # Replace module-level filtered with state
    content = content.replace(
        f"const filtered = stories.filter(s => s.category === cat).sort((a,b) => new Date(b.date) - new Date(a.date));",
        f"const _filtered = stories.filter(s => s.category === cat).sort((a,b) => new Date(b.date) - new Date(a.date));"
    )

    # Find the export default function and add state + useEffect after opening brace
    old_func = 'export default function'
    func_idx = content.index(old_func)
    # Find opening brace of the function
    brace_idx = content.index('{', func_idx)

    state_and_effect = '''
  const [allStories, setAllStories] = useState(_filtered);
''' + CMS_FETCH

    content = content[:brace_idx+1] + state_and_effect + content[brace_idx+1:]

    # Replace filtered.map with allStories.map in JSX
    content = content.replace('{filtered.map(', '{allStories.map(')
    content = content.replace('filtered.length', 'allStories.length')

    with open(path, 'w') as f:
        f.write(content)

    print(f'Patched: {path}')

# Fix loading flash in story page
story_path = 'app/stories/[slug]/page.js'
with open(story_path, 'r') as f:
    content = f.read()

content = content.replace(
    '''  if (!story) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cochin, Georgia, serif', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)' }}>Loading story\u2026</div>
    </div>
  );''',
    '''  if (!story) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />
  );'''
)

with open(story_path, 'w') as f:
    f.write(content)

print('Fixed loading flash in story page')
print('All done!')
