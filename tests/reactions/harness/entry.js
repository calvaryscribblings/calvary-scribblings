// W13 proof harness page. The REAL components: Reaction (every web surface's button) and
// ReactionRow (story comments and the Square). window.H drives them the way a surface does.
//
//   ?case=single&kind=heart&count=12&size=16&ground=%230a0a0a   one button at a fixed spot
//   ?case=row&set=comment|square&ground=…                     a row with Reply, then prose
/* eslint-disable react-hooks/immutability -- the harness hands its state setters to the probe on window.H */
import { createElement as h, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Reaction } from '../../../app/components/conversation/Reaction.js';
import { ReactionRow, COMMENT_REACTIONS, SQUARE_REACTIONS } from '../../../app/components/conversation/ConversationKit.js';
import { setSpeed } from '../../../app/lib/reactionMotion.js';

const q = new URLSearchParams(location.search);
const ground = q.get('ground') || '#0a0a0a';
document.body.style.cssText = `margin:0;min-height:100vh;background:${ground};color:#f5f0e8;font-family:'Cormorant Garamond',Georgia,serif`;

// The surface's contract: flip at once; on failure restore and reject.
const H = (window.H = { mode: 'ok', calls: 0 });
H.speed = (k) => setSpeed(k);
H.seed = (s) => { let a = s >>> 0; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function App() {
  const [gen, setGen] = useState(0);
  const init = () => ({
    heart: { on: false, count: Number(q.get('count') ?? 12) },
    like: { on: false, count: Number(q.get('count') ?? 12) },
    fire: { on: false, count: Number(q.get('count') ?? 12) },
  });
  const [st, setSt] = useState(init);
  // flushSync: the harness's own updates commit before the next line of a probe runs, as a
  // database event's would before the next tap.
  H.set = (key, v) => flushSync(() => setSt((s) => ({ ...s, [key]: { ...s[key], ...v } })));
  H.get = () => st;
  H.remount = () => flushSync(() => { setSt(init()); setGen((g) => g + 1); });
  const toggle = useCallback((key) => {
    H.calls++;
    let before;
    setSt((s) => { before = s[key]; return { ...s, [key]: { on: !s[key].on, count: s[key].count + (s[key].on ? -1 : 1) } }; });
    if (H.mode === 'ok') return Promise.resolve();
    if (H.mode === 'hang') return new Promise(() => {});
    return new Promise((_, rej) => setTimeout(() => { setSt((s) => ({ ...s, [key]: before })); rej(new Error('permission_denied')); }, 120));
  }, []);

  if (q.get('case') === 'row') {
    const set = q.get('set') === 'square' ? SQUARE_REACTIONS : COMMENT_REACTIONS;
    const item = {}, active = {};
    const key2kind = Object.fromEntries(set.map((r) => [r.key, r.kind]));
    for (const r of set) { item[`${r.key}Count`] = st[r.kind].count; active[r.key] = st[r.kind].on; }
    return h('div', { key: gen, style: { padding: '120px 24px', maxWidth: 680 } },
      h('p', { id: 'above', style: { margin: 0, fontSize: 16, lineHeight: 1.68 } }, 'A comment above the row, so the fx layer has something to cross.'),
      h(ReactionRow, { reactions: set, item, activeMap: active, canReact: true, onToggle: (k) => toggle(key2kind[k]),
        trailing: h('button', { className: 'cs-reply-btn', id: 'reply' }, 'Reply') }),
      h('p', { id: 'below', style: { margin: 0, fontSize: 16, lineHeight: 1.68 } }, 'The next comment. Nothing here may move while an effect plays.'));
  }
  const kind = q.get('kind') || 'heart';
  return h('div', { key: gen, id: 'stage', style: { position: 'absolute', left: 120, top: 120 } },
    h(Reaction, { kind, size: Number(q.get('size') || 16), on: st[kind].on, count: st[kind].count, canReact: true, onToggle: () => toggle(kind), onFail: () => { H.failed = (H.failed || 0) + 1; } }));
}
createRoot(document.getElementById('root')).render(h(App));
