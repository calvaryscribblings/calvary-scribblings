'use client';

import { useState, useRef } from 'react';

const MIN_ESSAY_CHARS = 30;

export default function QuizMain({ quizData, onSubmit }) {
  const { mcqs, essays } = quizData;
  const [mcqAnswers, setMcqAnswers] = useState(() => Array(mcqs.length).fill(null));
  const [essayAnswers, setEssayAnswers] = useState(() => Array(essays.length).fill(''));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const questionRefs = useRef({});

  function setRef(key, el) {
    if (el) questionRefs.current[key] = el;
  }

  function validate() {
    const newErrors = {};

    for (let i = 0; i < mcqs.length; i++) {
      if (mcqAnswers[i] === null) {
        newErrors[`mcq-${i}`] = true;
      }
    }

    for (let i = 0; i < essays.length; i++) {
      if ((essayAnswers[i] || '').trim().length < MIN_ESSAY_CHARS) {
        newErrors[`essay-${i}`] = true;
      }
    }

    return newErrors;
  }

  function handleSubmit() {
    const newErrors = validate();
    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      const firstKey = Object.keys(newErrors)[0];
      const el = questionRefs.current[firstKey];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setSubmitting(true);
    onSubmit(mcqAnswers, essayAnswers);
  }

  const borderFor = key => errors[key]
    ? '1px solid rgba(220,38,38,0.5)'
    : '1px solid rgba(107,47,173,0.15)';

  return (
    <div style={{ background: '#0a0a0a', maxWidth: 680, margin: '0 auto', padding: '0 2rem 4rem' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@400;500;600&display=swap');
        .qm-option { display: flex; align-items: flex-start; gap: 0.65rem; cursor: pointer; padding: 0.7rem 0.85rem; border-radius: 9px; border: 1px solid rgba(107,47,173,0.14); background: transparent; transition: all 0.15s; }
        .qm-option:hover { background: rgba(107,47,173,0.06); border-color: rgba(107,47,173,0.3); }
        .qm-option.selected { background: rgba(107,47,173,0.1); border-color: rgba(107,47,173,0.45); }
        .qm-option.error { border-color: rgba(220,38,38,0.4); }
        .qm-radio { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(107,47,173,0.4); background: transparent; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; transition: all 0.15s; }
        .qm-radio.selected { border-color: #6b2fad; background: #6b2fad; }
        .qm-radio.selected::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff; display: block; }
        @keyframes qm-error-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
      `}</style>

      {/* MCQ section */}
      <div style={{ borderTop: '1px solid rgba(107,47,173,0.2)', paddingTop: '2rem', marginBottom: '2.5rem' }}>
        <div style={{
          fontSize: '0.68rem',
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#9b6dff',
          fontFamily: 'Inter, sans-serif',
          marginBottom: '1.75rem',
        }}>
          15 Multiple Choice
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {mcqs.map((q, qi) => (
            <div
              key={qi}
              ref={el => setRef(`mcq-${qi}`, el)}
              style={{
                border: borderFor(`mcq-${qi}`),
                borderRadius: 12,
                padding: '1.25rem',
                background: errors[`mcq-${qi}`] ? 'rgba(220,38,38,0.03)' : 'rgba(255,255,255,0.02)',
                transition: 'border-color 0.2s',
                animation: errors[`mcq-${qi}`] ? 'qm-error-shake 0.3s' : 'none',
              }}
            >
              <div style={{
                fontSize: '0.65rem',
                color: 'rgba(255,255,255,0.25)',
                fontFamily: 'Inter, sans-serif',
                letterSpacing: '0.1em',
                marginBottom: '0.75rem',
              }}>
                Q{qi + 1}
              </div>
              <p style={{
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                fontSize: '1.05rem',
                color: '#f5f0e8',
                lineHeight: 1.65,
                margin: '0 0 1rem',
              }}>
                {q.question}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(q.options || []).filter(o => o && o.trim()).map((opt, oi) => {
                  const selected = mcqAnswers[qi] === oi;
                  return (
                    <label
                      key={oi}
                      className={`qm-option${selected ? ' selected' : ''}${errors[`mcq-${qi}`] ? ' error' : ''}`}
                      onClick={() => {
                        setMcqAnswers(a => a.map((v, idx) => idx === qi ? oi : v));
                        setErrors(e => { const next = { ...e }; delete next[`mcq-${qi}`]; return next; });
                      }}
                    >
                      <div className={`qm-radio${selected ? ' selected' : ''}`} />
                      <span style={{
                        fontFamily: 'Cormorant Garamond, Georgia, serif',
                        fontSize: '0.98rem',
                        color: selected ? '#f5f0e8' : 'rgba(240,234,216,0.7)',
                        lineHeight: 1.55,
                      }}>
                        {opt}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Essay section */}
      <div>
        <div style={{
          fontSize: '0.68rem',
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#9b6dff',
          fontFamily: 'Inter, sans-serif',
          marginBottom: '1.75rem',
        }}>
          3 Essays
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {essays.map((q, ei) => (
            <div
              key={ei}
              ref={el => setRef(`essay-${ei}`, el)}
              style={{
                border: borderFor(`essay-${ei}`),
                borderRadius: 12,
                padding: '1.25rem',
                background: errors[`essay-${ei}`] ? 'rgba(220,38,38,0.03)' : 'rgba(255,255,255,0.02)',
                transition: 'border-color 0.2s',
                animation: errors[`essay-${ei}`] ? 'qm-error-shake 0.3s' : 'none',
              }}
            >
              <div style={{
                fontSize: '0.65rem',
                color: 'rgba(255,255,255,0.25)',
                fontFamily: 'Inter, sans-serif',
                letterSpacing: '0.1em',
                marginBottom: '0.75rem',
              }}>
                Essay {ei + 1}
              </div>
              <p style={{
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                fontSize: '1.05rem',
                color: '#f5f0e8',
                lineHeight: 1.65,
                margin: '0 0 1rem',
              }}>
                {q.question}
              </p>
              <textarea
                value={essayAnswers[ei]}
                onChange={e => {
                  const val = e.target.value;
                  setEssayAnswers(a => a.map((v, idx) => idx === ei ? val : v));
                  if (val.trim().length >= MIN_ESSAY_CHARS) {
                    setErrors(err => { const next = { ...err }; delete next[`essay-${ei}`]; return next; });
                  }
                }}
                rows={6}
                placeholder="Write your answer here…"
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.03)',
                  border: errors[`essay-${ei}`]
                    ? '1px solid rgba(220,38,38,0.4)'
                    : '1px solid rgba(107,47,173,0.2)',
                  borderRadius: 9,
                  padding: '0.85rem 1rem',
                  fontSize: '1rem',
                  fontFamily: 'Cormorant Garamond, Georgia, serif',
                  color: '#e8e0d4',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                  lineHeight: 1.7,
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => {
                  if (!errors[`essay-${ei}`]) e.currentTarget.style.borderColor = 'rgba(107,47,173,0.45)';
                }}
                onBlur={e => {
                  if (!errors[`essay-${ei}`]) e.currentTarget.style.borderColor = 'rgba(107,47,173,0.2)';
                }}
              />
              {errors[`essay-${ei}`] && (
                <div style={{
                  fontSize: '0.7rem',
                  color: 'rgba(220,38,38,0.7)',
                  fontFamily: 'Inter, sans-serif',
                  marginTop: '0.4rem',
                }}>
                  Please write at least 30 characters.
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          marginTop: '2.5rem',
          width: '100%',
          background: '#6b2fad',
          border: 'none',
          borderRadius: 10,
          padding: '1rem',
          color: '#fff',
          fontFamily: 'Inter, sans-serif',
          fontSize: '0.78rem',
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          cursor: submitting ? 'not-allowed' : 'pointer',
          opacity: submitting ? 0.6 : 1,
          transition: 'background 0.2s',
        }}
        onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = '#7c3aed'; }}
        onMouseLeave={e => e.currentTarget.style.background = '#6b2fad'}
      >
        {submitting ? 'Submitting…' : 'Submit Quiz'}
      </button>
    </div>
  );
}
