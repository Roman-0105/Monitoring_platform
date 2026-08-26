import React from 'react';
import { html } from '../lib/html.js';

export function Topbar({ title, crumb, quarry, onQuarryChange, userName }) {
  const initials = (userName || 'U').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  return html`
    <header class="topbar">
      <div>
        ${crumb && html`<div class="topbar-crumb">${crumb}</div>`}
        <div class="topbar-title">${title}</div>
      </div>
      <div class="topbar-spacer" />
      <div class="quarry-switch">
        ${['ЮРГ', 'СРГ'].map((q) => html`
          <button key=${q} class=${quarry === q ? 'active' : ''} onClick=${() => onQuarryChange(q)}>${q}</button>
        `)}
      </div>
      <div class="topbar-user">
        <div class="topbar-avatar">${initials}</div>
        <div>
          <div class="topbar-user-name">${userName}</div>
          <div class="topbar-user-role">Пилотная сборка</div>
        </div>
      </div>
    </header>
  `;
}
