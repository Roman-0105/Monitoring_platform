import React, { useState } from 'react';
import { html } from '../lib/html.js';

// Схематичная карта карьера без растрового фона (см. lib/quarries.js) — точки позиционируются
// в процентах внутри охвата координат карьера, с сеткой для ориентира и тултипом при наведении.
export function ScatterMap({ points, bounds, legend }) {
  const [hover, setHover] = useState(null);
  const gridLines = [10, 20, 30, 40, 50, 60, 70, 80, 90];

  return html`
    <div>
      <div style=${{ position: 'relative', width: '100%', paddingBottom: '68%', background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <div style=${{ position: 'absolute', inset: 0 }}>
          ${gridLines.map((p) => html`<div key=${'v' + p} style=${{ position: 'absolute', left: p + '%', top: 0, bottom: 0, width: '1px', background: 'var(--border-subtle)' }} />`)}
          ${gridLines.map((p) => html`<div key=${'h' + p} style=${{ position: 'absolute', top: p + '%', left: 0, right: 0, height: '1px', background: 'var(--border-subtle)' }} />`)}
          ${points.map((p, i) => html`
            <div
              key=${p.id || i}
              onMouseEnter=${() => setHover(p)}
              onMouseLeave=${() => setHover((h) => (h === p ? null : h))}
              style=${{
                position: 'absolute', left: p.left + '%', top: p.top + '%', width: '11px', height: '11px',
                marginLeft: '-5.5px', marginTop: '-5.5px', borderRadius: '999px', background: p.color || 'var(--gold-500)',
                border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', cursor: 'pointer',
                transform: hover === p ? 'scale(1.6)' : 'scale(1)', transition: 'transform .1s ease', zIndex: hover === p ? 2 : 1,
              }}
            />
          `)}
        </div>
        ${hover && html`
          <div style=${{
            position: 'absolute', left: `min(${hover.left}%, 82%)`, top: `max(${hover.top}% - 8px, 2%)`, transform: 'translateY(-100%)',
            background: 'var(--stone-900)', color: '#fff', fontSize: '12px', padding: '8px 11px', borderRadius: '7px', pointerEvents: 'none',
            boxShadow: 'var(--shadow-md)', whiteSpace: 'nowrap', zIndex: 3,
          }}>
            <div style=${{ fontWeight: 700 }}>${hover.name}</div>
            ${hover.subtitle && html`<div style=${{ opacity: 0.75 }}>${hover.subtitle}</div>`}
          </div>
        `}
      </div>
      ${legend && html`
        <div style=${{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '12px' }}>
          ${legend.map((l) => html`
            <div key=${l.label} style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span style=${{ width: '9px', height: '9px', borderRadius: '999px', background: l.color, flexShrink: 0 }} />
              ${l.label}
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}
