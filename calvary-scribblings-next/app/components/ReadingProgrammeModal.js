'use client';
import { useEffect, useState } from 'react';

export default function ReadingProgrammeModal() {
  const [visible, setVisible] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('rp_shown') === 'true') return;
    setDismissed(false);
    const showTimer = setTimeout(() => {
      setVisible(true);
      const closeTimer = setTimeout(() => setShowClose(true), 5000);
      return () => clearTimeout(closeTimer);
    }, 5000);
    return () => clearTimeout(showTimer);
  }, []);

  if (dismissed || !visible) return null;

  const handleClose = () => {
    sessionStorage.setItem('rp_shown', 'true');
    setDismissed(true);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <img
          src="/reading-programme.jpg"
          alt="Reading Programme"
          style={{
            maxWidth: '380px',
            width: '90vw',
            borderRadius: '16px',
            display: 'block',
          }}
        />
        {showClose && (
          <button
            onClick={handleClose}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#6b2fad',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
