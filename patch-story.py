path = "app/stories/[slug]/page.js"
with open(path, 'r') as f:
    content = f.read()

old = "  const accentColor = categoryColors[story.category] || '#6b46c1';"
new = """  if (!story) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cochin, Georgia, serif', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)' }}>Loading story\u2026</div>
    </div>
  );
  const accentColor = categoryColors[story.category] || '#6b46c1';"""

content = content.replace(old, new)
with open(path, 'w') as f:
    f.write(content)
print('Done' if new.split('\n')[0] in content else 'No match found')
