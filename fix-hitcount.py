import re

path = 'app/stories/[slug]/page.js'
with open(path, 'r') as f:
    content = f.read()

new_track = '''    async function trackHit() {
      try {
        const base = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
        const auth = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
        const url = `${base}/stories/${slug}/hits.json?auth=${auth}`;
        const getRes = await fetch(url);
        const current = await getRes.json();
        const newCount = (typeof current === 'number' ? current : 0) + 1;
        await fetch(url, { method: 'PUT', body: JSON.stringify(newCount), headers: { 'Content-Type': 'application/json' } });
        setHitCount(newCount);
      } catch (e) {
        console.error('Hit count error:', e);
      }
    }'''

# Replace the entire trackHit function using regex
content = re.sub(
    r'async function trackHit\(\) \{[\s\S]*?\n    \}',
    new_track,
    content
)

# Remove the unused Firebase imports from trackHit useEffect
content = content.replace(
    "const { initializeApp, getApps } = await import('firebase/app');\n        const { getDatabase, ref, runTransaction, get } = await import('firebase/database');\n        ",
    ""
)

with open(path, 'w') as f:
    f.write(content)

print('Done' if 'PUT' in content else 'No match')
