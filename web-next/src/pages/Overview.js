import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Droplets, Database, GitCommitHorizontal, Ruler, Clock } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { WP_TYPES } from '../lib/wp-types.js';
import { Card, CardHeader, CardTitle, CardContent, KpiCard, Skeleton, Badge } from '../components/ui.js';

async function countOf(table) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export function OverviewPage() {
  const [kpi, setKpi] = useState(null);
  const [byType, setByType] = useState(null);
  const [recent, setRecent] = useState(null);
  const [registryNames, setRegistryNames] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [registryCount, pointsCount, wellsCount, levelsCount, registryRows, levelRows] = await Promise.all([
          countOf('wp_registry'),
          countOf('points'),
          countOf('wells'),
          countOf('wp_well_levels'),
          supabase.from('wp_registry').select('id, name, wp_type'),
          supabase.from('wp_well_levels').select('id, well_id, date, depth_to_water').order('date', { ascending: false }).limit(8),
        ]);
        if (cancelled) return;
        setKpi({ registryCount, pointsCount, wellsCount, levelsCount });

        const names = {};
        const tally = {};
        (registryRows.data || []).forEach((r) => {
          names[r.id] = r.name;
          tally[r.wp_type] = (tally[r.wp_type] || 0) + 1;
        });
        setRegistryNames(names);
        setByType(Object.keys(WP_TYPES).map((t) => ({ type: t, label: WP_TYPES[t].short, count: tally[t] || 0 })).filter((r) => r.count > 0));
        setRecent(levelRows.data || []);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const kpiCards = useMemo(() => ([
    { key: 'registry', label: 'Водопунктов в реестре', icon: Database, value: kpi ? kpi.registryCount : null },
    { key: 'points', label: 'Записей мониторинга', icon: Droplets, value: kpi ? kpi.pointsCount : null },
    { key: 'wells', label: 'Гор. скважин', icon: GitCommitHorizontal, value: kpi ? kpi.wellsCount : null },
    { key: 'levels', label: 'Замеров УПВ', icon: Ruler, value: kpi ? kpi.levelsCount : null },
  ]), [kpi]);

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Обзор</div>
          <div class="page-desc">Сводка по платформе гидромониторинга карьера — данные напрямую из Supabase.</div>
        </div>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка загрузки: ${error}</div>`}

      <div class="grid grid-4" style=${{ marginBottom: '16px' }}>
        ${kpiCards.map((c) => html`
          <div key=${c.key}>
            ${c.value === null
              ? html`<${Card}><div class="kpi-card"><${Skeleton} width="60%" height="11px" /><${Skeleton} width="40%" height="26px" style=${{ marginTop: '4px' }} /></div><//>`
              : html`<${KpiCard} label=${c.label} value=${c.value.toLocaleString('ru-RU')} />`}
          </div>
        `)}
      </div>

      <div class="grid grid-2">
        <${Card}>
          <${CardHeader}>
            <${CardTitle} subtitle="Реестр водопунктов по типам">Распределение по типам<//>
          <//>
          <${CardContent}>
            ${byType === null
              ? html`<${Skeleton} height="220px" />`
              : html`
                <div style=${{ width: '100%', height: '240px' }}>
                  <${ResponsiveContainer}>
                    <${BarChart} data=${byType} layout="vertical" margin=${{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <${CartesianGrid} horizontal=${false} stroke="var(--border-subtle)" />
                      <${XAxis} type="number" tick=${{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} allowDecimals=${false} />
                      <${YAxis} type="category" dataKey="label" width=${120} tick=${{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine=${false} tickLine=${false} />
                      <${Tooltip} contentStyle=${{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} cursor=${{ fill: 'var(--bg-hover)' }} />
                      <${Bar} dataKey="count" fill="var(--gold-400)" radius=${[0, 6, 6, 0]} barSize=${18} />
                    <//>
                  <//>
                </div>
              `}
          <//>
        <//>

        <${Card}>
          <${CardHeader}>
            <${CardTitle} subtitle="Последние 8 записей">Замеры УПВ<//>
          <//>
          <${CardContent} tight>
            ${recent === null ? html`<div style=${{ padding: '18px' }}><${Skeleton} height="120px" /></div>` : html`
              <div>
                ${recent.length === 0 && html`<div style=${{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Замеров пока нет</div>`}
                ${recent.map((r) => html`
                  <div key=${r.id} style=${{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <${Clock} size=${14} style=${{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                    <div style=${{ flex: 1, minWidth: 0 }}>
                      <div style=${{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${registryNames[r.well_id] || r.well_id}</div>
                      <div style=${{ fontSize: 11, color: 'var(--text-tertiary)' }}>${r.date}</div>
                    </div>
                    <${Badge}>${Number(r.depth_to_water).toFixed(2)} м<//>
                  </div>
                `)}
              </div>
            `}
          <//>
        <//>
      </div>
    </div>
  `;
}
