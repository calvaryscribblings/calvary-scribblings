import re

path = 'app/stories/[slug]/page.js'
with open(path, 'r') as f:
    content = f.read()

new_func = '''    async function trackHit() {
      try {
        const base = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
        const auth = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
        const url = `${base}/stories/${slug}/hits.json?auth=${auth}`;
        // Atomic increment using ETag-based transaction
        let success = false;
        for (let i = 0; i < 5 && !success; i++) {
          const getRes = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
          const etag = getRes.headers.get('ETag');
          const current = await getRes.json();
          const newCount = (typeof current === 'number' ? current : 0) + 1;
          const putRes = await fetch(url, {
            method: 'PUT',
            body: JSON.stringify(newCount),
            headers: { 'Content-Type': 'application/json', 'if-match': etag }
          });
          if (putRes.status === 200) {
            setHitCount(newCount);
            success = true;
          }
          // If 412 (conflict), retry
        }
      } catch (e) {
        console.error('Hit count error:', e);
      }
    }'''

content = re.sub(
    r'async function trackHit\(\) \{[\s\S]*?\n        \}',
    new_func,
    content
)

with open(path, 'w') as f:
    f.write(content)

print('Done' if 'ETag' in content else 'No match')
