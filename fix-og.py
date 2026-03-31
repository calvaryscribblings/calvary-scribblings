path = 'app/stories/[slug]/layout.js'
with open(path, 'r') as f:
    content = f.read()

old = '''  let story = stories.find(s => s.id === slug);
  if (!story) return {};'''

new = '''  let story = stories.find(s => s.id === slug);
  if (!story) {
    try {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, get } = await import('firebase/database');
      const firebaseConfig = {
        apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
        authDomain: 'calvary-scribblings.firebaseapp.com',
        databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
        projectId: 'calvary-scribblings',
        storageBucket: 'calvary-scribblings.firebasestorage.app',
        messagingSenderId: '1052137412283',
        appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
      };
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getDatabase(app);
      const snap = await get(ref(db, `cms_stories/${slug}`));
      if (snap.exists()) story = { id: slug, ...snap.val() };
    } catch(e) {}
  }
  if (!story) return {};'''

# Check which version exists in file
if '  const story = stories.find(s => s.id === slug);\n  if (!story) return {};' in content:
    content = content.replace(
        '  const story = stories.find(s => s.id === slug);\n  if (!story) return {};',
        new.replace('let story', 'let story', 1)
    )
elif old in content:
    content = content.replace(old, new)
else:
    # Try to find and replace whatever is there
    import re
    content = re.sub(
        r'const story = stories\.find\(s => s\.id === slug\);\s*if \(!story\) return \{\};',
        new,
        content
    )

# Fix image URL to handle both absolute and relative paths
content = content.replace(
    'const image = `https://calvaryscribblings.co.uk${story.cover}`;',
    "const image = story.cover && story.cover.startswith('http') if hasattr(story, 'cover') else None"
)

# Actually do it properly in JS
content = content.replace(
    'const image = `https://calvaryscribblings.co.uk${story.cover}`;',
    "const image = story.cover && story.cover.startsWith('http') ? story.cover : `https://calvaryscribblings.co.uk${story.cover}`;"
)

with open(path, 'w') as f:
    f.write(content)

print('Done' if 'cms_stories' in content else 'No match')
