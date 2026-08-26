import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { Card, CardHeader, CardTitle, CardContent, Badge, Select, Skeleton, EmptyState } from '../components/ui.js';

// Простая линейная регрессия y = a + b·x (x — порядковый номер дня от первого замера)
function linearTrend(points) {
  const n = points.length;
  if (n < 2) return null;
  const x0 = points[0].t;
  const xs = points.map((p) => (p.t - x0) / 86400000);
  const ys = points.map((p) => p.y);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xMean) * (ys[i] - yMean); den += (xs[i] - xMean) ** 2; }
  const slope = den ? num / den : 0; // м/сутки
  const intercept = yMean - slope * xMean;
  return { slope, intercept, x0 };
}

export function SumpForecastPage() {
  const [sumps, setSumps] = useState(null);
  const [levels, setLevels] = useState([]);
  const [days, setDays] = useState(30);

  useEffect(() => {
    (async () => {
      const [sumpsR, levelsR] = await Promise.all([
        supabase.from('dew_sumps').select('*').order('name'),
        supabase.from('dew_water_levels').select('sump_id, date, elevation').order('date', { ascending: true }).limit(3000),
      ]);
      setSumps(sumpsR.data || []);
      setLevels(levelsR.data || []);
    })();
  }, []);

  const forecasts = useMemo(() => {
    if (!sumps) return [];
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return sumps.map((s) => {
      const hist = levels
        .filter((l) => l.sump_id === s.id && l.elevation != null && (days === 0 || l.date >= cutoffStr))
        .map((l) => ({ t: new Date(l.date).getTime(), y: l.elevation, date: l.date }))
        .sort((a, b) => a.t - b.t);
      const trend = linearTrend(hist);
      const current = hist.length ? hist[hist.length - 1].y : null;
      let daysToCritical = null;
      if (trend && s.critical_level != null && trend.slope < -0.0001 && current != null) {
        daysToCritical = Math.round((current - s.critical_level) / -trend.slope);
      }
      return { sump: s, hist, trend, current, daysToCritical };
    }).filter((f) => f.hist.length >= 2);
  }, [sumps, levels, days]);

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Прогноз зумпфов</div>
          <div class="page-desc">Упрощённый линейный прогноз по тренду уровня воды за период — быстрая оценка вместо полного объёмного 3D-расчёта.</div>
        </div>
        <${Select} style=${{ width: '160px' }} value=${days} onChange=${(e) => setDays(parseInt(e.target.value))}>
          <option value="14">14 дней</option>
          <option value="30">30 дней</option>
          <option value="90">90 дней</option>
          <option value="0">Вся история</option>
        <//>
      </div>

      ${sumps === null ? html`<${Skeleton} height="300px" />` : !forecasts.length ? html`
        <${Card}><${CardContent}><${EmptyState} icon=${html`<${TrendingUp} size=${40} />`} title="Недостаточно данных" description="Нужно минимум 2 замера уровня воды в выбранном периоде." /><//><//>
      ` : html`
        <div class="grid grid-2">
          ${forecasts.map((f) => {
            const chartData = f.hist.map((p) => ({ date: p.date.slice(5), Уровень: p.y }));
            const trendingDown = f.trend && f.trend.slope < -0.0001;
            return html`
              <${Card} key=${f.sump.id}>
                <${CardHeader}>
                  <${CardTitle} subtitle=${f.sump.quarry || undefined}>${f.sump.name}<//>
                  ${f.daysToCritical != null && f.daysToCritical >= 0 && html`
                    <${Badge} variant=${f.daysToCritical < 14 ? 'danger' : 'warning'}><${AlertTriangle} size=${11} /> ~${f.daysToCritical} дн. до критич.<//>
                  `}
                <//>
                <${CardContent}>
                  <div style=${{ display: 'flex', gap: '20px', marginBottom: '12px' }}>
                    <div>
                      <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Текущий уровень</div>
                      <div class="mono" style=${{ fontSize: '18px', fontWeight: 700 }}>${f.current != null ? f.current.toFixed(2) + ' м' : '—'}</div>
                    </div>
                    <div>
                      <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Тренд</div>
                      <div class="mono" style=${{ fontSize: '18px', fontWeight: 700, color: trendingDown ? 'var(--red-500)' : 'var(--green-500)' }}>
                        ${f.trend ? (f.trend.slope >= 0 ? '+' : '') + (f.trend.slope * 30).toFixed(2) + ' м/30сут' : '—'}
                      </div>
                    </div>
                    ${f.sump.critical_level != null && html`
                      <div>
                        <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Критический</div>
                        <div class="mono" style=${{ fontSize: '18px', fontWeight: 700, color: 'var(--text-tertiary)' }}>${f.sump.critical_level.toFixed(2)} м</div>
                      </div>
                    `}
                  </div>
                  <div style=${{ width: '100%', height: '160px' }}>
                    <${ResponsiveContainer}>
                      <${LineChart} data=${chartData} margin=${{ left: -18, right: 8, top: 4, bottom: 0 }}>
                        <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                        <${XAxis} dataKey="date" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} minTickGap=${30} />
                        <${YAxis} domain=${['auto', 'auto']} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${40} />
                        <${Tooltip} contentStyle=${{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)' }} />
                        ${f.sump.critical_level != null && html`<${ReferenceLine} y=${f.sump.critical_level} stroke="var(--red-400)" strokeDasharray="4 3" />`}
                        <${Line} type="monotone" dataKey="Уровень" stroke="var(--gold-500)" strokeWidth=${2} dot=${false} />
                      <//>
                    <//>
                  </div>
                <//>
              <//>
            `;
          })}
        </div>
      `}
    </div>
  `;
}
