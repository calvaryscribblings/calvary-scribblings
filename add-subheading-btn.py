path = 'app/admin/page.js'
with open(path, 'r') as f:
    content = f.read()

# Add subheading insertion function inside StoryForm, after insertImageAtCursor
old = '''  function insertImageAtCursor(html) {
    const ta = textareaRef.current;
    if (!ta) { setForm(f => ({ ...f, content: f.content + html })); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newContent = form.content.slice(0, start) + html + form.content.slice(end);
    setForm(f => ({ ...f, content: newContent }));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + html.length, start + html.length); }, 0);
  }'''

new = '''  function insertAtCursor(html) {
    const ta = textareaRef.current;
    if (!ta) { setForm(f => ({ ...f, content: f.content + html })); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newContent = form.content.slice(0, start) + html + form.content.slice(end);
    setForm(f => ({ ...f, content: newContent }));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + html.length, start + html.length); }, 0);
  }

  function insertImageAtCursor(html) { insertAtCursor(html); }

  function insertSubheading() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = form.content.slice(start, end);
    const html = selected
      ? \`<h3>\${selected}</h3>\`
      : '<h3>Subheading</h3>';
    insertAtCursor(html);
  }'''

content = content.replace(old, new)

# Add subheading button to toolbar next to Insert Image
old_toolbar = '''          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={s.label}>Story Content (HTML)</label>
            <button style={s.btnImg} onClick={() => setShowImageModal(true)}>
              🖼 Insert Image
            </button>
          </div>'''

new_toolbar = '''          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={s.label}>Story Content (HTML)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={s.btnImg} onClick={insertSubheading}>
                H3 Subheading
              </button>
              <button style={s.btnImg} onClick={() => setShowImageModal(true)}>
                🖼 Insert Image
              </button>
            </div>
          </div>'''

content = content.replace(old_toolbar, new_toolbar)

with open(path, 'w') as f:
    f.write(content)

print('Done' if 'insertSubheading' in content else 'No match')
