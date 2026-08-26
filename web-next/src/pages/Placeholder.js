import React from 'react';
import { Construction } from 'lucide-react';
import { html } from '../lib/html.js';
import { Card, CardContent, EmptyState } from '../components/ui.js';

export function PlaceholderPage({ label }) {
  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">${label}</div>
          <div class="page-desc">Этот раздел ещё не перенесён в новый дизайн — сейчас он доступен в прежнем интерфейсе.</div>
        </div>
      </div>
      <${Card}>
        <${CardContent}>
          <${EmptyState}
            icon=${html`<${Construction} size=${40} />`}
            title="Раздел в разработке"
            description="Показываем в пилоте только несколько ключевых страниц — Обзор, Реестр водопунктов и Модель карьера. Остальное перенесём после утверждения направления."
          />
        <//>
      <//>
    </div>
  `;
}
