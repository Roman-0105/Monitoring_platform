import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Plus, AlertTriangle } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { CHEM_PARAMS, CHEM_PARAM_MAP, CORE_PARAM_KEYS, pdkStatus, pdkStr } from '../lib/chem-params.js';
import { Button, Card, CardContent, Select, Table, Badge, Dialog, Field, Input, Skeleton } from '../components/ui.js';

const STATUS_BADGE = { ok: 'success', exceed: 'danger', no_norm: 'default', nd: 'default' };
const STATUS_LABEL = { ok: 'В норме', exceed: 'Превышение', no_norm: 'Без норматива', nd: '—' };

function genId() { return 'cp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function ChemPage() {
  const [protocols, setProtocols] = useState(null);
  const [resultsByProtocol, setResultsByProtocol] = useState({});
  const [wpNames, setWpNames] = useState({});
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ water_point_id: '', sampled_at: '', lab_name: '' });
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [wpOptions, setWpOptions] = useState([]);

  async function load() {
    setError(null);
    const [protoR, resR, wpR] = await Promise.all([
      supabase.from('chem_protocols').select('*').order('sampled_at', { ascending: false }).limit(300),
      supabase.from('chem_results').select('*'),
      supabase.from('wp_registry').select('id, name, code'),
    ]);
    if (protoR.error) { setError(protoR.error.message); return; }
    setProtocols(protoR.data || []);
    const byProto = {};
    (resR.data || []).forEach((r) => { if (!byProto[r.protocol_id]) byProto[r.protocol_id] = []; byProto[r.protocol_id].push(r); });
    setResultsByProtocol(byProto);
    const names = {};
    (wpR.data || []).forEach((w) => { names[w.id] = w.name || w.code; });
    setWpNames(names);
    setWpOptions(wpR.data || []);
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!protocols) return [];
    return protocols.map((p) => {
      const results = resultsByProtocol[p.id] || [];
      const exceedCount = results.filter((r) => pdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed').length;
      return { ...p, wpName: wpNames[p.water_point_id] || p.water_point_id, resultsCount: results.length, exceedCount };
    });
  }, [protocols, resultsByProtocol, wpNames]);

  function openDetail(row) { setDetail(row); }

  function openAdd() { setForm({ water_point_id: '', sampled_at: new Date().toISOString().slice(0, 10), lab_name: '' }); setValues({}); setAddOpen(true); }

  async function save() {
    if (!form.water_point_id || !form.sampled_at) return;
    setSaving(true);
    const id = genId();
    const { error: err } = await supabase.from('chem_protocols').insert({ id, water_point_id: form.water_point_id, sampled_at: form.sampled_at, lab_name: form.lab_name });
    if (err) { setError(err.message); setSaving(false); return; }
    const resultRows = Object.entries(values).filter(([, v]) => v !== '' && v != null).map(([param_key, value_raw]) => ({
      id: genId() + '_' + param_key, protocol_id: id, param_key, value_raw: String(value_raw), value_num: parseFloat(String(value_raw).replace(',', '.').replace(/^[<>]/, '')) || null, below_detection: String(value_raw).trim().charAt(0) === '<',
    }));
    if (resultRows.length) await supabase.from('chem_results').insert(resultRows);
    setSaving(false);
    setAddOpen(false);
    load();
  }

  const columns = [
    { key: 'date', header: 'Дата', width: '110px', render: (p) => html`<span class="mono">${p.sampled_at}</span>` },
    { key: 'wp', header: 'Водопункт', render: (p) => html`<span style=${{ fontWeight: 600 }}>${p.wpName}</span>` },
    { key: 'lab', header: 'Лаборатория', render: (p) => p.lab_name || '—' },
    { key: 'count', header: 'Показателей', width: '110px', render: (p) => p.resultsCount },
    {
      key: 'status', header: 'Статус', width: '150px',
      render: (p) => p.exceedCount > 0
        ? html`<${Badge} variant="danger"><${AlertTriangle} size=${11} /> ${p.exceedCount} превышений<//>`
        : html`<${Badge} variant="success">В норме<//>`,
    },
  ];

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Хим. мониторинг</div>
          <div class="page-desc">Протоколы химического анализа воды — ${protocols ? protocols.length : '…'} записей. ПДК — по СанПиН (питьевая вода).</div>
        </div>
        <${Button} onClick=${openAdd}><${Plus} size=${16} /> Новый протокол<//>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${error}</div>`}

      <${Card}>
        <${CardContent} tight>
          <${Table}
            columns=${columns}
            rows=${rows}
            rowKey=${(p) => p.id}
            loading=${protocols === null}
            onRowClick=${openDetail}
            emptyIcon=${html`<${FlaskConical} size=${40} />`}
            emptyTitle="Протоколов нет"
          />
        <//>
      <//>
      ${rows.length > 0 && html`<div style=${{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '8px' }}>Кликните строку, чтобы посмотреть результаты.</div>`}

      <${Dialog} open=${!!detail} onClose=${() => setDetail(null)} title=${detail ? `Протокол — ${detail.wpName} (${detail.sampled_at})` : ''} width="640px">
        ${detail && html`
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Показатель</th><th>Значение</th><th>ПДК</th><th>Статус</th></tr></thead>
              <tbody>
                ${(resultsByProtocol[detail.id] || []).sort((a, b) => (CHEM_PARAM_MAP[a.param_key]?.no || 99) - (CHEM_PARAM_MAP[b.param_key]?.no || 99)).map((r) => {
                  const p = CHEM_PARAM_MAP[r.param_key];
                  const st = pdkStatus(r.param_key, r.value_raw, r.below_detection);
                  return html`
                    <tr key=${r.id}>
                      <td>${p ? p.name : r.param_key}</td>
                      <td class="mono">${r.value_raw}${p ? ' ' + p.unit : ''}</td>
                      <td class="mono" style=${{ color: 'var(--text-tertiary)' }}>${p ? pdkStr(p) : '—'}</td>
                      <td><${Badge} variant=${STATUS_BADGE[st]}>${STATUS_LABEL[st]}<//></td>
                    </tr>
                  `;
                })}
                ${!(resultsByProtocol[detail.id] || []).length && html`<tr><td colspan="4" style=${{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '16px' }}>Нет результатов</td></tr>`}
              </tbody>
            </table>
          </div>
        `}
      <//>

      <${Dialog}
        open=${addOpen}
        onClose=${() => setAddOpen(false)}
        title="Новый протокол анализа"
        width="640px"
        footer=${html`
          <${Button} variant="outline" onClick=${() => setAddOpen(false)}>Отмена<//>
          <${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
        `}
      >
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px' }}>
            <${Field} label="Водопункт *">
              <${Select} value=${form.water_point_id} onChange=${(e) => setForm({ ...form, water_point_id: e.target.value })}>
                <option value="">— выберите —</option>
                ${wpOptions.map((w) => html`<option key=${w.id} value=${w.id}>${w.name || w.code}<//>`)}
              <//>
            <//>
            <${Field} label="Дата отбора *"><${Input} type="date" value=${form.sampled_at} onChange=${(e) => setForm({ ...form, sampled_at: e.target.value })} /><//>
            <${Field} label="Лаборатория"><${Input} value=${form.lab_name} onChange=${(e) => setForm({ ...form, lab_name: e.target.value })} /><//>
          </div>
          <div style=${{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: '4px' }}>Ключевые показатели</div>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
            ${CORE_PARAM_KEYS.map((key) => {
              const p = CHEM_PARAM_MAP[key];
              return html`
                <${Field} label=${p.name + ' (' + p.unit + ')'}>
                  <${Input} value=${values[key] || ''} onChange=${(e) => setValues({ ...values, [key]: e.target.value })} placeholder=${pdkStr(p)} />
                <//>
              `;
            })}
          </div>
          <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Остальные ~60 показателей (металлы, радиология и т.п.) пока доступны только в прежнем интерфейсе.</div>
        </div>
      <//>
    </div>
  `;
}
