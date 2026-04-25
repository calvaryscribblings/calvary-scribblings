import re

path = 'app/stories/[slug]/page.js'
with open(path, 'r') as f:
    content = f.read()

old_func = re.search(r'async function trackHit\(\) \{[\s\S]*?\n        \}', content)
if old_func:
    print(f"Found at: {old_func.start()}-{old_func.end()}")
    print("Current function:")
    print(old_func.group())
else:
    print("Not found")
