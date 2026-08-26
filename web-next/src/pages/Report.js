import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { POINT_STATUSES } from '../lib/point-status.js';
import { Button, Card, CardContent, Input, Select, Table } from '../components/ui.js';

const COLUMNS = ['point_number', 'monitoring_date', 'worker', 'status', 'intensity', 'flow_rate', 'domain', 'wall', 'comment'];
const HEADERS = ['№ точки', 'Дата', 'Сотрудник', 'Статус', 'Интенсивность', 'Дебит, м³/ч', 'Домен', 'Борт', 'Комментарий'];

function toCsv(rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [HEADERS.join(';')];
  rows.forEach((r) => lines.push(COLUMNS.map((c) => esc(r[c])).join(';')));
  return '﻿' + lines.join('\r\n'); // BOM — чтобы Excel корректно читал кириллицу
}

export function ReportPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from('points').select(COLUMNS.join(',')).order('monitoring_date', { ascending: false }).limit(1000);
      if (dateFrom) q = q.gte('monitoring_date', dateFrom);
      if (dateTo) q = q.lte('monitoring_date', dateTo);
      if (status) q = q.eq('status', status);
      const { data } = await q;
      setRows(data || []);
    })();
  }, [dateFrom, dateTo, status]);

  function download() {
    const csv = toCsv(rows || []);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${dateFrom || 'all'}_${dateTo || 'all'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const columns = useMemo(() => [
    { key: 'point_number', header: '№' },
    { key: 'monitoring_date', header: 'Дата' },
    { key: 'worker', header: 'Сотрудник' },
    { key: 'status', header: 'Статус' },
    { key: 'flow_rate', header: 'Дебит', render: (r) => r.flow_rate != null ? Number(r.flow_rate).toFixed(2) : '—' },
    { key: 'domain', header: 'Домен' },
  ], []);

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Отчёт</div>
          <div class="page-desc">Выгрузка записей мониторинга за период в CSV (Excel).</div>
        </div>
        <${Button} onClick=${download} disabled=${!rows || !rows.length}><${Download} size=${16} /> Скачать CSV (${rows ? rows.length : 0})<//>
      </div>

      <${Card}>
        <div style=${{ display: 'flex', gap: '10px', padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', alignItems: 'end' }}>
          <div><label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>С</label><${Input} type="date" value=${dateFrom} onChange=${(e) => setDateFrom(e.target.value)} style=${{ width: '150px' }} /></div>
          <div><label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>По</label><${Input} type="date" value=${dateTo} onChange=${(e) => setDateTo(e.target.value)} style=${{ width: '150px' }} /></div>
          <div>
            <label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Статус</label>
            <${Select} value=${status} onChange=${(e) => setStatus(e.target.value)} style=${{ width: '160px' }}>
              <option value="">Все</option>
              ${Object.keys(POINT_STATUSES).map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          </div>
        </div>
        <${CardContent} tight>
          <${Table}
            columns=${columns}
            rows=${(rows || []).slice(0, 100)}
            rowKey=${(r) => r.point_number + '_' + r.monitoring_date}
            loading=${rows === null}
            emptyIcon=${html`<${FileText} size=${40} />`}
            emptyTitle="Нет записей за выбранный период"
          />
          ${rows && rows.length > 100 && html`<div style=${{ padding: '10px 16px', fontSize: '12px', color: 'var(--text-tertiary)' }}>Показаны первые 100 из ${rows.length} — в CSV попадут все.</div>`}
        <//>
      <//>
    </div>
  `;
}
