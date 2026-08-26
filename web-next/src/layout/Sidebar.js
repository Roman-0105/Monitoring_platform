import React from 'react';
import * as Icons from 'lucide-react';
import { html } from '../lib/html.js';
import { NAV_SECTIONS } from '../nav-config.js';
import { APP_VERSION } from '../version.js';

function Icon({ name, size = 18 }) {
  const Cmp = Icons[name] || Icons.Circle;
  return html`<${Cmp} size=${size} strokeWidth=${2} />`;
}

export function Sidebar({ collapsed, onToggleCollapsed, activeKey, onNavigate }) {
  return html`
    <aside class="sidebar" data-collapsed=${collapsed ? '1' : '0'}>
      <div class="sidebar-brand">
        <img src="./public/logo.png" alt="ZiJin | RG Gold" class="sidebar-logo" />
        ${!collapsed && html`<span class="sidebar-version">${APP_VERSION}</span>`}
      </div>

      <nav class="sidebar-nav">
        ${NAV_SECTIONS.map((section, si) => html`
          <div class="sidebar-section" key=${si}>
            ${section.label && !collapsed && html`<div class="sidebar-section-label">${section.label}</div>`}
            ${section.items.map((item) => html`
              <button
                key=${item.key}
                class=${'sidebar-item' + (activeKey === item.key ? ' active' : '')}
                title=${collapsed ? item.label : undefined}
                onClick=${() => onNavigate(item.key)}
              >
                <${Icon} name=${item.icon} />
                ${!collapsed && html`<span class="sidebar-item-label">${item.label}</span>`}
                ${!collapsed && !item.pilot && html`<span class="sidebar-item-wip" title="Ещё не перенесено в новый дизайн">скоро</span>`}
                ${!collapsed && item.external && html`<${Icons.ExternalLink} size=${13} style=${{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-tertiary)' }} />`}
              </button>
            `)}
          </div>
        `)}
      </nav>

      <button class="sidebar-collapse-btn" onClick=${onToggleCollapsed} title=${collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
        <${collapsed ? Icons.PanelLeftOpen : Icons.PanelLeftClose} size=${17} />
      </button>
    </aside>
  `;
}
