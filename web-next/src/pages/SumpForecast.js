import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, LineChart, BarChart, Line, Bar, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea } from 'recharts';
import { Waves, TrendingUp, AlertTriangle, Upload, Box, Trash2, Plus, CheckCircle2, History } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { computedVolume } from '../lib/dewatering-core.js';
import {
  sumpHasCurve, getCurveForDate, volumeAt, latestLevel, computeInflowHistory, pumpPerformance,
  simulateForecast, fetchCurveVersions, deleteCurveVersion, saveCriticalLevel, handleTridbUpload, fetchTridbGeometry,
} from '../lib/sump-forecast-core.js';
import { SumpScene } from '../lib/sump-3d.js';
import { Card, CardHeader, CardTitle, CardContent, Select, Input, Button, Field, Tabs, Skeleton, EmptyState, KpiCard } from '../components/ui.js';

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmt(n, dec = 0) { return n == null || isNaN(n) ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function dtLocal(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }

// ── Загрузка и приведение данных ────────────────────────────────────────────
function useSumpForecastData() {
  const [state, setState] = useState({ loading: true, error: null, sumps: [], pumps: [], readings: [], levels: [], curveVersions: [] });

  async function reload() {
    const [sumpsR, pumpsR, readingsR, levelsR, curveVersions] = await Promise.all([
      supabase.from('dew_sumps').select('*').order('name'),
      supabase.from('dew_pumps').select('*').order('name'),
      supabase.from('dew_meter_readings').select('*').order('date', { ascending: false }).limit(3000),
      supabase.from('dew_water_levels').select('*').order('date', { ascending: false }).limit(3000),
      fetchCurveVersions().catch((e) => { console.warn('[sump-forecast] curve versions:', e.message); return []; }),
    ]);
    const err = sumpsR.error || pumpsR.error || readingsR.error || levelsR.error;
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return; }
    setState({
      loading: false, error: null,
      sumps: sumpsR.data || [],
      pumps: (pumpsR.data || []).map((p) => ({ ...p, sumpId: p.sump_id })),
      readings: (readingsR.data || []).map((r) => ({
        ...r, pumpId: r.pump_id, isReset: r.is_reset, isStopped: r.is_stopped,
        resetStartValue: r.reset_start_value, hoursWorked: r.hours_worked,
        isManualVolume: r.is_manual_volume, manualVolume: r.manual_volume,
      })),
      levels: (levelsR.data || []).map((l) => ({ ...l, sumpId: l.sump_id })),
      curveVersions,
    });
  }
  useEffect(() => { reload(); }, []);
  return { ...state, reload };
}

const PERIODS = [{ d: 1, label: '1 сут' }, { d: 7, label: '7 дн' }, { d: 14, label: '14 дн' }, { d: 30, label: '30 дн' }, { d: 60, label: '60 дн' }, { d: 90, label: '90 дн' }];

export function SumpForecastPage() {
  const { loading, error, sumps, pumps, readings, levels, curveVersions, reload } = useSumpForecastData();
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('overview');
  const [days, setDays] = useState(30);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(today());
  const [manualQ, setManualQ] = useState({});
  const geomCache = useRef({});

  useEffect(() => { if (!selectedId && sumps.length) setSelectedId(sumps[0].id); }, [sumps, selectedId]);

  const dateTo = days === 0 ? (customTo || today()) : today();
  const dateFrom = days === 0 ? (customFrom || '') : (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); })();

  const sump = sumps.find((s) => s.id === selectedId) || null;
  const hasCurve = sump ? sumpHasCurve(sump, curveVersions) : false;
  const todayCurve = sump && hasCurve ? getCurveForDate(sump, curveVersions, today()) : null;
  const latestLev = sump ? latestLevel(sump.id, levels) : null;
  const currVol = todayCurve && latestLev != null ? volumeAt(todayCurve, latestLev) : null;
  const pct = hasCurve && currVol != null && sump && sump.total_volume ? (currVol / sump.total_volume * 100) : null;

  const inflow = useMemo(() => (sump && hasCurve && dateFrom)
    ? computeInflowHistory({ sump, curveVersions, waterLevels: levels, pumps, readings, dateFrom, dateTo })
    : [], [sump, hasCurve, curveVersions, levels, pumps, readings, dateFrom, dateTo]);
  const calcAvgQ = inflow.length ? inflow.reduce((s, r) => s + r.q, 0) / inflow.length : null;
  const manQ = sump ? manualQ[sump.id] : undefined;
  const avgQ = (manQ !== undefined && manQ !== null && !isNaN(manQ)) ? manQ : calcAvgQ;

  const pumpsPerf = useMemo(() => sump ? pumpPerformance({ sump, pumps, readings, dateFrom, dateTo }) : [], [sump, pumps, readings, dateFrom, dateTo]);
  const totalPumpQ = pumpsPerf.reduce((s, p) => s + p.q, 0);

  // Метрики для карточек в сайдбаре (по каждому зумпфу, за тот же период)
  const sumpMeta = useMemo(() => {
    const map = {};
    sumps.forEach((s) => {
      const hc = sumpHasCurve(s, curveVersions);
      const lev = latestLevel(s.id, levels);
      const curve = hc ? getCurveForDate(s, curveVersions, today()) : null;
      const vol = curve && lev != null ? volumeAt(curve, lev) : null;
      const p = vol != null && s.total_volume ? (vol / s.total_volume * 100) : null;
      const inf = hc && dateFrom ? computeInflowHistory({ sump: s, curveVersions, waterLevels: levels, pumps, readings, dateFrom, dateTo }) : [];
      const q = inf.length ? inf.reduce((a, r) => a + r.q, 0) / inf.length : null;
      map[s.id] = { lev, pct: p, q, hasCurve: hc };
    });
    return map;
  }, [sumps, curveVersions, levels, pumps, readings, dateFrom, dateTo]);

  if (loading) return html`<${Skeleton} height="500px" />`;
  if (error) return html`<${Card}><${CardContent}><${EmptyState} icon=${html`<${AlertTriangle} size=${36} />`} title="Ошибка загрузки" description=${error} /><//><//>`;
  if (!sumps.length) return html`<${Card}><${CardContent}><${EmptyState} icon=${html`<${Waves} size=${36} />`} title="Зумпфы не настроены" description="Добавьте их во вкладке «Журнал водоотлива»" /><//><//>`;

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Прогноз зумпфов</div>
          <div class="page-desc">Объёмная модель зумпфа по 3D-меху карьера (.tridb) — водоприток по фактической откачке, часовой прогноз уровня с учётом плановых остановок насосов.</div>
        </div>
      </div>

      <div style=${{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: '16px', alignItems: 'start' }}>
        <${SumpSidebar} sumps=${sumps} selectedId=${selectedId} onSelect=${setSelectedId} meta=${sumpMeta} />

        <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
          <${PeriodBar} days=${days} setDays=${setDays} customFrom=${customFrom} setCustomFrom=${setCustomFrom} customTo=${customTo} setCustomTo=${setCustomTo} />

          <div class="grid grid-4">
            <${KpiCard} label="Уровень воды" value=${latestLev != null ? latestLev.toFixed(2) : '—'} unit="м" />
            <${KpiCard} label="Заполнение" value=${pct != null && pct <= 110 ? pct.toFixed(1) : '—'} unit="%" />
            <${KpiCard} label="Водоприток Q" value=${calcAvgQ != null ? calcAvgQ.toFixed(1) : '—'} unit="м³/ч" />
            <${KpiCard} label="Насосы Q" value=${totalPumpQ > 0 ? totalPumpQ.toFixed(0) : '—'} unit="м³/ч" />
          </div>

          ${sump && sump.critical_level != null && latestLev != null && latestLev >= sump.critical_level && html`
            <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: 'var(--red-50)', border: '1px solid var(--red-400)', color: 'var(--red-600)', fontSize: '13px', fontWeight: 600 }}>
              <${AlertTriangle} size=${16} /> Текущий уровень (${latestLev.toFixed(2)} м) уже на критической отметке или выше (${sump.critical_level.toFixed(2)} м)
            </div>
          `}

          <${Tabs} tabs=${[
            { value: 'overview', label: 'Обзор' },
            { value: 'inflow', label: 'Приток и насосы' },
            { value: 'forecast', label: 'Прогноз' },
            { value: '3d', label: '3D-модель' },
          ]} value=${tab} onChange=${setTab} />

          ${!sump ? null : tab === 'overview' ? html`<${OverviewTab} sump=${sump} hasCurve=${hasCurve} curve=${todayCurve} curveVersions=${curveVersions} latestLev=${latestLev} currVol=${currVol} pct=${pct} levels=${levels} readings=${readings} pumps=${pumps} days=${days} dateFrom=${dateFrom} dateTo=${dateTo} onReload=${reload} onGeomLoaded=${(g) => { geomCache.current[sump.id] = g; }} />`
          : tab === 'inflow' ? html`<${InflowTab} sump=${sump} hasCurve=${hasCurve} curve=${todayCurve} inflow=${inflow} calcAvgQ=${calcAvgQ} manualQ=${manQ} onManualQ=${(v) => setManualQ((m) => ({ ...m, [sump.id]: v }))} pumpsPerf=${pumpsPerf} dateFrom=${dateFrom} dateTo=${dateTo} />`
          : tab === 'forecast' ? html`<${ForecastTab} sump=${sump} hasCurve=${hasCurve} curve=${todayCurve} avgQ=${avgQ} latestLev=${latestLev} pumpsPerf=${pumpsPerf} />`
          : html`<${Model3DTab} sump=${sump} hasCurve=${hasCurve} latestLev=${latestLev} geomCache=${geomCache} />`}
        </div>
      </div>
    </div>
  `;
}

// ── Сайдбар: список зумпфов с мини-метриками ─────────────────────────────────
function SumpSidebar({ sumps, selectedId, onSelect, meta }) {
  return html`
    <${Card} style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)' }}>Зумпфы</div>
      <div style=${{ maxHeight: '640px', overflowY: 'auto' }}>
        ${sumps.map((s) => {
          const m = meta[s.id] || {};
          const active = s.id === selectedId;
          const color = m.pct == null ? 'var(--text-tertiary)' : m.pct > 80 ? 'var(--red-500)' : m.pct > 60 ? 'var(--amber-500)' : 'var(--green-500)';
          return html`
            <div key=${s.id} onClick=${() => onSelect(s.id)}
              style=${{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', background: active ? 'var(--gold-50)' : 'transparent', borderLeft: active ? '3px solid var(--gold-500)' : '3px solid transparent' }}>
              <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                <span style=${{ color, fontSize: '12px', lineHeight: 1 }}>●</span>
                <span style=${{ fontSize: '13px', fontWeight: active ? 700 : 600, color: active ? 'var(--gold-600)' : 'var(--text-primary)' }}>${s.name}</span>
              </div>
              ${s.quarry && html`<div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>${s.quarry}</div>`}
              <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '5px' }}>
                ${m.lev != null ? m.lev.toFixed(2) + ' м' : '—'} · ${m.pct != null ? m.pct.toFixed(0) + '%' : '—'} · Q ${m.q != null ? m.q.toFixed(0) + ' м³/ч' : '—'}
              </div>
              ${m.pct != null && html`
                <div style=${{ height: '3px', background: 'var(--border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style=${{ height: '100%', width: Math.min(100, Math.max(0, m.pct)) + '%', background: color, borderRadius: '2px' }} />
                </div>
              `}
              ${!m.hasCurve && html`<div style=${{ fontSize: '9.5px', color: 'var(--text-tertiary)', marginTop: '4px', fontStyle: 'italic' }}>нет модели V(H)</div>`}
            </div>
          `;
        })}
      </div>
    <//>
  `;
}

function PeriodBar({ days, setDays, customFrom, setCustomFrom, customTo, setCustomTo }) {
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', marginRight: '2px' }}>Период анализа:</span>
      ${PERIODS.map((p) => html`
        <${Button} key=${p.d} size="sm" variant=${days === p.d ? 'outline' : 'ghost'} onClick=${() => setDays(p.d)}>${p.label}<//>
      `)}
      <${Button} size="sm" variant=${days === 0 ? 'outline' : 'ghost'} onClick=${() => setDays(0)}>Период<//>
      ${days === 0 && html`
        <span style=${{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          с <${Input} type="date" value=${customFrom} onChange=${(e) => setCustomFrom(e.target.value)} style=${{ width: '135px', fontSize: '11px', padding: '3px 6px' }} />
          по <${Input} type="date" value=${customTo} onChange=${(e) => setCustomTo(e.target.value)} style=${{ width: '135px', fontSize: '11px', padding: '3px 6px' }} />
        </span>
      `}
    </div>
  `;
}

// ── Вкладка «Обзор» ───────────────────────────────────────────────────────────
function OverviewTab({ sump, hasCurve, curve, curveVersions, latestLev, currVol, pct, levels, readings, pumps, days, dateFrom, dateTo, onReload, onGeomLoaded }) {
  const [status, setStatus] = useState('');
  const [statusErr, setStatusErr] = useState(false);
  const [validFrom, setValidFrom] = useState(today());
  const [critDraft, setCritDraft] = useState(sump.critical_level != null ? String(sump.critical_level) : '');
  const [savingCrit, setSavingCrit] = useState(false);
  useEffect(() => { setCritDraft(sump.critical_level != null ? String(sump.critical_level) : ''); }, [sump.id, sump.critical_level]);

  const myVersions = curveVersions.filter((v) => v.sumpId === sump.id).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));

  async function onFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setStatusErr(false);
    try {
      const res = await handleTridbUpload({ file, sump, validFrom, onStatus: setStatus });
      onGeomLoaded(res.geom);
      if (res.verifyWarning) { setStatus('⚠ ' + res.verifyWarning); setStatusErr(true); }
      await onReload();
    } catch (e2) { setStatus('Ошибка: ' + e2.message); setStatusErr(true); }
  }

  async function saveCrit() {
    const v = critDraft === '' ? null : parseFloat(critDraft);
    if (critDraft !== '' && isNaN(v)) return;
    setSavingCrit(true);
    try { await saveCriticalLevel(sump.id, v); await onReload(); } finally { setSavingCrit(false); }
  }

  async function removeVersion(id) { await deleteCurveVersion(id); await onReload(); }

  const curveMax = sump.volume_curve && sump.volume_curve.length ? sump.volume_curve[sump.volume_curve.length - 1].v : null;
  const verifyOk = curveMax != null && sump.total_volume ? Math.abs(curveMax - sump.total_volume) / sump.total_volume < 0.10 : null;

  const lpData = useMemo(() => {
    const levs = levels.filter((l) => l.sumpId === sump.id && l.date >= dateFrom && l.elevation != null).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const pumpIds = pumps.filter((p) => p.sumpId === sump.id).map((p) => p.id);
    const byDate = {};
    readings.forEach((r) => { if (!pumpIds.includes(r.pumpId) || r.date < dateFrom) return; byDate[r.date] = (byDate[r.date] || 0) + (computedVolume(readings, r) || 0); });
    const dateSet = new Set([...levs.map((l) => l.date), ...Object.keys(byDate)]);
    return Array.from(dateSet).sort().map((d) => {
      const lv = levs.filter((l) => l.date === d).slice(-1)[0];
      return { date: d.slice(5), Уровень: lv ? lv.elevation : null, Откачка: byDate[d] || 0 };
    });
  }, [levels, readings, pumps, sump.id, dateFrom]);

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: '14px', alignItems: 'start' }}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
        <${Card}>
          <${CardHeader}>
            <${CardTitle}>Модель зумпфа<//>
          <//>
          <${CardContent}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <label style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Действует с</label>
              <${Input} type="date" value=${validFrom} onChange=${(e) => setValidFrom(e.target.value)} style=${{ width: '135px', fontSize: '11px', padding: '3px 6px' }} />
              <label class="btn btn-outline btn-sm" style=${{ cursor: 'pointer', marginLeft: 'auto' }}>
                <input type="file" accept=".tridb" style=${{ display: 'none' }} onChange=${onFile} />
                <${Upload} size=${13} /> ${hasCurve ? 'Обновить .tridb' : 'Загрузить .tridb'}
              <//>
            </div>

            ${hasCurve ? html`
              <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <${Stat} label="Полный объём" value=${sump.total_volume ? fmt(sump.total_volume) + ' м³' : '—'} />
                <${Stat} label="Диапазон Z" value=${sump.z_min != null ? sump.z_min.toFixed(1) + '–' + sump.z_max.toFixed(1) + ' м' : '—'} />
                ${latestLev != null && html`<${Stat} label="Тек. отметка" value=${latestLev.toFixed(2) + ' м'} />`}
                ${currVol != null && html`<${Stat} label="Объём воды" value=${fmt(currVol) + ' м³'} />`}
              </div>
              ${verifyOk === false && html`
                <div style=${{ background: 'var(--red-50)', border: '1px solid var(--red-400)', borderRadius: '6px', padding: '8px 10px', fontSize: '11px', color: 'var(--red-600)', marginBottom: '10px' }}>
                  ⚠ Расчётный объём при Z<sub>max</sub> (${fmt(curveMax)} м³) заметно отличается от паспортного (${fmt(sump.total_volume)} м³) — возможны дефекты меша.
                </div>
              `}
              ${pct != null && pct <= 110 && html`
                <div style=${{ marginBottom: '10px' }}>
                  <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                    <span>Заполнение</span><span style=${{ fontWeight: 600 }}>${pct.toFixed(1)}%</span>
                  </div>
                  <div style=${{ background: 'var(--border-subtle)', borderRadius: '4px', height: '8px' }}>
                    <div style=${{ background: pct > 80 ? 'var(--red-500)' : pct > 60 ? 'var(--amber-500)' : 'var(--green-500)', borderRadius: '4px', height: '8px', width: Math.min(100, pct) + '%' }} />
                  </div>
                </div>
              `}
            ` : html`<p style=${{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Файл .tridb не загружен — объёмная модель недоступна.</p>`}

            <${Field} label="Критический уровень, м">
              <div style=${{ display: 'flex', gap: '6px' }}>
                <${Input} type="number" step="0.1" value=${critDraft} onChange=${(e) => setCritDraft(e.target.value)} placeholder="не задан" style=${{ flex: 1 }} />
                <${Button} size="sm" variant="outline" onClick=${saveCrit} disabled=${savingCrit}>Сохранить<//>
              </div>
            <//>

            ${status && html`<div style=${{ fontSize: '11px', marginTop: '8px', color: statusErr ? 'var(--red-600)' : 'var(--text-secondary)' }}>${status}</div>`}

            ${myVersions.length > 0 && html`
              <div style=${{ marginTop: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}><${History} size=${11} /> История версий модели</div>
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  ${myVersions.map((v) => html`
                    <div key=${v.id} style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', gap: '6px' }}>
                      <span style=${{ color: 'var(--text-tertiary)' }}>с ${v.validFrom}</span>
                      <span>${v.totalVolume ? fmt(v.totalVolume) + ' м³' : '—'}</span>
                      <${Button} variant="ghost" size="sm" icon onClick=${() => removeVersion(v.id)}><${Trash2} size=${12} style=${{ color: 'var(--red-500)' }} /><//>
                    </div>
                  `)}
                </div>
              </div>
            `}
          <//>
        <//>
      </div>

      <${Card}>
        <${CardHeader}><${CardTitle} subtitle=${'за ' + (days === 1 ? '1 сутки' : days === 0 ? 'выбранный период' : days + ' дн.')}>История уровня и водоотлива<//><//>
        <${CardContent}>
          ${lpData.length === 0 ? html`<${EmptyState} icon=${html`<${TrendingUp} size=${32} />`} title="Нет данных" description="Нет замеров уровня за выбранный период" />` : html`
            <div style=${{ width: '100%', height: '300px' }}>
              <${ResponsiveContainer}>
                <${ComposedChart} data=${lpData} margin=${{ left: -10, right: 10, top: 4, bottom: 0 }}>
                  <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                  <${XAxis} dataKey="date" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} minTickGap=${24} />
                  <${YAxis} yAxisId="lev" domain=${['auto', 'auto']} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${42} />
                  <${YAxis} yAxisId="vol" orientation="right" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${42} />
                  <${Tooltip} contentStyle=${{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)' }} />
                  <${Legend} wrapperStyle=${{ fontSize: 11 }} />
                  ${sump.critical_level != null && html`<${ReferenceLine} yAxisId="lev" y=${sump.critical_level} stroke="var(--red-400)" strokeDasharray="4 3" label=${{ value: 'крит.', fontSize: 10, fill: 'var(--red-500)' }} />`}
                  <${Bar} yAxisId="vol" dataKey="Откачка" fill="var(--green-500)" radius=${[3, 3, 0, 0]} name="Откачка, м³/сут" />
                  <${Line} yAxisId="lev" type="monotone" dataKey="Уровень" stroke="var(--gold-500)" strokeWidth=${2} dot=${false} name="Уровень, м" connectNulls />
                <//>
              <//>
            </div>
          `}
        <//>
      <//>
    </div>
  `;
}

function Stat({ label, value }) {
  return html`
    <div style=${{ background: 'var(--bg-surface-2)', borderRadius: '6px', padding: '8px' }}>
      <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>${label}</div>
      <div style=${{ fontSize: '14px', fontWeight: 600 }}>${value}</div>
    </div>
  `;
}

// ── Вкладка «Приток и насосы» ─────────────────────────────────────────────────
function InflowTab({ sump, hasCurve, curve, inflow, calcAvgQ, manualQ, onManualQ, pumpsPerf, dateFrom, dateTo }) {
  const isManual = manualQ !== undefined && manualQ !== null && !isNaN(manualQ);
  const vhData = curve ? curve.filter((_, i) => i % 3 === 0).map((p) => ({ h: p.h.toFixed(1), v: Math.round(p.v) })) : [];
  const inflowChartData = inflow.map((r) => ({ date: r.date.slice(5), Q: r.q }));

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px', alignItems: 'start' }}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
        <${Card}>
          <${CardHeader}>
            <${CardTitle}>Водоприток<//>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <${Input} type="number" min="0" step="0.1" placeholder=${calcAvgQ != null ? calcAvgQ.toFixed(1) : '—'} value=${isManual ? manualQ : ''} onChange=${(e) => onManualQ(e.target.value === '' ? null : parseFloat(e.target.value))} style=${{ width: '90px', fontSize: '12px', fontWeight: 700, borderColor: isManual ? 'var(--gold-500)' : undefined }} title="Q приток вручную, м³/ч" />
              ${isManual && html`<${Button} size="sm" variant="ghost" onClick=${() => onManualQ(null)}>авто<//>`}
            </div>
          <//>
          <${CardContent}>
            <div style=${{ background: 'var(--bg-surface-2)', borderRadius: '6px', padding: '8px 10px', marginBottom: '10px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
              Q<sub>приток</sub> = (V<sub>откачано</sub> + ΔV<sub>зумпф</sub>) / часы, усреднено по парам замеров уровня за период
            </div>
            ${!hasCurve ? html`<p style=${{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Загрузите .tridb на вкладке «Обзор» для расчёта</p>`
              : inflow.length < 2 ? html`<p style=${{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Недостаточно пар замеров за выбранный период</p>` : html`
              <div style=${{ width: '100%', height: '160px' }}>
                <${ResponsiveContainer}>
                  <${BarChart} data=${inflowChartData} margin=${{ left: -14, right: 8, top: 4, bottom: 0 }}>
                    <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                    <${XAxis} dataKey="date" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} minTickGap=${24} />
                    <${YAxis} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${34} />
                    <${Tooltip} contentStyle=${{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v) => [v + ' м³/ч', 'Приток']} />
                    <${Bar} dataKey="Q" fill="var(--gold-400)" radius=${[4, 4, 0, 0]} />
                  <//>
                <//>
              </div>
              <details style=${{ marginTop: '10px' }}>
                <summary style=${{ fontSize: '10px', color: 'var(--text-tertiary)', cursor: 'pointer' }}>Сырые данные расчёта</summary>
                <div style=${{ overflowX: 'auto', marginTop: '6px' }}>
                  <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                    <thead><tr style=${{ background: 'var(--bg-surface-2)' }}>
                      <th style=${{ padding: '4px 6px', textAlign: 'left' }}>Дата</th><th style=${{ padding: '4px 6px', textAlign: 'right' }}>H1</th><th style=${{ padding: '4px 6px', textAlign: 'right' }}>H2</th>
                      <th style=${{ padding: '4px 6px', textAlign: 'right' }}>ΔV</th><th style=${{ padding: '4px 6px', textAlign: 'right' }}>Откачано</th><th style=${{ padding: '4px 6px', textAlign: 'right' }}>Q</th>
                    </tr></thead>
                    <tbody>
                      ${inflow.slice().reverse().map((r, i) => html`
                        <tr key=${i} style=${{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style=${{ padding: '3px 6px' }}>${r.date}</td>
                          <td style=${{ padding: '3px 6px', textAlign: 'right' }}>${r.h1 != null ? r.h1.toFixed(2) : '—'}</td>
                          <td style=${{ padding: '3px 6px', textAlign: 'right' }}>${r.h2 != null ? r.h2.toFixed(2) : '—'}</td>
                          <td style=${{ padding: '3px 6px', textAlign: 'right', color: r.dv < 0 ? 'var(--blue-500)' : 'var(--amber-500)' }}>${r.dv}</td>
                          <td style=${{ padding: '3px 6px', textAlign: 'right' }}>${r.vpumped}</td>
                          <td style=${{ padding: '3px 6px', textAlign: 'right', fontWeight: 600, color: r.qRaw < 0 ? 'var(--red-500)' : 'var(--gold-600)' }}>${r.q.toFixed(1)}</td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>
              </details>
            `}
          <//>
        <//>

        ${hasCurve && html`
          <${Card}>
            <${CardHeader}><${CardTitle} subtitle="объём от отметки">Кривая V(H)<//><//>
            <${CardContent}>
              <div style=${{ width: '100%', height: '180px' }}>
                <${ResponsiveContainer}>
                  <${LineChart} data=${vhData} margin=${{ left: -6, right: 10, top: 4, bottom: 0 }}>
                    <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                    <${XAxis} dataKey="h" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} minTickGap=${30} />
                    <${YAxis} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${46} />
                    <${Tooltip} contentStyle=${{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v) => [fmt(v) + ' м³', 'Объём']} labelFormatter=${(h) => 'H = ' + h + ' м'} />
                    <${Line} type="monotone" dataKey="v" stroke="var(--gold-500)" strokeWidth=${2} dot=${false} />
                  <//>
                <//>
              </div>
            <//>
          <//>
        `}
      </div>

      <${Card}>
        <${CardHeader}><${CardTitle} subtitle=${'за ' + dateFrom + ' — ' + dateTo}>Насосы<//><//>
        <${CardContent}>
          ${pumpsPerf.length === 0 ? html`<p style=${{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Насосы не привязаны</p>` : html`
            <table style=${{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead><tr style=${{ color: 'var(--text-tertiary)', fontSize: '10px' }}><th style=${{ textAlign: 'left', padding: '0 4px 6px 0' }}>Насос</th><th style=${{ textAlign: 'right' }}>Q, м³/ч</th><th style=${{ textAlign: 'right' }}>Часы</th></tr></thead>
              <tbody>
                ${pumpsPerf.map((p) => html`
                  <tr key=${p.id} style=${{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style=${{ padding: '6px 4px 6px 0' }}>
                      <span style=${{ color: p.totalH > 0 ? 'var(--green-500)' : 'var(--text-tertiary)', marginRight: '4px' }}>●</span>${p.name}
                      ${p.model && html`<div style=${{ fontSize: '10px', color: 'var(--text-tertiary)' }}>${p.model}</div>`}
                    </td>
                    <td style=${{ textAlign: 'right', fontWeight: 600 }}>${p.q > 0 ? p.q.toFixed(0) : '—'}</td>
                    <td style=${{ textAlign: 'right', color: 'var(--text-tertiary)' }}>${p.totalH > 0 ? p.totalH : '—'}</td>
                  </tr>
                `)}
              </tbody>
            </table>
            <div style=${{ borderTop: '1px solid var(--border-subtle)', marginTop: '8px', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style=${{ color: 'var(--text-tertiary)' }}>Суммарно:</span><span style=${{ fontWeight: 700 }}>${pumpsPerf.reduce((s, p) => s + p.q, 0).toFixed(0)} м³/ч</span>
            </div>
          `}
        <//>
      <//>
    </div>
  `;
}

// ── Вкладка «Прогноз» — часовой имитатор баланса ──────────────────────────────
function ForecastTab({ sump, hasCurve, curve, avgQ, latestLev, pumpsPerf }) {
  const [params, setParams] = useState(null);

  useEffect(() => {
    if (!pumpsPerf.length && !hasCurve) return;
    const now = new Date();
    const end = new Date(now.getTime() + 7 * 86400000);
    const pumpQ = {};
    pumpsPerf.forEach((p) => { pumpQ[p.id] = p.q; });
    setParams({ startDt: dtLocal(now), endDt: dtLocal(end), pumpQ, stops: [] });
    // eslint-disable-next-line
  }, [sump.id, hasCurve]);

  // Хуки должны вызываться безусловно на каждый рендер — useMemo до ранних return.
  const result = useMemo(() => {
    if (!hasCurve || !params || avgQ == null) return [];
    return simulateForecast({ curve, totalVolume: sump.total_volume, zMin: sump.z_min, pumps: pumpsPerf, forecastParams: params, avgQin: avgQ, H0: latestLev });
  }, [hasCurve, curve, sump.total_volume, sump.z_min, pumpsPerf, params, avgQ, latestLev]);

  if (!hasCurve) return html`<${Card}><${CardContent}><${EmptyState} icon=${html`<${TrendingUp} size=${32} />`} title="Прогноз недоступен" description="Загрузите .tridb на вкладке «Обзор», чтобы включить объёмную модель" /><//><//>`;
  if (!params || avgQ == null) return html`<${Card}><${CardContent}><p style=${{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Недостаточно данных о притоке для расчёта прогноза</p><//><//>`;

  const chartData = result.map((r) => ({ t: r.t, time: new Date(r.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), Уровень: r.H, Откачка: r.Qpump }));

  const critHit = sump.critical_level != null ? result.find((r) => r.H >= sump.critical_level) : null;
  const Hstart = result.length ? result[0].H : null, Hend = result.length ? result[result.length - 1].H : null;
  const Hmin = result.reduce((m, r) => Math.min(m, r.H), Hstart ?? 0), Hmax = result.reduce((m, r) => Math.max(m, r.H), Hstart ?? 0);
  const totalPumped = result.reduce((s, r) => s + r.Qpump, 0);

  function addStop() {
    const firstPump = pumpsPerf[0];
    setParams((p) => ({ ...p, stops: [...p.stops, { pumpId: firstPump ? firstPump.id : '', startDt: p.startDt, durationH: 8 }] }));
  }
  function removeStop(i) { setParams((p) => ({ ...p, stops: p.stops.filter((_, idx) => idx !== i) })); }
  function setStop(i, key, val) { setParams((p) => ({ ...p, stops: p.stops.map((s, idx) => idx === i ? { ...s, [key]: key === 'durationH' ? (parseFloat(val) || 0) : val } : s) })); }

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: '14px', alignItems: 'start' }}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
        <${Card}>
          <${CardHeader}><${CardTitle}>Период прогноза<//><//>
          <${CardContent}>
            <${Field} label="Начало">
              <${Input} type="datetime-local" value=${params.startDt} onChange=${(e) => setParams((p) => ({ ...p, startDt: e.target.value }))} />
            <//>
            <${Field} label="Конец">
              <${Input} type="datetime-local" value=${params.endDt} onChange=${(e) => setParams((p) => ({ ...p, endDt: e.target.value }))} />
            <//>
            <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Приток принят ${avgQ.toFixed(1)} м³/ч (см. вкладку «Приток и насосы»)</div>
          <//>
        <//>

        <${Card}>
          <${CardHeader}><${CardTitle}>Насосы, м³/ч<//><//>
          <${CardContent}>
            ${pumpsPerf.length === 0 ? html`<p style=${{ color: 'var(--text-tertiary)', fontSize: '12px' }}>Насосы не привязаны</p>` : pumpsPerf.map((p) => html`
              <div key=${p.id} style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                <span style=${{ fontSize: '12px' }}>${p.name}</span>
                <${Input} type="number" min="0" step="0.1" value=${params.pumpQ[p.id] ?? p.q} onChange=${(e) => setParams((pr) => ({ ...pr, pumpQ: { ...pr.pumpQ, [p.id]: parseFloat(e.target.value) || 0 } }))} style=${{ width: '80px', fontSize: '12px' }} />
              </div>
            `)}
          <//>
        <//>

        <${Card}>
          <${CardHeader}>
            <${CardTitle}>Плановые остановки<//>
            <${Button} size="sm" variant="ghost" onClick=${addStop} disabled=${!pumpsPerf.length}><${Plus} size=${13} /> Добавить<//>
          <//>
          <${CardContent}>
            ${!params.stops.length ? html`<p style=${{ color: 'var(--text-tertiary)', fontSize: '12px', textAlign: 'center', opacity: .7 }}>Нет остановок</p>` : params.stops.map((s, i) => html`
              <div key=${i} style=${{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px', marginBottom: '6px' }}>
                <div style=${{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  <${Select} value=${s.pumpId} onChange=${(e) => setStop(i, 'pumpId', e.target.value)} style=${{ flex: 1, fontSize: '11px' }}>
                    ${pumpsPerf.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}<//>`)}
                  <//>
                  <${Button} variant="ghost" size="sm" icon onClick=${() => removeStop(i)}><${Trash2} size=${12} style=${{ color: 'var(--red-500)' }} /><//>
                </div>
                <div style=${{ display: 'flex', gap: '6px' }}>
                  <${Input} type="datetime-local" value=${s.startDt} onChange=${(e) => setStop(i, 'startDt', e.target.value)} style=${{ flex: 1, fontSize: '11px' }} />
                  <${Input} type="number" min="0" step="1" value=${s.durationH} onChange=${(e) => setStop(i, 'durationH', e.target.value)} style=${{ width: '60px', fontSize: '11px' }} title="Часов" />
                </div>
              </div>
            `)}
          <//>
        <//>
      </div>

      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
        ${critHit ? html`
          <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: 'var(--red-50)', border: '1px solid var(--red-400)', color: 'var(--red-600)', fontSize: '13px', fontWeight: 600 }}>
            <${AlertTriangle} size=${16} /> Критический уровень (${sump.critical_level.toFixed(2)} м) будет достигнут: ${new Date(critHit.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </div>
        ` : sump.critical_level != null && html`
          <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: 'var(--green-100)', border: '1px solid var(--green-500)', color: 'var(--green-600)', fontSize: '13px', fontWeight: 600 }}>
            <${CheckCircle2} size=${16} /> Критический уровень не будет достигнут в период прогноза
          </div>
        `}

        <${Card}>
          <${CardContent}>
            <div style=${{ width: '100%', height: '340px' }}>
              <${ResponsiveContainer}>
                <${ComposedChart} data=${chartData} margin=${{ left: -10, right: 10, top: 4, bottom: 0 }}>
                  <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                  <${XAxis} dataKey="time" tick=${{ fontSize: 9, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} minTickGap=${40} />
                  <${YAxis} yAxisId="lev" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${42} />
                  <${YAxis} yAxisId="pump" orientation="right" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${42} />
                  <${Tooltip} contentStyle=${{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)' }} />
                  <${Legend} wrapperStyle=${{ fontSize: 11 }} />
                  ${sump.critical_level != null && html`<${ReferenceLine} yAxisId="lev" y=${sump.critical_level} stroke="var(--red-400)" strokeDasharray="4 3" label=${{ value: 'крит.', fontSize: 10, fill: 'var(--red-500)' }} />`}
                  ${params.stops.map((s, i) => {
                    const sMs = new Date(s.startDt).getTime(), eMs = sMs + s.durationH * 3600000;
                    const s1 = chartData.find((r) => r.t >= sMs), s2 = chartData.slice().reverse().find((r) => r.t <= eMs);
                    if (!s1 || !s2) return null;
                    return html`<${ReferenceArea} key=${i} yAxisId="lev" x1=${s1.time} x2=${s2.time} fill="var(--amber-500)" fillOpacity=${0.08} />`;
                  })}
                  <${Area} yAxisId="pump" type="stepAfter" dataKey="Откачка" stroke="var(--green-500)" fill="var(--green-500)" fillOpacity=${0.35} name="Откачка, м³/ч" />
                  <${Line} yAxisId="lev" type="monotone" dataKey="Уровень" stroke="var(--gold-500)" strokeWidth=${2} dot=${false} name="Уровень, м" />
                <//>
              <//>
            </div>
          <//>
        <//>

        <div class="grid grid-3">
          <${Stat} label="Уровень начало → конец" value=${Hstart != null ? Hstart.toFixed(2) + ' → ' + Hend.toFixed(2) + ' м' : '—'} />
          <${Stat} label="Мин / макс уровень" value=${result.length ? Hmin.toFixed(2) + ' / ' + Hmax.toFixed(2) + ' м' : '—'} />
          <${Stat} label="Откачано всего" value=${fmt(totalPumped) + ' м³'} />
        </div>
      </div>
    </div>
  `;
}

// ── Вкладка «3D-модель» ────────────────────────────────────────────────────────
function Model3DTab({ sump, hasCurve, latestLev, geomCache }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const [status, setStatus] = useState(hasCurve ? 'Загрузка модели...' : '');

  useEffect(() => {
    let cancelled = false;
    if (!hasCurve || !containerRef.current) return;

    async function mount() {
      let geom = geomCache.current[sump.id];
      if (!geom && sump.tridb_path) {
        try { geom = await fetchTridbGeometry(sump.tridb_path); geomCache.current[sump.id] = geom; }
        catch (e) { if (!cancelled) setStatus('Не удалось загрузить 3D-модель: ' + e.message); return; }
      }
      if (!geom || cancelled) return;
      setStatus('');
      const scene = new SumpScene(containerRef.current);
      sceneRef.current = scene;
      await scene.init({ ...geom, zMin: sump.z_min, zMax: sump.z_max }, latestLev);
    }
    mount();

    return () => { cancelled = true; if (sceneRef.current) { sceneRef.current.dispose(); sceneRef.current = null; } };
  }, [sump.id, hasCurve]);

  if (!hasCurve) return html`<${Card}><${CardContent}><${EmptyState} icon=${html`<${Box} size=${32} />`} title="Модель недоступна" description="Загрузите .tridb на вкладке «Обзор»" /><//><//>`;

  return html`
    <${Card} style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span class="card-title">3D-модель зумпфа</span>
        ${latestLev != null && html`<span style=${{ fontSize: '11px', color: 'var(--gold-600)', fontWeight: 600 }}>▲ ${latestLev.toFixed(2)} м</span>`}
      </div>
      <div style=${{ position: 'relative', width: '100%', height: '520px', background: '#0d1117' }}>
        <div ref=${containerRef} style=${{ position: 'absolute', inset: 0 }} />
        ${status && html`<p style=${{ position: 'absolute', inset: 0, margin: 0, color: '#9ca3af', fontSize: '12px', padding: '20px', textAlign: 'center' }}>${status}</p>`}
      </div>
      <div style=${{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-tertiary)', textAlign: 'center' }}>ЛКМ — вращение · Колёсико — масштаб · ПКМ — панорама</div>
    <//>
  `;
}
