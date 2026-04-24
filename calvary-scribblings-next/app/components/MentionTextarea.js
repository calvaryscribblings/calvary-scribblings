'use client';
import { useState, useEffect, useRef } from 'react';
import { searchUsernames } from '../lib/mentions';

export default function MentionTextarea({ value, onChange, placeholder, rows = 3, className = 'cs-textarea', autoFocus = false }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [triggerPos, setTriggerPos] = useState(-1);
  const taRef = useRef(null);

  function getMentionQuery(text, caret) {
    const before = text.slice(0, caret);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return null;
    if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null;
    const query = before.slice(atIdx + 1);
    if (/\s/.test(query)) return null;
    if (query.length > 20) return null;
    return { atIdx, query };
  }

  async function handleInput(e) {
    const newVal = e.target.value;
    onChange(newVal);
    const caret = e.target.selectionStart;
    const m = getMentionQuery(newVal, caret);
    if (m && m.query.length >= 1) {
      setTriggerPos(m.atIdx);
      const results = await searchUsernames(m.query);
      setSuggestions(results);
      setShowSugg(results.length > 0);
      setActiveIdx(0);
    } else {
      setShowSugg(false);
      setTriggerPos(-1);
    }
  }

  function selectSuggestion(user) {
    if (triggerPos < 0) return;
    const before = value.slice(0, triggerPos);
    const after = value.slice(taRef.current.selectionStart);
    const newText = before + '@' + user.username + ' ' + after;
    onChange(newText);
    setShowSugg(false);
    setTriggerPos(-1);
    setTimeout(() => {
      if (taRef.current) {
        taRef.current.focus();
        const pos = (before + '@' + user.username + ' ').length;
        taRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  function handleKeyDown(e) {
    if (!showSugg) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectSuggestion(suggestions[activeIdx]); }
    else if (e.key === 'Escape') { setShowSugg(false); }
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        className={className}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowSugg(false), 150)}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
      />
      {showSugg && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 6,
          background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8, padding: 4, minWidth: 220, maxWidth: '90%',
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)', zIndex: 50,
        }}>
          {suggestions.map((u, i) => {
            const ini = (u.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            return (
              <div key={u.uid}
                onMouseDown={e => { e.preventDefault(); selectSuggestion(u); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                  background: i === activeIdx ? 'rgba(107,47,173,0.18)' : 'transparent',
                }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4b5fd', fontSize: 10, overflow: 'hidden', flexShrink: 0, fontFamily: 'Georgia, serif' }}>
                  {u.avatarUrl ? <img src={u.avatarUrl} alt={ini} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ini}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.displayName || u.username}</div>
                  <div style={{ fontSize: '0.66rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>@{u.username}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
