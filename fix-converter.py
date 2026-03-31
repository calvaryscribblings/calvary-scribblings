path = 'app/admin/page.js'
with open(path, 'r') as f:
    content = f.read()

old = '''function convertToHTML(text) {
  // If already contains HTML tags, return as-is
  if (/<[a-z][\\s\\S]*>/i.test(text)) return text;
  // Split on double newlines or single newlines
  const paragraphs = text.split(/
+/).map(p => p.trim()).filter(p => p.length > 0);'''

new = '''function convertToHTML(text) {
  if (/<[a-z][\\s\\S]*>/i.test(text)) return text;
  const paragraphs = text.split(/\\n+/).map(p => p.trim()).filter(p => p.length > 0);'''

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

print('Done' if 'split(/\\n+/)' in content else 'No match')
