import React from 'react';
import { html } from '../lib/html.js';

export function Button({ variant = 'primary', size = 'md', icon = false, className = '', ...props }) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', icon ? 'btn-icon' : '', className].filter(Boolean).join(' ');
  return html`<button class=${cls} ...${props} />`;
}

export function Card({ children, className = '', ...props }) {
  return html`<div class=${'card ' + className} ...${props}>${children}</div>`;
}
export function CardHeader({ children, ...props }) { return html`<div class="card-header" ...${props}>${children}</div>`; }
export function CardTitle({ children, subtitle }) {
  return html`
    <div>
      <div class="card-title">${children}</div>
      ${subtitle && html`<div class="card-subtitle">${subtitle}</div>`}
    </div>
  `;
}
export function CardContent({ children, tight = false }) {
  return html`<div class=${'card-content' + (tight ? ' tight' : '')}>${children}</div>`;
}

export function Badge({ variant = 'default', dot = false, children }) {
  return html`<span class=${'badge ' + (variant !== 'default' ? 'badge-' + variant : '')}>${dot && html`<span class="badge-dot" />`}${children}</span>`;
}

export function Input({ icon, className = '', ...props }) {
  if (icon) {
    return html`<div class="input-icon-wrap">${icon}<input class=${'input ' + className} ...${props} /></div>`;
  }
  return html`<input class=${'input ' + className} ...${props} />`;
}

export function Select({ className = '', children, ...props }) {
  return html`<select class=${'select ' + className} ...${props}>${children}</select>`;
}

export function Field({ label, children }) {
  return html`<div class="field"><label class="field-label">${label}</label>${children}</div>`;
}

export function Skeleton({ width = '100%', height = '14px', style = {} }) {
  return html`<div class="skeleton" style=${{ width, height, ...style }} />`;
}

export function EmptyState({ icon, title, description }) {
  return html`
    <div class="empty-state">
      ${icon}
      <div class="empty-state-title">${title}</div>
      ${description && html`<div>${description}</div>`}
    </div>
  `;
}

export function KpiCard({ label, value, unit, trend, trendLabel }) {
  return html`
    <${Card}>
      <div class="kpi-card">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}${unit && html`<span style=${{ fontSize: '14px', fontWeight: 600, color: 'var(--text-tertiary)', marginLeft: '4px' }}>${unit}</span>`}</div>
        ${trend != null && html`
          <div class=${'kpi-trend ' + (trend >= 0 ? 'up' : 'down')}>
            <span>${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend)}${typeof trend === 'number' && Math.abs(trend) < 100 ? '%' : ''}</span>
            ${trendLabel && html`<span style=${{ color: 'var(--text-tertiary)', fontWeight: 500 }}>${trendLabel}</span>`}
          </div>
        `}
      </div>
    <//>
  `;
}

export function Tabs({ tabs, value, onChange }) {
  return html`
    <div class="tabs-list">
      ${tabs.map((t) => html`
        <button key=${t.value} class=${'tabs-trigger' + (t.value === value ? ' active' : '')} onClick=${() => onChange(t.value)}>
          ${t.label}
          ${t.badge && html`<span class="tabs-trigger-badge">${t.badge}</span>`}
        </button>
      `)}
    </div>
  `;
}

export function Table({ columns, rows, rowKey, emptyIcon, emptyTitle, emptyDescription, loading, onRowClick }) {
  if (loading) {
    return html`
      <div class="table-wrap"><table class="data-table">
        <thead><tr>${columns.map((c) => html`<th key=${c.key}>${c.header}</th>`)}</tr></thead>
        <tbody>
          ${[0, 1, 2, 3, 4].map((i) => html`
            <tr key=${i}>${columns.map((c) => html`<td key=${c.key}><${Skeleton} height="12px" width=${(40 + (i * 7) % 40) + '%'} /></td>`)}</tr>
          `)}
        </tbody>
      </table></div>
    `;
  }
  if (!rows.length) {
    return html`<${EmptyState} icon=${emptyIcon} title=${emptyTitle} description=${emptyDescription} />`;
  }
  return html`
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${columns.map((c) => html`<th key=${c.key} style=${c.width ? { width: c.width } : undefined}>${c.header}</th>`)}</tr></thead>
        <tbody>
          ${rows.map((row) => html`
            <tr key=${rowKey(row)} onClick=${onRowClick ? () => onRowClick(row) : undefined} style=${onRowClick ? { cursor: 'pointer' } : undefined}>${columns.map((c) => html`<td key=${c.key}>${c.render ? c.render(row) : row[c.key]}</td>`)}</tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

// Оборачивает содержимое страницы: если canEdit=false, блокирует все клики/ввод
// внутри и показывает плашку «Только просмотр» — не требует правок внутри самих
// страниц, работает как общий генерик-гейт для ролей с правом просмотра без записи.
export function ReadOnlyGate({ active, children }) {
  if (!active) return children;
  return html`
    <div style=${{ position: 'relative' }}>
      <div style=${{ position: 'absolute', top: '10px', right: '10px', zIndex: 50, display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '999px', background: 'var(--amber-100)', color: 'var(--amber-600)', fontSize: '11.5px', fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
        👁 Только просмотр
      </div>
      <div style=${{ pointerEvents: 'none', opacity: 0.75 }}>${children}</div>
    </div>
  `;
}

export function Dialog({ open, onClose, title, children, footer, width }) {
  if (!open) return null;
  return html`
    <div class="dialog-overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dialog" style=${width ? { width } : undefined}>
        <div class="dialog-header">
          <div class="dialog-title">${title}</div>
          <${Button} variant="ghost" size="sm" icon onClick=${onClose}>✕<//>
        </div>
        <div class="dialog-body">${children}</div>
        ${footer && html`<div class="dialog-footer">${footer}</div>`}
      </div>
    </div>
  `;
}
