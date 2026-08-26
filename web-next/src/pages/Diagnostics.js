import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '../components/ui.js';

function Row({ label, value, mono }) {
  return html`
    <div style=${{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)', fontSize: '13px' }}>
      <span style=${{ color: 'var(--text-secondary)' }}>${label}</span>
      <span class=${mono ? 'mono' : ''} style=${{ fontWeight: 600, textAlign: 'right' }}>${value}</span>
    </div>
  `;
}

export function DiagnosticsPage() {
  const [ping, setPing] = useState('checking'); // checking | ok | fail
  const [pingMs, setPingMs] = useState(null);
  const [pingError, setPingError] = useState('');

  useEffect(() => {
    (async () => {
      const t0 = performance.now();
      const { error } = await supabase.from('wp_registry').select('id', { count: 'exact', head: true });
      setPingMs(Math.round(performance.now() - t0));
      if (error) { setPing('fail'); setPingError(error.message); } else { setPing('ok'); }
    })();
  }, []);

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Диагностика</div>
          <div class="page-desc">Состояние соединения и окружения пилотной сборки.</div>
        </div>
      </div>

      <div class="grid grid-2">
        <${Card}>
          <${CardHeader}><${CardTitle} subtitle="Проверка чтения из wp_registry">Supabase<//><//>
          <${CardContent} tight>
            <${Row} label="Статус соединения" value=${
              ping === 'checking' ? html`<${Badge}><${Loader2} size=${12} class="mono" /> Проверка…<//>` :
              ping === 'ok' ? html`<${Badge} variant="success"><${CheckCircle2} size=${12} /> Работает<//>` :
              html`<${Badge} variant="danger"><${XCircle} size=${12} /> Ошибка<//>`
            } />
            ${ping === 'ok' && html`<${Row} label="Время отклика" value=${pingMs + ' мс'} mono />`}
            ${ping === 'fail' && html`<${Row} label="Сообщение об ошибке" value=${pingError} />`}
            <${Row} label="Проект" value="dusmrxvybojyrqmmqxjx" mono />
          <//>
        <//>

        <${Card}>
          <${CardHeader}><${CardTitle}>Окружение<//><//>
          <${CardContent} tight>
            <${Row} label="Сборка" value="Пилот (без build step, ESM/CDN)" />
            <${Row} label="Браузер" value=${navigator.userAgent.split(') ').slice(-1)[0].split(' ')[0]} mono />
            <${Row} label="Разрешение экрана" value=${window.screen.width + '×' + window.screen.height} mono />
            <${Row} label="Локальное время" value=${new Date().toLocaleString('ru-RU')} mono />
          <//>
        <//>
      </div>

      <div style=${{ marginTop: '16px' }}>
        <${Card}>
          <${CardContent}>
            <div style=${{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <${Activity} size=${18} style=${{ color: 'var(--gold-500)', flexShrink: 0, marginTop: '2px' }} />
              <div style=${{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                В этой пилотной сборке нет офлайн-очереди синхронизации, как в прежнем интерфейсе — все страницы читают и пишут
                напрямую в Supabase. Для полноценного продакшен-релиза офлайн-режим можно будет добавить отдельно, если он нужен.
              </div>
            </div>
          <//>
        <//>
      </div>
    </div>
  `;
}
