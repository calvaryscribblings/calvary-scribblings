// Open Pages — shared Markdown rendering (Stage 4).
//
// The platform has NO Markdown library installed and the repo has no HTML
// sanitiser, so post bodies (which are Markdown) are rendered to React ELEMENTS
// only — never via dangerouslySetInnerHTML, never as raw HTML. This is the same
// escape-safe renderer the composer (app/open-pages/new/page.js) uses for its
// live preview, factored out so the public detail page renders bodies identically
// and the feed can derive plain-text excerpts from the same parsing rules.
//
//   renderMarkdown(md)  -> array of React elements (headings, paragraphs, lists,
//                          blockquotes, inline bold/italic/code/link/image).
//   stripMarkdown(md)   -> plain string with all Markdown syntax removed, for
//                          excerpts and meta descriptions.
//
// Supported: #..###### headings, blank-line paragraphs, - / * unordered lists,
// > blockquotes, and inline **bold**, *italic*, `code`, [text](url), ![alt](url).
// Link/image hrefs are sanitised to http(s)/mailto/relative — never javascript:.

const PURPLE = '#6b2fad';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const SERIF = "'Cormorant Garamond', 'Cochin', Georgia, serif";

function safeHref(url) {
  const u = (url || '').trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || u.startsWith('/')) return u;
  return null; // unsafe scheme → render as plain text
}

// Token regex shared by render + strip (priority via alternation order):
//   image ![alt](url) — MUST precede link so the leading ! isn't stripped
//   link [text](url), bold **x**, italic *x*, code `x`
const INLINE_RE =
  /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let k = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  let m;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      const src = safeHref(m[3]);
      if (src) {
        nodes.push(
          <img
            key={`${keyPrefix}-img-${k++}`}
            src={src}
            alt={m[2] || ''}
            style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, display: 'block', margin: '1.2rem auto' }}
          />
        );
      } else {
        nodes.push(m[2] || '');
      }
    } else if (m[4]) {
      const href = safeHref(m[6]);
      if (href) {
        nodes.push(
          <a key={`${keyPrefix}-a-${k++}`} href={href} target="_blank" rel="noopener noreferrer nofollow" style={{ color: GOLD, textDecoration: 'underline' }}>
            {m[5]}
          </a>
        );
      } else {
        nodes.push(m[5]);
      }
    } else if (m[7]) {
      nodes.push(<strong key={`${keyPrefix}-b-${k++}`}>{m[8]}</strong>);
    } else if (m[9]) {
      nodes.push(<em key={`${keyPrefix}-i-${k++}`} style={{ fontFamily: SERIF }}>{m[10]}</em>);
    } else if (m[11]) {
      nodes.push(
        <code key={`${keyPrefix}-c-${k++}`} style={{ background: 'rgba(245,240,232,0.08)', padding: '0.05em 0.35em', borderRadius: 3, fontSize: '0.9em' }}>
          {m[12]}
        </code>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderMarkdown(md) {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const txt = para.join(' ');
      blocks.push(
        <p key={`p-${key++}`} style={{ margin: '0 0 1.15rem', lineHeight: 1.8, color: 'rgba(245,240,232,0.88)' }}>
          {renderInline(txt, `p${key}`)}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${key++}`} style={{ margin: '0 0 1.15rem 1.3rem', lineHeight: 1.8, color: 'rgba(245,240,232,0.88)' }}>
          {list.map((item, idx) => (
            <li key={idx} style={{ marginBottom: '0.3rem' }}>{renderInline(item, `li${key}-${idx}`)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const sizes = [0, 2.1, 1.7, 1.4, 1.2, 1.08, 1];
      blocks.push(
        <p key={`h-${key++}`} style={{ margin: '1.6rem 0 0.7rem', fontFamily: SERIF, fontWeight: 700, fontSize: `${sizes[level]}rem`, color: GOLD, lineHeight: 1.2 }}>
          {renderInline(heading[2], `h${key}`)}
        </p>
      );
    } else if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (quote) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote key={`q-${key++}`} style={{ margin: '0 0 1.15rem', padding: '0.3rem 0 0.3rem 1.2rem', borderLeft: `3px solid ${PURPLE}`, color: 'rgba(245,240,232,0.78)', fontStyle: 'italic', fontFamily: SERIF, fontSize: '1.15rem' }}>
          {renderInline(quote[1], `q${key}`)}
        </blockquote>
      );
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

// Plain-text reduction for excerpts. Drops images, keeps link/bold/italic/code
// TEXT, strips block markers, and collapses whitespace to single spaces.
export function stripMarkdown(md) {
  return (md || '')
    .replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*\]\([^)\s]+\)/g, ' ')        // images → gone
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')       // links → text
    .replace(/`([^`]+)`/g, '$1')                      // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')                // bold
    .replace(/\*([^*]+)\*/g, '$1')                    // italic
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')               // heading markers
    .replace(/^\s{0,3}>\s?/gm, '')                    // blockquote markers
    .replace(/^\s{0,3}[-*]\s+/gm, '')                 // list markers
    .replace(/\s+/g, ' ')                             // collapse whitespace
    .trim();
}
