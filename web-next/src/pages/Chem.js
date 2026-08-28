import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { FlaskConical, Plus, AlertTriangle, Settings2, Paperclip, Copy, Pencil, Trash2, History, Download, Upload, FileSpreadsheet, ScrollText, Scale, Loader2 } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { CHEM_PARAMS, CHEM_PARAM_MAP, CHEM_GROUPS, pdkStatus, pdkStr } from '../lib/chem-params.js';
import {
  CHEM_PROTO_TYPE_META, parseChemValue, quarterFromDate, romanQuarter,
  calcIonBalance, detectAnomalies, buildProtoDiff, countResultChanges,
} from '../lib/chem-core.js';
import {
  CHEM_TEMPLATE_TYPES, resolveTplSource, downloadChemTemplateXlsx, parseChemImportFile, analyzeChemImportRows, importChemRows,
  collectExceedances, downloadExceedanceReportXlsx, exportProtocolCsv,
} from '../lib/chem-analytics.js';
import { calcMeq, classifyWaterType, buildKurlovHtml } from '../lib/chem-map-core.js';
import { drawPiper, drawTolstikhin, drawStiff, drawSchoeller, tolstCellInfoHtml, wtypeHtml } from '../lib/chem-diagrams.js';
import { Button, Card, CardContent, Select, Badge, Dialog, Field, Input, Skeleton, EmptyState, Tabs } from '../components/ui.js';

const CHEM_SERIES_COLORS = ['#2E6DAE', '#2F8F52', '#C08420', '#8b5cf6', '#f472b6', '#0891b2'];

const STATUS_BADGE = { ok: 'success', exceed: 'danger', no_norm: 'default', nd: 'default' };
const STATUS_LABEL = { ok: 'В норме', exceed: 'Превышение', no_norm: 'Без норматива', nd: '—' };

// Supabase/PostgREST на этом проекте молча обрезает любой select() до 1000 строк
// (серверный db-max-rows) независимо от .limit()/.range() клиента — единственный
// способ получить больше 1000 строк одной таблицы это постраничная выборка.
async function fetchAllRows(table, selectCols) {
  const pageSize = 1000;
  let all = [];
  let from = 0;
  for (;;) {
    const res = await supabase.from(table).select(selectCols).range(from, from + pageSize - 1);
    if (res.error) return { data: all, error: res.error };
    all = all.concat(res.data || []);
    if (!res.data || res.data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function emptyForm() {
  const d = todayStr();
  return { water_point_id: '', sampled_at: d, lab_name: '', lab_protocol_number: '', lab_number: '', protocol_type: 'sha', is_control: false, quarter: quarterFromDate(d) };
}
function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return d && m && y ? `${d}.${m}.${y}` : s;
}

// ── Баланс ионов ─────────────────────────────────────────────────────────
function IonBalanceBadge({ balance }) {
  if (!balance) return null;
  const bad = balance.bad;
  return html`
    <div style=${{
      display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontWeight: 600,
      padding: '5px 10px', borderRadius: '7px', marginBottom: '10px',
      background: bad ? 'var(--red-50)' : 'var(--green-100)', color: bad ? 'var(--red-500)' : 'var(--green-600)',
      border: '1px solid ' + (bad ? 'var(--red-100)' : 'var(--green-100)'),
    }}>
      ${bad ? '⚠' : '✓'} Баланс ионов: ${balance.errorPct > 0 ? '+' : ''}${balance.errorPct.toFixed(1)}% ${bad ? '— проверьте ввод (норма ±5%)' : '(норма ±5%)'}
    <//>
  `;
}

// ── Индикатор «Сохранение…» поверх формы — заменяет неочевидное disabled-состояние кнопки ──
function SavingOverlay({ text }) {
  return html`
    <div style=${{
      position: 'absolute', inset: 0, background: 'var(--bg-surface)', opacity: 0.85, zIndex: 5,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
      borderRadius: 'var(--radius-lg)',
    }}>
      <${Loader2} size=${28} style=${{ animation: 'spin 1s linear infinite', color: 'var(--gold-500)' }} />
      <span style=${{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>${text || 'Сохранение…'}<//>
    </div>
  `;
}

// ── Диалог подтверждения (замена window.confirm — тот в некоторых браузерных
// окружениях/встроенных вебвью тихо возвращает false без показа пользователю,
// из-за чего сохранение «зависает» без объяснений) ───────────────────────
function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onCancel }) {
  if (!open) return null;
  return html`
    <${Dialog} open=${true} onClose=${busy ? () => {} : onCancel} title=${title || 'Подтверждение'} width="min(520px, 92vw)"
      footer=${html`
        <${Button} variant="outline" onClick=${onCancel} disabled=${busy}>Отмена<//>
        <${Button} onClick=${onConfirm} disabled=${busy} style=${danger ? { background: 'var(--red-500)', borderColor: 'var(--red-500)' } : undefined}>
          ${busy ? 'Сохранение…' : (confirmLabel || 'Подтвердить')}
        <//>
      `}>
      <div style=${{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>${message}</div>
    <//>
  `;
}

// ── Карточка протокола в списке ─────────────────────────────────────────
function ProtocolCard({ p, wpName, resultsCount, exceedCount, compareChecked, onToggleCompare, onPassport, onExportCsv, onOpen, onEdit, onDuplicate, onDelete }) {
  const meta = CHEM_PROTO_TYPE_META[p.protocol_type] || CHEM_PROTO_TYPE_META.full;
  const q = p.quarter || quarterFromDate(p.sampled_at);
  return html`
    <div onClick=${onOpen} style=${{
      display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', cursor: 'pointer',
      background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
    }}>
      <label onClick=${(e) => e.stopPropagation()} title="Добавить в сравнение" style=${{ display: 'flex', cursor: 'pointer' }}>
        <input type="checkbox" checked=${compareChecked} onChange=${(e) => onToggleCompare(e.target.checked)} />
      </label>
      <span style=${{ fontSize: '13px', fontWeight: 700, color: 'var(--gold-600)', minWidth: '80px' }}>${fmtDate(p.sampled_at)}</span>
      ${q && html`<${Badge}>${romanQuarter(q)} кв.<//>`}
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
        <span style=${{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${wpName}</span>
        <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          ${p.lab_name || ''}${p.lab_protocol_number ? ' №' + p.lab_protocol_number : ''}${p.lab_number ? ' (проба ' + p.lab_number + ')' : ''}
        </span>
      </div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
        <span style=${{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: meta.color + '18', color: meta.color }}>${meta.icon} ${meta.label}<//>
        ${p.is_control && html`<${Badge} variant="warning">🔬 Контрольная<//>`}
        ${exceedCount > 0
          ? html`<${Badge} variant="danger"><${AlertTriangle} size=${11} /> ${exceedCount} превыш.<//>`
          : resultsCount > 0 ? html`<${Badge} variant="success">В норме<//>` : html`<${Badge}>Нет данных<//>`}
        <${Badge}>${resultsCount} пар.<//>
        ${p.scan_url && html`<a href=${p.scan_url} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()} title="Открыть скан протокола" style=${{ color: 'var(--text-tertiary)', display: 'flex' }}><${Paperclip} size=${14} /><//>`}
        <${Button} variant="ghost" size="sm" icon title="Паспорт водопункта" onClick=${(e) => { e.stopPropagation(); onPassport(); }}><${ScrollText} size=${13} /><//>
        <${Button} variant="ghost" size="sm" icon title="Экспорт CSV" onClick=${(e) => { e.stopPropagation(); onExportCsv(); }}><${Download} size=${13} /><//>
        <${Button} variant="ghost" size="sm" icon title="Редактировать" onClick=${(e) => { e.stopPropagation(); onEdit(); }}><${Pencil} size=${13} /><//>
        <${Button} variant="ghost" size="sm" icon title="Дублировать" onClick=${(e) => { e.stopPropagation(); onDuplicate(); }}><${Copy} size=${13} /><//>
        <${Button} variant="ghost" size="sm" icon title="Удалить" onClick=${(e) => { e.stopPropagation(); onDelete(); }}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
      </div>
    </div>
  `;
}

// ── Параметр — одно поле ввода (используется и в шаблоне, и в каталоге) ──
function ParamField({ p, value, onChange }) {
  const raw = (value || '').trim();
  const parsed = raw ? parseChemValue(raw) : null;
  const status = raw ? (parsed ? pdkStatus(p.key, raw, parsed.below) : 'no_norm') : null;
  const exceed = status === 'exceed';
  const pdk = pdkStr(p);
  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <label style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title=${p.name}>
        ${p.no}. ${p.name} <span style=${{ opacity: .75 }}>${p.unit}${pdk !== '—' ? ' · ПДК ' + pdk : ''}</span>
      </label>
      <${Input} value=${value || ''} placeholder="напр. 7,9 или <0,50" onChange=${(e) => onChange(p.key, e.target.value)}
        style=${{ fontSize: '12px', padding: '5px 8px', borderColor: exceed ? 'var(--red-400)' : undefined, background: exceed ? 'var(--red-50)' : undefined }} />
    </div>
  `;
}

// ── Диалог: форма протокола (новый / редактирование / дубликат) ─────────
function ProtocolFormDialog({ open, editing, wpOptions, labTemplates, protocols, resultsByProtocol, setResultsByProtocol, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [values, setValues] = useState({});
  const [templateId, setTemplateId] = useState('');
  const [group, setGroup] = useState('organo');
  const [scanFile, setScanFile] = useState(null);
  const [clearScan, setClearScan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [anomalyPrompt, setAnomalyPrompt] = useState(null); // {message, draftResults} | null

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setScanFile(null);
    setClearScan(false);
    setGroup('organo');
    if (editing && editing.mode === 'edit') {
      const p = editing.proto;
      setForm({
        water_point_id: p.water_point_id, sampled_at: p.sampled_at, lab_name: p.lab_name || '',
        lab_protocol_number: p.lab_protocol_number || '', lab_number: p.lab_number || '',
        protocol_type: p.protocol_type || 'sha', is_control: !!p.is_control, quarter: p.quarter || quarterFromDate(p.sampled_at),
      });
      const vals = {}; (editing.results || []).forEach((r) => { vals[r.param_key] = r.value_raw || ''; });
      setValues(vals);
      setTemplateId(p.template_id || '');
    } else if (editing && editing.mode === 'duplicate') {
      const p = editing.proto;
      setForm({ ...emptyForm(), water_point_id: p.water_point_id, protocol_type: p.protocol_type || 'sha', lab_name: p.lab_name || '' });
      setValues({});
      setTemplateId(p.template_id || '');
    } else {
      setForm(emptyForm());
      setValues({});
      setTemplateId('');
    }
  }, [open, editing]);

  const knownLabs = useMemo(() => {
    const set = new Set();
    labTemplates.forEach((t) => t.lab_name && set.add(t.lab_name));
    protocols.forEach((p) => p.lab_name && set.add(p.lab_name));
    return [...set].sort();
  }, [labTemplates, protocols]);

  const labTemplatesForLab = useMemo(() => {
    const lab = (form.lab_name || '').trim().toLowerCase();
    if (!lab) return [];
    return labTemplates.filter((t) => (t.lab_name || '').trim().toLowerCase() === lab);
  }, [labTemplates, form.lab_name]);

  useEffect(() => {
    if (templateId && !labTemplatesForLab.some((t) => t.id === templateId)) setTemplateId('');
  }, [form.lab_name]); // eslint-disable-line

  const selectedTemplate = templateId ? labTemplates.find((t) => t.id === templateId) : null;
  const ionBalance = useMemo(() => calcIonBalance(values), [values]);
  const groupCounts = useMemo(() => {
    const out = {};
    Object.keys(CHEM_GROUPS).forEach((g) => {
      const params = CHEM_PARAMS.filter((p) => p.group === g);
      let filled = 0, exceeded = 0;
      params.forEach((p) => {
        const raw = (values[p.key] || '').trim();
        if (!raw) return;
        filled++;
        const parsed = parseChemValue(raw);
        if (parsed && pdkStatus(p.key, raw, parsed.below) === 'exceed') exceeded++;
      });
      out[g] = { filled, total: params.length, exceeded };
    });
    return out;
  }, [values]);

  function setParamValue(key, v) { setValues((prev) => ({ ...prev, [key]: v })); }

  function handleWpChange(id) {
    const wp = wpOptions.find((w) => w.id === id);
    if (!form.lab_name.trim() && wp && wp.default_template_id) {
      const tpl = labTemplates.find((t) => t.id === wp.default_template_id);
      if (tpl) {
        setForm((f) => ({ ...f, water_point_id: id, lab_name: tpl.lab_name }));
        setTemplateId(tpl.id);
        return;
      }
    }
    setForm((f) => ({ ...f, water_point_id: id }));
  }
  function handleDateChange(v) { setForm((f) => ({ ...f, sampled_at: v, quarter: quarterFromDate(v) || f.quarter })); }

  async function handleSave() {
    setFormError('');
    if (!form.water_point_id || !form.sampled_at) { setFormError('Укажите водопункт и дату отбора проб'); return; }
    setSaving(true);

    const draftResults = [];
    CHEM_PARAMS.forEach((p) => {
      const raw = (values[p.key] || '').trim();
      if (!raw) return;
      const parsed = parseChemValue(raw);
      draftResults.push({
        param_key: p.key, value_raw: raw,
        value_num: parsed && !parsed.below && !parsed.above ? parsed.num : null,
        below_detection: parsed ? parsed.below : false,
        above_range: parsed ? parsed.above : false,
      });
    });

    const existingId = editing && editing.mode === 'edit' ? editing.proto.id : null;

    // Автообнаружение аномалий — сравнение с последними 5 пробами этого водопункта
    const history = protocols
      .filter((p) => p.water_point_id === form.water_point_id && p.id !== existingId)
      .sort((a, b) => (b.sampled_at || '').localeCompare(a.sampled_at || ''))
      .slice(0, 5);
    if (history.length) {
      let localResults = resultsByProtocol;
      const needIds = history.filter((p) => !resultsByProtocol[p.id]).map((p) => p.id);
      if (needIds.length) {
        const resArr = await Promise.all(needIds.map((id) => supabase.from('chem_results').select('*').eq('protocol_id', id)));
        const additions = {};
        resArr.forEach((res, i) => { additions[needIds[i]] = (!res.error && res.data) ? res.data : []; });
        localResults = { ...resultsByProtocol, ...additions };
        setResultsByProtocol(localResults);
      }
      const anomalies = detectAnomalies(history, localResults, draftResults);
      if (anomalies.length) {
        const msg = 'Резкое отклонение от предыдущих проб этого водопункта:\n\n' +
          anomalies.map((a) => `• ${a.name}: было ${a.prev} ${a.unit} (${a.prevDate || '—'}) → стало ${a.next} ${a.unit}`).join('\n') +
          '\n\nЭто может быть реальное изменение состава, а может — опечатка или перепутанные единицы измерения.';
        setSaving(false);
        setAnomalyPrompt({ message: msg, draftResults });
        return;
      }
    }

    await finishSave(draftResults);
  }

  async function finishSave(draftResults) {
    setSaving(true);
    setAnomalyPrompt(null);
    const existingId = editing && editing.mode === 'edit' ? editing.proto.id : null;
    const oldProto = existingId ? editing.proto : null;
    let protoRow = {
      water_point_id: form.water_point_id, sampled_at: form.sampled_at,
      lab_name: form.lab_name.trim() || null, lab_protocol_number: form.lab_protocol_number.trim() || null,
      lab_number: form.lab_number.trim() || null, protocol_type: form.protocol_type || 'sha',
      is_control: !!form.is_control, source: 'manual', template_id: templateId || null,
      quarter: form.quarter || quarterFromDate(form.sampled_at),
    };
    if (existingId) protoRow.id = existingId;

    let pRes = await supabase.from('chem_protocols').upsert(protoRow).select().single();
    if (pRes.error && /template_id/i.test(pRes.error.message || '')) { delete protoRow.template_id; pRes = await supabase.from('chem_protocols').upsert(protoRow).select().single(); }
    if (pRes.error && /quarter/i.test(pRes.error.message || '')) { delete protoRow.quarter; pRes = await supabase.from('chem_protocols').upsert(protoRow).select().single(); }
    if (pRes.error) { setFormError('Ошибка сохранения: ' + pRes.error.message); setSaving(false); return; }
    const savedProto = pRes.data;

    const resultRows = draftResults.map((r) => ({ protocol_id: savedProto.id, ...r }));
    if (existingId) await supabase.from('chem_results').delete().eq('protocol_id', existingId);
    if (resultRows.length) {
      const rRes = await supabase.from('chem_results').insert(resultRows);
      if (rRes.error) {
        setFormError('Протокол сохранён, но результаты анализа — нет: ' + rRes.error.message + '. Откройте протокол на редактирование и сохраните ещё раз.');
        setSaving(false);
        return;
      }
    }

    // CHEM-07: скан-копия
    if (scanFile) {
      const path = savedProto.id + '/' + Date.now() + '_' + scanFile.name;
      const up = await supabase.storage.from('chem-scans').upload(path, scanFile, { upsert: true, contentType: scanFile.type || 'application/octet-stream' });
      if (!up.error) {
        const urlRes = supabase.storage.from('chem-scans').getPublicUrl(path);
        const scanUrl = urlRes.data ? urlRes.data.publicUrl : path;
        const scanUpd = await supabase.from('chem_protocols').update({ scan_url: scanUrl, scan_name: scanFile.name }).eq('id', savedProto.id);
        if (!scanUpd.error) { savedProto.scan_url = scanUrl; savedProto.scan_name = scanFile.name; }
      }
    } else if (clearScan) {
      const clr = await supabase.from('chem_protocols').update({ scan_url: null, scan_name: null }).eq('id', savedProto.id);
      if (!clr.error) { savedProto.scan_url = null; savedProto.scan_name = null; }
    }

    // CHEM-08: журнал изменений (таблица может быть ещё не создана — не блокируем сохранение)
    const wpNameOf = (id) => (wpOptions.find((w) => w.id === id) || {}).name || id;
    const protoTypeLabel = (k) => (CHEM_PROTO_TYPE_META[k] || {}).label || k;
    const histChanges = existingId ? buildProtoDiff(oldProto, protoRow, { wpNameOf, protoTypeLabel }) : [];
    const resultChangeCount = existingId ? countResultChanges(editing.results, draftResults) : 0;
    if (resultChangeCount > 0) histChanges.push({ field: 'results', label: 'Результаты анализа', old: '', new: 'изменено значений: ' + resultChangeCount });
    if (!existingId || histChanges.length) {
      supabase.from('chem_protocol_history').insert({ protocol_id: savedProto.id, action: existingId ? 'updated' : 'created', changes: histChanges }).then(() => {}, () => {});
    }

    const exceededNames = resultRows
      .filter((r) => pdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed')
      .map((r) => (CHEM_PARAM_MAP[r.param_key] || {}).name || r.param_key);

    setSaving(false);
    onSaved(savedProto, resultRows, exceededNames);
  }

  if (!open) return null;
  const title = editing && editing.mode === 'edit' ? 'Редактировать протокол' : 'Новый протокол анализа';

  return html`
    <${Dialog} open=${open} onClose=${saving ? () => {} : onClose} title=${title} width="min(920px, 96vw)"
      footer=${html`
        <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          ${formError && html`<span style=${{ fontSize: '12px', color: 'var(--red-500)' }}>${formError}</span>`}
          <div style=${{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <${Button} variant="outline" onClick=${onClose} disabled=${saving}>Отмена<//>
            <${Button} onClick=${handleSave} disabled=${saving}>
              ${saving && html`<${Loader2} size=${14} style=${{ animation: 'spin 1s linear infinite', marginRight: '2px' }} />`}
              ${saving ? 'Сохранение…' : 'Сохранить протокол'}
            <//>
          </div>
        </div>
      `}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative' }}>
        ${saving && html`<${SavingOverlay} />`}
        <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="Водопункт *">
            <${Select} value=${form.water_point_id} onChange=${(e) => handleWpChange(e.target.value)}>
              <option value="">— выберите —</option>
              ${wpOptions.map((w) => html`<option key=${w.id} value=${w.id}>${w.name || w.code}<//>`)}
            <//>
          <//>
          <${Field} label="Дата отбора *"><${Input} type="date" value=${form.sampled_at} onChange=${(e) => handleDateChange(e.target.value)} /><//>
          <${Field} label="Квартал">
            <${Select} value=${form.quarter || ''} onChange=${(e) => setForm((f) => ({ ...f, quarter: parseInt(e.target.value, 10) }))}>
              ${[1, 2, 3, 4].map((q) => html`<option key=${q} value=${q}>${romanQuarter(q)} кв.<//>`)}
            <//>
          <//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="Лаборатория">
            <div style=${{ display: 'flex', gap: '4px' }}>
              <${Input} value=${form.lab_name} placeholder="EcoExpert" onChange=${(e) => setForm((f) => ({ ...f, lab_name: e.target.value }))} style=${{ flex: 1, minWidth: 0 }} />
              ${knownLabs.length > 0 && html`
                <${Select} title="Выбрать из уже известных лабораторий" style=${{ flex: '0 0 44px', padding: '0 2px', textAlign: 'center' }}
                  value="" onChange=${(e) => { if (e.target.value) setForm((f) => ({ ...f, lab_name: e.target.value })); }}>
                  <option value="">▾</option>
                  ${knownLabs.map((l) => html`<option key=${l} value=${l}>${l}<//>`)}
                <//>
              `}
            </div>
          <//>
          <${Field} label="№ протокола"><${Input} value=${form.lab_protocol_number} placeholder="421/2" onChange=${(e) => setForm((f) => ({ ...f, lab_protocol_number: e.target.value }))} /><//>
          <${Field} label="Лаб. номер пробы"><${Input} value=${form.lab_number} placeholder="977" onChange=${(e) => setForm((f) => ({ ...f, lab_number: e.target.value }))} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', alignItems: 'end' }}>
          <${Field} label="Вид протокола">
            <${Select} value=${form.protocol_type} onChange=${(e) => setForm((f) => ({ ...f, protocol_type: e.target.value }))}>
              ${Object.keys(CHEM_PROTO_TYPE_META).filter((k) => k !== 'full').map((k) => html`<option key=${k} value=${k}>${CHEM_PROTO_TYPE_META[k].icon} ${CHEM_PROTO_TYPE_META[k].label}<//>`)}
            <//>
          <//>
          <${Field} label="Шаблон ввода">
            <${Select} value=${templateId} onChange=${(e) => setTemplateId(e.target.value)}>
              <option value="">— Полный каталог (все параметры) —</option>
              ${labTemplatesForLab.map((t) => html`<option key=${t.id} value=${t.id}>${t.template_name} (${(t.params || []).length})<//>`)}
            <//>
          <//>
          <label style=${{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', paddingBottom: '8px' }}>
            <input type="checkbox" checked=${form.is_control} onChange=${(e) => setForm((f) => ({ ...f, is_control: e.target.checked }))} />
            🔬 Контрольная проба
          </label>
        </div>

        <${Field} label="Скан-копия протокола (PDF или изображение)">
          <input type="file" accept=".pdf,image/*" onChange=${(e) => setScanFile(e.target.files[0] || null)} style=${{ fontSize: '12px' }} />
          ${editing && editing.mode === 'edit' && editing.proto.scan_url && !clearScan && html`
            <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginTop: '6px' }}>
              <a href=${editing.proto.scan_url} target="_blank" rel="noopener" style=${{ color: 'var(--blue-600)', display: 'flex', alignItems: 'center', gap: '4px' }}><${Paperclip} size=${12} /> ${editing.proto.scan_name || 'Открыть скан'}<//>
              <${Button} variant="ghost" size="sm" onClick=${() => setClearScan(true)}><${Trash2} size=${12} style=${{ color: 'var(--red-500)' }} /> Удалить<//>
            </div>
          `}
          ${clearScan && html`<div style=${{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px' }}>Скан будет удалён при сохранении</div>`}
        <//>

        <div style=${{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
          ${selectedTemplate ? html`
            <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
              Результаты анализа — шаблон «${selectedTemplate.lab_name} / ${selectedTemplate.template_name}» (${(selectedTemplate.params || []).length} показателей)
            </div>
            <${IonBalanceBadge} balance=${ionBalance} />
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
              ${(selectedTemplate.params || []).map((key) => CHEM_PARAM_MAP[key] ? html`<${ParamField} key=${key} p=${CHEM_PARAM_MAP[key]} value=${values[key]} onChange=${setParamValue} />` : null)}
            </div>
          ` : html`
            <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Результаты анализа — полный каталог</div>
            <${IonBalanceBadge} balance=${ionBalance} />
            <div style=${{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
              ${Object.keys(CHEM_GROUPS).map((g) => {
                const c = groupCounts[g];
                const active = g === group;
                return html`
                  <button key=${g} type="button" onClick=${() => setGroup(g)} style=${{
                    padding: '5px 12px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
                    border: '1px solid ' + (active ? 'var(--gold-400)' : (c.exceeded > 0 ? 'var(--red-400)' : 'var(--border)')),
                    background: active ? 'var(--gold-50)' : 'transparent',
                    color: active ? 'var(--gold-700)' : (c.exceeded > 0 ? 'var(--red-500)' : 'var(--text-secondary)'),
                    fontWeight: active ? 600 : 400,
                  }}>
                    ${CHEM_GROUPS[g].label} <span style=${{ fontSize: '10px', opacity: .75 }}>(${c.filled}/${c.total})${c.exceeded > 0 ? ' ⚠' : ''}</span>
                  </button>
                `;
              })}
            </div>
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
              ${CHEM_PARAMS.filter((p) => p.group === group).map((p) => html`<${ParamField} key=${p.key} p=${p} value=${values[p.key]} onChange=${setParamValue} />`)}
            </div>
          `}
        </div>
      </div>
    <//>
    <${ConfirmDialog} open=${!!anomalyPrompt} title="⚠ Резкое отклонение от предыдущих проб" message=${anomalyPrompt ? anomalyPrompt.message : ''}
      confirmLabel="Сохранить как есть" busy=${saving}
      onCancel=${() => setAnomalyPrompt(null)}
      onConfirm=${() => finishSave(anomalyPrompt.draftResults)}
    />
  `;
}

// ── Диалог: детали протокола ─────────────────────────────────────────────
function ProtocolDetailDialog({ proto, wpName, results, allProtocols, resultsByProtocol, onClose, onEdit, onDuplicate, onDelete }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState(null);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => { setHistoryOpen(false); setHistoryRows(null); setHistoryError(''); }, [proto && proto.id]);

  const allMeqs = useMemo(() => {
    if (!proto) return [];
    const sameWp = (allProtocols || []).filter((p) => p.water_point_id === proto.water_point_id);
    const list = sameWp
      .map((p) => ({ id: p.id, date: p.sampled_at, meq: calcMeq(resultsByProtocol[p.id] || []) }))
      .filter((x) => x.meq._valid)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (list.length) return list;
    const own = calcMeq(results);
    return own._valid ? [{ id: proto.id, date: proto.sampled_at, meq: own }] : [];
  }, [proto, allProtocols, resultsByProtocol, results]);
  const currentMeq = useMemo(() => (allMeqs.find((x) => x.id === (proto && proto.id)) || {}).meq || calcMeq(results), [allMeqs, proto, results]);

  async function toggleHistory() {
    if (historyOpen) { setHistoryOpen(false); return; }
    setHistoryOpen(true);
    if (historyRows != null) return;
    const res = await supabase.from('chem_protocol_history').select('*').eq('protocol_id', proto.id).order('changed_at', { ascending: false });
    if (res.error) { setHistoryError('Журнал изменений ещё не подключён — выполните миграцию migrations/chem_core_protocols.sql'); return; }
    setHistoryRows(res.data || []);
  }

  if (!proto) return null;
  const meta = CHEM_PROTO_TYPE_META[proto.protocol_type] || CHEM_PROTO_TYPE_META.full;
  const sorted = (results || []).slice().sort((a, b) => (CHEM_PARAM_MAP[a.param_key]?.no || 99) - (CHEM_PARAM_MAP[b.param_key]?.no || 99));

  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${wpName + ' — ' + fmtDate(proto.sampled_at)} width="min(880px, 96vw)"
      footer=${html`
        <${Button} variant="ghost" onClick=${toggleHistory}><${History} size=${14} /> История<//>
        <${Button} variant="ghost" onClick=${onDuplicate}><${Copy} size=${14} /> Дублировать<//>
        <${Button} variant="ghost" onClick=${onDelete}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /> Удалить<//>
        <${Button} onClick=${onEdit}><${Pencil} size=${14} /> Редактировать<//>
      `}>
      <div style=${{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
        <span style=${{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: meta.color + '18', color: meta.color }}>${meta.icon} ${meta.label}<//>
        ${proto.is_control && html`<${Badge} variant="warning">🔬 Контрольная<//>`}
        ${proto.quarter && html`<${Badge}>${romanQuarter(proto.quarter)} кв.<//>`}
        ${proto.lab_name && html`<span style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>${proto.lab_name}${proto.lab_protocol_number ? ' №' + proto.lab_protocol_number : ''}${proto.lab_number ? ' · проба ' + proto.lab_number : ''}<//>`}
        ${proto.scan_url && html`<a href=${proto.scan_url} target="_blank" rel="noopener" style=${{ color: 'var(--blue-600)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><${Paperclip} size=${12} /> ${proto.scan_name || 'Скан'}<//>`}
      </div>

      ${historyOpen && html`
        <div style=${{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px', marginBottom: '14px', maxHeight: '220px', overflow: 'auto' }}>
          ${historyError && html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>${historyError}</div>`}
          ${!historyError && historyRows == null && html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Загрузка…</div>`}
          ${!historyError && historyRows && !historyRows.length && html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Записей пока нет</div>`}
          ${!historyError && historyRows && historyRows.map((h) => html`
            <div key=${h.id} style=${{ marginBottom: '10px' }}>
              <div style=${{ fontSize: '12px', color: 'var(--text-primary)' }}>
                <b>${new Date(h.changed_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
                ${h.changed_by ? ' · ' + h.changed_by : ''} · ${h.action === 'created' ? 'Протокол создан' : 'Изменён'}
              </div>
              ${(h.changes || []).map((c, i) => html`
                <div key=${i} style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', paddingLeft: '14px' }}>
                  ${c.label}: ${c.old ? html`<s>${String(c.old)}</s> → ` : ''}<span style=${{ color: 'var(--text-secondary)' }}>${String(c.new)}</span>
                </div>
              `)}
            </div>
          `)}
        </div>
      `}

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Показатель</th><th>Значение</th><th>ПДК</th><th>Статус</th></tr></thead>
          <tbody>
            ${sorted.map((r) => {
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
            ${!sorted.length && html`<tr><td colspan="4" style=${{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '16px' }}>Нет результатов</td></tr>`}
          </tbody>
        </table>
      </div>

      ${currentMeq && currentMeq._valid
        ? html`<${ProtocolDiagrams} meq=${currentMeq} allMeqs=${allMeqs} currentId=${proto.id} />`
        : html`<div style=${{ marginTop: '16px', padding: '14px', borderRadius: 'var(--radius-md)', background: 'var(--bg-sunken)', color: 'var(--text-tertiary)', fontSize: '12.5px', textAlign: 'center' }}>Нет данных макрокомпонентного состава (Ca, Mg, Na, K, HCO₃, SO₄, Cl) для построения диаграмм</div>`}
    <//>
  `;
}

// ── Диаграммы Пайпер / Стифф / Шёллер / Толстихин для протокола ─────────
function ProtocolDiagrams({ meq, allMeqs, currentId }) {
  const [diagTab, setDiagTab] = useState('piper');
  const [piperSelId, setPiperSelId] = useState(currentId);
  const [tolstSelId, setTolstSelId] = useState(currentId);
  const piperWrapRef = useRef(null);
  const piperCanvasRef = useRef(null);
  const tolstWrapRef = useRef(null);
  const tolstCanvasRef = useRef(null);
  const stiffCanvasRef = useRef(null);
  const schoCanvasRef = useRef(null);

  useEffect(() => { setPiperSelId(currentId); setTolstSelId(currentId); }, [currentId]);

  function redraw() {
    if (diagTab === 'piper' && piperCanvasRef.current) {
      const w = Math.max(320, (piperWrapRef.current?.clientWidth || 480) - 4);
      drawPiper(piperCanvasRef.current, allMeqs, currentId, w, (id) => setPiperSelId(id));
    }
    if (diagTab === 'tolst' && tolstCanvasRef.current) {
      const w = Math.max(320, (tolstWrapRef.current?.clientWidth || 480) - 4);
      drawTolstikhin(tolstCanvasRef.current, allMeqs, currentId, w, (id) => setTolstSelId(id));
    }
    if (diagTab === 'stiff' && stiffCanvasRef.current && schoCanvasRef.current) {
      const w1 = Math.max(280, (stiffCanvasRef.current.parentElement?.clientWidth || 480) - 4);
      drawStiff(stiffCanvasRef.current, meq, w1, 210);
      const w2 = Math.max(280, (schoCanvasRef.current.parentElement?.clientWidth || 480) - 4);
      drawSchoeller(schoCanvasRef.current, allMeqs, currentId, w2, 250);
    }
  }

  useEffect(() => { redraw(); }, [diagTab, meq, allMeqs, currentId]);

  useEffect(() => {
    let t;
    function onResize() { clearTimeout(t); t = setTimeout(redraw, 120); }
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, [diagTab, meq, allMeqs, currentId]);

  const tolstSel = allMeqs.find((a) => a.id === tolstSelId) || allMeqs.find((a) => a.id === currentId);
  const piperSel = allMeqs.find((a) => a.id === piperSelId) || allMeqs.find((a) => a.id === currentId);
  const piperMeq = piperSel ? piperSel.meq : meq;
  const piperIsOther = piperSel && piperSel.id !== currentId;

  return html`
    <div style=${{ marginTop: '18px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
      <${Tabs} tabs=${[{ value: 'piper', label: '📐 Пайпер' }, { value: 'stiff', label: '📊 Стифф · Шёллер' }, { value: 'tolst', label: '▦ Толстихин' }]} value=${diagTab} onChange=${setDiagTab} />
      <div style=${{ marginTop: '12px' }}>
        ${diagTab === 'piper' && html`
          <div ref=${piperWrapRef} style=${{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <canvas ref=${piperCanvasRef} style=${{ flex: '1 1 380px', minWidth: '300px', maxWidth: '100%' }} />
            <div style=${{ flex: '0 0 210px', minWidth: '190px', fontSize: '12.5px' }}>
              ${piperIsOther && html`
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '11px', fontWeight: 600, color: 'var(--gold-600, var(--text-primary))' }}>
                  <${History} size=${12} /> Проба от ${fmtDate(piperSel.date)}
                </div>
              `}
              <div style=${{ marginBottom: '10px' }} dangerouslySetInnerHTML=${{ __html: wtypeHtml(piperMeq) }} />
              <div style=${{ marginBottom: '10px' }} dangerouslySetInnerHTML=${{ __html: buildKurlovHtml(piperMeq) }} />
              <div style=${{ color: 'var(--text-tertiary)', fontSize: '11.5px', lineHeight: 1.5 }}>Точки — все пробы этого водопункта. Клик по точке показывает её состав слева.</div>
            </div>
          </div>
        `}
        ${diagTab === 'stiff' && html`
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <canvas ref=${stiffCanvasRef} style=${{ width: '100%' }} />
            <canvas ref=${schoCanvasRef} style=${{ width: '100%' }} />
          </div>
        `}
        ${diagTab === 'tolst' && html`
          <div ref=${tolstWrapRef} style=${{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <canvas ref=${tolstCanvasRef} style=${{ flex: '1 1 380px', minWidth: '300px', maxWidth: '100%' }} />
            <div style=${{ flex: '0 0 210px', minWidth: '190px', fontSize: '12.5px' }}>
              <div style=${{ fontWeight: 600, marginBottom: '10px' }} dangerouslySetInnerHTML=${{ __html: tolstCellInfoHtml(tolstSel) }} />
              <div style=${{ color: 'var(--text-tertiary)', fontSize: '11.5px', lineHeight: 1.5 }}>Квадрат Толстихина: X — доля Cl⁻+SO₄²⁻, Y — доля Ca²⁺+Mg²⁺. Клик по точке — выбрать пробу.</div>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

// ── Диалог: мастер шаблонов лабораторий ──────────────────────────────────
function LabTemplateWizardDialog({ open, onClose, labTemplates, setLabTemplates }) {
  const [screen, setScreen] = useState('list');
  const [editingId, setEditingId] = useState(null);
  const [lab, setLab] = useState('');
  const [name, setName] = useState('');
  const [baseType, setBaseType] = useState('sha');
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setScreen('list'); setErr(''); } }, [open]);

  function newTemplate() { setEditingId(null); setLab(''); setName(''); setBaseType('sha'); setSelected([]); setSearch(''); setErr(''); setScreen('editor'); }
  function editTemplate(t) { setEditingId(t.id); setLab(t.lab_name); setName(t.template_name); setBaseType(t.base_type || 'sha'); setSelected((t.params || []).slice()); setSearch(''); setErr(''); setScreen('editor'); }
  function duplicateTemplate(t) { setEditingId(null); setLab(t.lab_name); setName(t.template_name + ' (копия)'); setBaseType(t.base_type || 'sha'); setSelected((t.params || []).slice()); setSearch(''); setErr(''); setScreen('editor'); }
  async function deleteTemplate(id) {
    if (!confirm('Удалить этот шаблон? Уже сохранённые протоколы не изменятся.')) return;
    const res = await supabase.from('chem_lab_templates').delete().eq('id', id);
    if (res.error) { setErr('Ошибка удаления: ' + res.error.message); return; }
    setLabTemplates((prev) => prev.filter((t) => t.id !== id));
  }
  function toggleParam(key) { setSelected((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]); }
  function removeParam(key) { setSelected((prev) => prev.filter((k) => k !== key)); }
  function moveParam(key, dir) {
    setSelected((prev) => {
      const idx = prev.indexOf(key), ni = idx + dir;
      if (idx < 0 || ni < 0 || ni >= prev.length) return prev;
      const next = prev.slice(); const tmp = next[idx]; next[idx] = next[ni]; next[ni] = tmp; return next;
    });
  }
  async function save() {
    setErr('');
    if (!lab.trim()) { setErr('Укажите лабораторию'); return; }
    if (!name.trim()) { setErr('Укажите название шаблона'); return; }
    if (!selected.length) { setErr('Выберите хотя бы один параметр'); return; }
    setSaving(true);
    const row = { lab_name: lab.trim(), template_name: name.trim(), base_type: baseType, params: selected, updated_at: new Date().toISOString() };
    if (editingId) row.id = editingId;
    const res = await supabase.from('chem_lab_templates').upsert(row).select().single();
    setSaving(false);
    if (res.error) {
      const msg = res.error.message || '';
      setErr(/duplicate key|unique/i.test(msg) ? 'У этой лаборатории уже есть шаблон с таким названием — выберите другое.' : 'Ошибка сохранения: ' + msg);
      return;
    }
    setLabTemplates((prev) => { const idx = prev.findIndex((t) => t.id === res.data.id); return idx >= 0 ? prev.map((t) => t.id === res.data.id ? res.data : t) : [...prev, res.data]; });
    setScreen('list');
  }

  if (!open) return null;

  if (screen === 'editor') {
    const q = search.toLowerCase().trim();
    return html`
      <${Dialog} open=${true} onClose=${onClose} title=${(editingId ? 'Изменить шаблон' : 'Новый шаблон') + (lab ? ' — ' + lab : '')} width="min(960px, 96vw)"
        footer=${html`
          ${err && html`<span style=${{ fontSize: '12px', color: 'var(--red-500)', marginRight: 'auto' }}>${err}</span>`}
          <${Button} variant="ghost" onClick=${() => setScreen('list')}>← Назад к списку<//>
          <${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить шаблон'}<//>
        `}>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '12px' }}>
          <${Field} label="Лаборатория *"><${Input} value=${lab} placeholder="EcoExpert" onChange=${(e) => setLab(e.target.value)} /><//>
          <${Field} label="Название шаблона *"><${Input} value=${name} placeholder="Вариант 1" onChange=${(e) => setName(e.target.value)} /><//>
          <${Field} label="Вид протокола (по умолчанию)">
            <${Select} value=${baseType} onChange=${(e) => setBaseType(e.target.value)}>
              ${Object.keys(CHEM_PROTO_TYPE_META).filter((k) => k !== 'full').map((k) => html`<option key=${k} value=${k}>${CHEM_PROTO_TYPE_META[k].icon} ${CHEM_PROTO_TYPE_META[k].label}<//>`)}
            <//>
          <//>
        </div>
        <${Input} value=${search} placeholder="🔍 Поиск параметра по названию…" onChange=${(e) => setSearch(e.target.value)} style=${{ marginBottom: '12px' }} />
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', minHeight: '320px' }}>
          <div style=${{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-tertiary)', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>Каталог параметров — отметьте нужные</div>
            <div style=${{ overflowY: 'auto', maxHeight: '400px', padding: '6px' }}>
              ${Object.keys(CHEM_GROUPS).map((g) => {
                const params = CHEM_PARAMS.filter((p) => p.group === g && (!q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)));
                if (!params.length) return null;
                return html`
                  <div key=${g} style=${{ marginBottom: '8px' }}>
                    <div style=${{ fontSize: '10px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '4px 6px' }}>${CHEM_GROUPS[g].label}</div>
                    ${params.map((p) => html`
                      <label key=${p.key} style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 6px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked=${selected.includes(p.key)} onChange=${() => toggleParam(p.key)} />
                        <span style=${{ flex: 1 }}>${p.no}. ${p.name}<//>
                        <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)' }}>${p.unit}<//>
                      </label>
                    `)}
                  </div>
                `;
              })}
            </div>
          </div>
          <div style=${{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-tertiary)', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>Выбрано и порядок ввода (${selected.length})</div>
            <div style=${{ overflowY: 'auto', maxHeight: '400px', padding: '6px' }}>
              ${!selected.length && html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '12px' }}>Пока ничего не выбрано — отметьте параметры слева</div>`}
              ${selected.map((key, idx) => {
                const p = CHEM_PARAM_MAP[key];
                if (!p) return null;
                return html`
                  <div key=${key} style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', background: 'var(--bg-sunken)', marginBottom: '4px' }}>
                    <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 700, width: '18px', textAlign: 'center' }}>${idx + 1}<//>
                    <span style=${{ flex: 1, fontSize: '12px', color: 'var(--text-primary)' }}>${p.name} <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)' }}>${p.unit}<//><//>
                    <${Button} variant="ghost" size="sm" icon title="Выше" disabled=${idx === 0} onClick=${() => moveParam(key, -1)}>▲<//>
                    <${Button} variant="ghost" size="sm" icon title="Ниже" disabled=${idx === selected.length - 1} onClick=${() => moveParam(key, 1)}>▼<//>
                    <${Button} variant="ghost" size="sm" icon title="Убрать" onClick=${() => removeParam(key)}>✕<//>
                  </div>
                `;
              })}
            </div>
          </div>
        </div>
      <//>
    `;
  }

  return html`
    <${Dialog} open=${true} onClose=${onClose} title="🧪 Шаблоны лабораторий" width="640px"
      footer=${html`<${Button} variant="outline" onClick=${onClose}>Закрыть<//>`}>
      <div style=${{ fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: '14px' }}>
        Настройте под конкретную лабораторию свой набор и порядок параметров — он станет доступен при ручном вводе протокола.
      </div>
      ${err && html`<div style=${{ fontSize: '12px', color: 'var(--red-500)', marginBottom: '10px' }}>${err}</div>`}
      <div style=${{ marginBottom: '14px' }}><${Button} onClick=${newTemplate}><${Plus} size=${14} /> Новый шаблон<//><//>
      ${!labTemplates.length
        ? html`<${EmptyState} icon=${html`<${FlaskConical} size=${36} />`} title="Шаблонов ещё нет" description="Создайте первый шаблон для своей лаборатории с нужным набором и порядком параметров" />`
        : Object.keys(labTemplates.reduce((acc, t) => { (acc[t.lab_name] = acc[t.lab_name] || []).push(t); return acc; }, {})).sort().map((labName) => {
            const items = labTemplates.filter((t) => t.lab_name === labName);
            return html`
              <div key=${labName} style=${{ marginBottom: '16px' }}>
                <div style=${{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>🧪 ${labName}</div>
                ${items.map((t) => {
                  const meta = CHEM_PROTO_TYPE_META[t.base_type] || CHEM_PROTO_TYPE_META.sha;
                  return html`
                    <div key=${t.id} style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', marginBottom: '6px' }}>
                      <div style=${{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style=${{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>${t.template_name}<//>
                        <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>${meta.icon} ${meta.label} · ${(t.params || []).length} показателей<//>
                      </div>
                      <div style=${{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <${Button} variant="ghost" size="sm" onClick=${() => editTemplate(t)}><${Pencil} size=${12} /> Изменить<//>
                        <${Button} variant="ghost" size="sm" onClick=${() => duplicateTemplate(t)}><${Copy} size=${12} /> Дублировать<//>
                        <${Button} variant="ghost" size="sm" onClick=${() => deleteTemplate(t.id)}><${Trash2} size=${12} style=${{ color: 'var(--red-500)' }} /><//>
                      </div>
                    </div>
                  `;
                })}
              </div>
            `;
          })}
    <//>
  `;
}

// ── Тренды по параметрам (с линией ПДК) ──────────────────────────────────
function TrendsPanel({ wpOptions, protocols, resultsByProtocol }) {
  const [wpId, setWpId] = useState('');
  const [paramKeys, setParamKeys] = useState([]);

  const protos = useMemo(() => (wpId ? protocols.filter((p) => p.water_point_id === wpId).slice().sort((a, b) => (a.sampled_at > b.sampled_at ? 1 : -1)) : []), [protocols, wpId]);

  return html`
    <${Card}>
      <${CardContent}>
        <div style=${{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <${Field} label="Водопункт">
            <${Select} value=${wpId} onChange=${(e) => setWpId(e.target.value)} style=${{ minWidth: '220px' }}>
              <option value="">— выберите —</option>
              ${wpOptions.map((w) => html`<option key=${w.id} value=${w.id}>${w.name || w.code}<//>`)}
            <//>
          <//>
          <${Field} label="Параметры (Ctrl/⌘ — выбрать несколько)">
            <select multiple value=${paramKeys} onChange=${(e) => setParamKeys(Array.from(e.target.selectedOptions).map((o) => o.value))}
              class="select" style=${{ minWidth: '280px', height: '92px' }}>
              ${CHEM_PARAMS.map((p) => html`<option key=${p.key} value=${p.key}>${p.no}. ${p.name} (${p.unit})<//>`)}
            </select>
          <//>
        </div>

        ${!wpId || !paramKeys.length
          ? html`<${EmptyState} icon=${html`<${FlaskConical} size=${36} />`} title="Выберите водопункт и параметры" />`
          : !protos.length
            ? html`<${EmptyState} icon=${html`<${FlaskConical} size=${36} />`} title="Нет протоколов по этому водопункту" />`
            : paramKeys.map((key, ci) => {
                const param = CHEM_PARAM_MAP[key];
                if (!param) return null;
                const color = CHEM_SERIES_COLORS[ci % CHEM_SERIES_COLORS.length];
                const points = [];
                protos.forEach((p) => {
                  const r = (resultsByProtocol[p.id] || []).find((x) => x.param_key === key);
                  if (r && r.value_num != null) points.push({ s: fmtDate(p.sampled_at), val: r.value_num, raw: r.value_raw });
                });
                const pdk = param.pdk_drink != null ? param.pdk_drink : param.pdk_drink_max;
                return html`
                  <div key=${key} style=${{ marginBottom: '20px' }}>
                    <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style=${{ width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block' }} />
                      <span style=${{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>${param.name}<//>
                      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>${param.unit}<//>
                    </div>
                    ${!points.length ? html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '8px 0' }}>Нет числовых данных<//>` : html`
                      <div style=${{ width: '100%', height: '220px' }}>
                        <${ResponsiveContainer}>
                          <${ComposedChart} data=${points} margin=${{ left: 0, right: 16, top: 8, bottom: 0 }}>
                            <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                            <${XAxis} dataKey="s" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} />
                            <${YAxis} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${46} />
                            <${Tooltip} contentStyle=${{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v) => [v, param.unit]} />
                            ${pdk != null && html`<${ReferenceLine} y=${pdk} stroke="var(--red-400)" strokeDasharray="5 4" label=${{ value: 'ПДК', fontSize: 10, fill: 'var(--red-500)', position: 'right' }} />`}
                            <${Area} type="monotone" dataKey="val" name=${param.name} stroke=${color} fill=${color} fillOpacity=${0.15} strokeWidth=${2} dot=${{ r: 3 }} isAnimationActive=${false} />
                          <//>
                        <//>
                      </div>
                    `}
                  </div>
                `;
              })}
      <//>
    <//>
  `;
}

// ── Тепловая карта ПДК (последний протокол каждого водопункта) ──────────
const HEATMAP_KEYS = ['ph_lab', 'tds', 'hardness', 'no3', 'no2', 'fe_total', 'mn', 'cl', 'so4', 'cu', 'pb', 'as', 'cr6', 'ni', 'cd', 'hg', 'cn'];
function HeatmapPanel({ wpOptions, protocols, resultsByProtocol }) {
  const hmParams = HEATMAP_KEYS.map((k) => CHEM_PARAM_MAP[k]).filter(Boolean);
  const wpData = useMemo(() => wpOptions.map((wp) => {
    const protos = protocols.filter((p) => p.water_point_id === wp.id).slice().sort((a, b) => (a.sampled_at < b.sampled_at ? 1 : -1));
    const results = {};
    protos.forEach((p) => { (resultsByProtocol[p.id] || []).forEach((r) => { if (!results[r.param_key]) results[r.param_key] = r; }); });
    return { wp, results, latestDate: protos.length ? protos[0].sampled_at : null };
  }), [wpOptions, protocols, resultsByProtocol]);

  if (!wpOptions.length) return html`<${EmptyState} icon=${html`<${FlaskConical} size=${36} />`} title="Нет водопунктов" />`;

  return html`
    <${Card}>
      <${CardContent}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          <span style=${{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><span style=${{ width: '13px', height: '13px', borderRadius: '3px', background: 'var(--red-100)', display: 'inline-block' }} />Превышение ПДК<//>
          <span style=${{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><span style=${{ width: '13px', height: '13px', borderRadius: '3px', background: 'var(--green-100)', display: 'inline-block' }} />В норме<//>
          <span style=${{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><span style=${{ width: '13px', height: '13px', borderRadius: '3px', background: 'var(--bg-sunken)', border: '1px solid var(--border)', display: 'inline-block' }} />Нет данных<//>
        </div>
        <div style=${{ overflowX: 'auto' }}>
          <table style=${{ borderCollapse: 'collapse', fontSize: '11px', whiteSpace: 'nowrap' }}>
            <thead><tr>
              <th style=${{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-tertiary)', position: 'sticky', left: 0, background: 'var(--bg-surface)', minWidth: '150px', borderBottom: '2px solid var(--border)' }}>Водопункт<//>
              ${hmParams.map((p) => html`<th key=${p.key} title=${p.name + ' (' + p.unit + ')'} style=${{ padding: '6px 5px', color: 'var(--text-tertiary)', fontSize: '10px', fontWeight: 600, textAlign: 'center', borderBottom: '2px solid var(--border)', minWidth: '52px' }}>${p.key.toUpperCase().slice(0, 8)}<//>`)}
            </tr></thead>
            <tbody>
              ${wpData.map((item) => html`
                <tr key=${item.wp.id}>
                  <td style=${{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-primary)', position: 'sticky', left: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border-subtle)' }}>
                    ${item.wp.name || item.wp.code}
                    ${item.latestDate && html`<div style=${{ fontSize: '9px', color: 'var(--text-tertiary)', fontWeight: 400 }}>${fmtDate(item.latestDate)}<//>`}
                  </td>
                  ${hmParams.map((p) => {
                    const r = item.results[p.key];
                    if (!r || !r.value_raw) return html`<td key=${p.key} style=${{ textAlign: 'center', padding: '5px', color: 'var(--text-tertiary)', background: 'var(--bg-sunken)', fontSize: '10px' }}>—<//>`;
                    const st = pdkStatus(p.key, r.value_raw, r.below_detection);
                    const bg = st === 'exceed' ? 'var(--red-100)' : st === 'ok' ? 'var(--green-100)' : 'var(--bg-sunken)';
                    const clr = st === 'exceed' ? 'var(--red-600)' : st === 'ok' ? 'var(--green-600)' : 'var(--text-secondary)';
                    return html`<td key=${p.key} title=${p.name + ': ' + r.value_raw + ' ' + p.unit} style=${{ textAlign: 'center', padding: '5px', background: bg, color: clr, fontWeight: st === 'exceed' ? 700 : 400, fontSize: '10px' }}>${r.value_raw}<//>`;
                  })}
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      <//>
    <//>
  `;
}

// ── Отчёт по превышениям ПДК за период (Excel) ───────────────────────────
function ExceedanceReportDialog({ open, onClose, protocols, resultsByProtocol, wpNames }) {
  const today = todayStr();
  const [from, setFrom] = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function quickRange(kind) {
    const now = new Date();
    let y = now.getFullYear(), f, t;
    if (kind === 'year') { f = y + '-01-01'; t = today; }
    else if (kind === 'quarter') { const q = Math.floor(now.getMonth() / 3); f = y + '-' + String(q * 3 + 1).padStart(2, '0') + '-01'; t = today; }
    else { let q = Math.floor(now.getMonth() / 3) - 1; if (q < 0) { q = 3; y -= 1; } const sm = q * 3 + 1, em = sm + 2, ld = new Date(y, em, 0).getDate(); f = y + '-' + String(sm).padStart(2, '0') + '-01'; t = y + '-' + String(em).padStart(2, '0') + '-' + String(ld).padStart(2, '0'); }
    setFrom(f); setTo(t);
  }

  async function download() {
    setMsg(''); setBusy(true);
    try {
      const rows = collectExceedances(protocols, resultsByProtocol, wpNames, from, to);
      if (!rows.length) { setMsg('За выбранный период превышений ПДК не найдено'); setBusy(false); return; }
      await downloadExceedanceReportXlsx(rows, from, to);
      onClose();
    } catch (e) {
      setMsg('Ошибка: ' + e.message);
    }
    setBusy(false);
  }

  if (!open) return null;
  return html`
    <${Dialog} open=${true} onClose=${onClose} title="📊 Отчёт по превышениям ПДК" width="480px"
      footer=${html`<${Button} variant="outline" onClick=${onClose}>Отмена<//><${Button} onClick=${download} disabled=${busy}><${Download} size=${14} /> ${busy ? 'Формирование…' : 'Скачать Excel'}<//>`}>
      <div style=${{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '14px', lineHeight: 1.5 }}>Таблица всех результатов, превышающих ПДК (питьевая), по всем водопунктам за выбранный период.<//>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
        <${Field} label="С даты"><${Input} type="date" value=${from} onChange=${(e) => setFrom(e.target.value)} /><//>
        <${Field} label="По дату"><${Input} type="date" value=${to} onChange=${(e) => setTo(e.target.value)} /><//>
      </div>
      <div style=${{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <${Button} variant="ghost" size="sm" onClick=${() => quickRange('quarter')}>Текущий квартал<//>
        <${Button} variant="ghost" size="sm" onClick=${() => quickRange('prevQuarter')}>Прошлый квартал<//>
        <${Button} variant="ghost" size="sm" onClick=${() => quickRange('year')}>Текущий год<//>
      </div>
      ${msg && html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '10px' }}>${msg}<//>`}
    <//>
  `;
}

// ── Шаблоны и импорт протоколов из Excel/CSV ─────────────────────────────
function ExcelImportDialog({ open, onClose, labTemplates, wpOptions, onImported }) {
  const [source, setSource] = useState('sha');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { if (!open) { setFile(null); setPreview(null); setParsed(null); setMsg(''); } }, [open]);

  async function handleFile(f) {
    setFile(f); setPreview(null); setParsed(null); setMsg('');
    if (!f) return;
    try {
      const { headers, dataRows } = await parseChemImportFile(f);
      setParsed({ headers, dataRows });
      setPreview(analyzeChemImportRows(dataRows, wpOptions));
    } catch (e) {
      setMsg('Ошибка чтения: ' + e.message);
    }
  }

  async function doImport() {
    if (!parsed) { setMsg('Выберите файл'); return; }
    setBusy(true); setMsg('');
    const resolved = resolveTplSource(source, labTemplates);
    const result = await importChemRows(supabase, parsed.headers, parsed.dataRows, resolved.protoType, resolved.templateId, wpOptions);
    setBusy(false);
    onImported(result);
  }

  if (!open) return null;
  return html`
    <${Dialog} open=${true} onClose=${onClose} title="Шаблоны и импорт протоколов" width="560px"
      footer=${html`<${Button} variant="outline" onClick=${onClose}>Отмена<//><${Button} onClick=${doImport} disabled=${busy || !parsed}>${busy ? 'Импорт…' : 'Импортировать'}<//>`}>
      <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-tertiary)', marginBottom: '10px' }}>① Скачать шаблон Excel<//>
      <div style=${{ display: 'flex', gap: '8px', alignItems: 'end', marginBottom: '6px' }}>
        <${Select} value=${source} onChange=${(e) => setSource(e.target.value)} style=${{ flex: 1 }}>
          <optgroup label="Базовые типы">
            ${Object.keys(CHEM_TEMPLATE_TYPES).map((k) => html`<option key=${k} value=${k}>${CHEM_TEMPLATE_TYPES[k].icon} ${CHEM_TEMPLATE_TYPES[k].label} — ${CHEM_TEMPLATE_TYPES[k].desc}<//>`)}
          <//>
          ${labTemplates.length > 0 && html`
            <optgroup label="Шаблоны лабораторий">
              ${labTemplates.map((t) => html`<option key=${t.id} value=${'tpl:' + t.id}>🧪 ${t.lab_name} — ${t.template_name} (${(t.params || []).length})<//>`)}
            <//>
          `}
        <//>
        <${Button} variant="ghost" onClick=${() => downloadChemTemplateXlsx(source, labTemplates)}><${Download} size=${14} /> Скачать<//>
      </div>
      <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', marginBottom: '18px', lineHeight: 1.5 }}>Шаблон содержит строку заголовков с ключами параметров, строку с единицами и нормами ПДК, и строку-пример.<//>

      <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-tertiary)', marginBottom: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>② Загрузить заполненный файл<//>
      <div style=${{ background: 'var(--blue-100)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        • Колонка <b>Код водопункта</b> — код из реестра (ищется по коду, затем по названию)<br />
        • Дата в формате <b>ДД.ММ.ГГГГ</b> или <b>ГГГГ-ММ-ДД</b><br />
        • Значения: число, или со знаком <code>${'<'}</code> (ниже порога обнаружения)
      </div>
      <${Field} label="Файл (.xlsx или .csv)"><input type="file" accept=".csv,.xlsx,.xls" onChange=${(e) => handleFile(e.target.files[0] || null)} /><//>
      ${preview && html`
        <div style=${{ marginTop: '10px' }}>
          ${preview.knownCount > 0 && html`<div style=${{ fontSize: '11px', color: 'var(--green-600)', marginBottom: '6px' }}>✓ Распознано строк: <b>${preview.knownCount}<//><//>`}
          ${preview.unknown.length > 0 && html`
            <div style=${{ background: 'var(--amber-100)', borderRadius: '8px', padding: '10px 12px' }}>
              <div style=${{ fontSize: '11px', fontWeight: 700, color: 'var(--amber-600)', marginBottom: '6px' }}>⚠ Не найдены в реестре (${preview.unknown.length}) — строки будут пропущены:<//>
              <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                ${preview.unknown.map((u, i) => html`<span key=${i} style=${{ background: 'var(--amber-100)', border: '1px solid var(--border)', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>${u.name || u.code}<//>`)}
              </div>
            </div>
          `}
        </div>
      `}
      ${msg && html`<div style=${{ fontSize: '12px', color: 'var(--red-500)', marginTop: '10px' }}>${msg}<//>`}
    <//>
  `;
}

// ── Сравнение двух протоколов ─────────────────────────────────────────────
function CompareDialog({ open, onClose, protoA, protoB, resultsA, resultsB, wpNameA, wpNameB }) {
  if (!open || !protoA || !protoB) return null;
  const mapA = {}; (resultsA || []).forEach((r) => { mapA[r.param_key] = r; });
  const mapB = {}; (resultsB || []).forEach((r) => { mapB[r.param_key] = r; });
  const groupsPresent = Object.keys(CHEM_GROUPS).filter((g) => CHEM_PARAMS.some((p) => p.group === g && (mapA[p.key] || mapB[p.key])));

  function cellColor(st) { return st === 'exceed' ? 'var(--red-500)' : st === 'ok' ? 'var(--green-600)' : 'var(--text-tertiary)'; }

  return html`
    <${Dialog} open=${true} onClose=${onClose} title="Сравнение протоколов" width="720px" footer=${html`<${Button} variant="outline" onClick=${onClose}>Закрыть<//>`}>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Параметр</th>
            <th style=${{ textAlign: 'right' }}>${wpNameA}<br /><span style=${{ fontWeight: 400, fontSize: '10px', color: 'var(--text-tertiary)' }}>${fmtDate(protoA.sampled_at)}<//><//>
            <th style=${{ textAlign: 'right' }}>${wpNameB}<br /><span style=${{ fontWeight: 400, fontSize: '10px', color: 'var(--text-tertiary)' }}>${fmtDate(protoB.sampled_at)}<//><//>
            <th style=${{ textAlign: 'center' }}>Ед.<//>
          </tr></thead>
          <tbody>
            ${groupsPresent.map((g) => html`
              <tr key=${g + '-h'}><td colspan="4" style=${{ background: 'var(--bg-sunken)', fontWeight: 700, fontSize: '11px', color: 'var(--text-secondary)' }}>${CHEM_GROUPS[g].label}<//></tr>
              ${CHEM_PARAMS.filter((p) => p.group === g && (mapA[p.key] || mapB[p.key])).map((p) => {
                const v1 = mapA[p.key], v2 = mapB[p.key];
                const s1 = v1 ? pdkStatus(p.key, v1.value_raw, v1.below_detection) : 'nd';
                const s2 = v2 ? pdkStatus(p.key, v2.value_raw, v2.below_detection) : 'nd';
                return html`
                  <tr key=${p.key}>
                    <td style=${{ color: 'var(--text-tertiary)', fontSize: '11px' }}>${p.no}. ${p.name}<//>
                    <td class="mono" style=${{ textAlign: 'right', color: cellColor(s1) }}>${v1 ? v1.value_raw : '—'}<//>
                    <td class="mono" style=${{ textAlign: 'right', color: cellColor(s2) }}>${v2 ? v2.value_raw : '—'}<//>
                    <td style=${{ textAlign: 'center', fontSize: '10px', color: 'var(--text-tertiary)' }}>${p.unit}<//>
                  </tr>
                `;
              })}
            `)}
          </tbody>
        </table>
      </div>
    <//>
  `;
}

// ── Паспорт водопункта ────────────────────────────────────────────────────
function PassportDialog({ wp, protocols, resultsByProtocol, onClose }) {
  if (!wp) return null;
  const protos = protocols.filter((p) => p.water_point_id === wp.id).slice().sort((a, b) => (a.sampled_at < b.sampled_at ? 1 : -1));
  const paramStats = {};
  protos.forEach((p) => {
    (resultsByProtocol[p.id] || []).forEach((r) => {
      if (!paramStats[r.param_key]) paramStats[r.param_key] = { vals: [], lastDate: '', lastVal: '', lastBelow: false, exceedCount: 0 };
      const st = paramStats[r.param_key];
      if (r.value_num != null) st.vals.push(r.value_num);
      if (!st.lastDate || p.sampled_at > st.lastDate) { st.lastDate = p.sampled_at; st.lastVal = r.value_raw; st.lastBelow = r.below_detection; }
      if (pdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed') st.exceedCount++;
    });
  });
  const paramKeys = Object.keys(paramStats);

  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${'📋 Паспорт: ' + (wp.name || wp.code)} width="820px" footer=${html`<${Button} variant="outline" onClick=${onClose}>Закрыть<//>`}>
      <div style=${{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div><div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Код<//><div style=${{ fontSize: '13px', color: 'var(--gold-600)', fontWeight: 600 }}>${wp.code || '—'}<//><//>
        <div><div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Протоколов<//><div style=${{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>${protos.length}<//><//>
      </div>

      <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>История протоколов<//>
      ${!protos.length ? html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>Протоколов нет<//>` : html`
        <div class="table-wrap" style=${{ marginBottom: '18px' }}>
          <table class="data-table">
            <thead><tr><th>Дата</th><th>Лаборатория / №</th><th style=${{ textAlign: 'center' }}>Параметров</th><th style=${{ textAlign: 'center' }}>Превышений</th></tr></thead>
            <tbody>
              ${protos.map((p) => {
                const rows = resultsByProtocol[p.id] || [];
                const exc = rows.filter((r) => pdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed').length;
                return html`
                  <tr key=${p.id}>
                    <td style=${{ fontWeight: 600, color: 'var(--gold-600)' }}>${fmtDate(p.sampled_at)}<//>
                    <td>${(p.lab_name || '') + (p.lab_protocol_number ? ' №' + p.lab_protocol_number : '')}<//>
                    <td style=${{ textAlign: 'center' }}>${rows.length}<//>
                    <td style=${{ textAlign: 'center', color: exc > 0 ? 'var(--red-500)' : 'var(--green-600)', fontWeight: exc > 0 ? 700 : 400 }}>${exc > 0 ? '⚠ ' + exc : '✓'}<//>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}

      <div style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Сводка по параметрам<//>
      ${!paramKeys.length ? html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Нет данных<//>` : html`
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Параметр</th><th style=${{ textAlign: 'right' }}>Последнее</th><th style=${{ textAlign: 'right' }}>Мин<//><th style=${{ textAlign: 'right' }}>Макс<//><th style=${{ textAlign: 'center' }}>Превыш.<//></tr></thead>
            <tbody>
              ${paramKeys.map((key) => {
                const p = CHEM_PARAM_MAP[key];
                if (!p) return null;
                const st = paramStats[key];
                const lastStatus = pdkStatus(key, st.lastVal, st.lastBelow);
                const minV = st.vals.length ? Math.min(...st.vals) : null;
                const maxV = st.vals.length ? Math.max(...st.vals) : null;
                return html`
                  <tr key=${key}>
                    <td>${p.no}. ${p.name} <span style=${{ color: 'var(--text-tertiary)', fontSize: '10px' }}>${p.unit}<//><//>
                    <td class="mono" style=${{ textAlign: 'right', fontWeight: 600, color: lastStatus === 'exceed' ? 'var(--red-500)' : lastStatus === 'ok' ? 'var(--green-600)' : 'var(--text-secondary)' }}>${st.lastVal || '—'}<//>
                    <td class="mono" style=${{ textAlign: 'right', color: 'var(--text-secondary)' }}>${minV != null ? minV.toFixed(2) : '—'}<//>
                    <td class="mono" style=${{ textAlign: 'right', color: 'var(--text-secondary)' }}>${maxV != null ? maxV.toFixed(2) : '—'}<//>
                    <td style=${{ textAlign: 'center', color: st.exceedCount > 0 ? 'var(--red-500)' : 'var(--green-600)', fontWeight: st.exceedCount > 0 ? 700 : 400 }}>${st.exceedCount > 0 ? st.exceedCount : '✓'}<//>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    <//>
  `;
}

// ── Страница ──────────────────────────────────────────────────────────────
export function ChemPage() {
  const [protocols, setProtocols] = useState(null);
  const [resultsByProtocol, setResultsByProtocol] = useState({});
  const [wpOptions, setWpOptions] = useState([]);
  const [labTemplates, setLabTemplates] = useState([]);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);

  const [filterWpId, setFilterWpId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterQuarter, setFilterQuarter] = useState('');
  const [filterExceedOnly, setFilterExceedOnly] = useState(false);

  const [detailId, setDetailId] = useState(null);
  const [formState, setFormState] = useState(null); // null | {mode:'new'} | {mode:'edit',proto,results} | {mode:'duplicate',proto}
  const [wizardOpen, setWizardOpen] = useState(false);
  const [tab, setTab] = useState('protocols'); // 'protocols' | 'trends' | 'heatmap'
  const [compareIds, setCompareIds] = useState([]);
  const [passportWpId, setPassportWpId] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function fetchWpOptions() {
    let r = await supabase.from('wp_registry').select('id, name, code, default_template_id').order('name');
    if (r.error && /default_template_id/i.test(r.error.message || '')) {
      r = await supabase.from('wp_registry').select('id, name, code').order('name');
    }
    return r;
  }

  async function load() {
    setError(null);
    const [protoR, resR, wpR, tplR] = await Promise.all([
      supabase.from('chem_protocols').select('*').order('sampled_at', { ascending: false }).limit(500),
      fetchAllRows('chem_results', '*'), // сервер молча обрезает ответ до 1000 строк (db-max-rows) — нужна постраничная выборка
      fetchWpOptions(),
      supabase.from('chem_lab_templates').select('*').order('lab_name').order('template_name'),
    ]);
    if (protoR.error) { setError(protoR.error.message); return; }
    setProtocols(protoR.data || []);
    const byProto = {};
    (resR.data || []).forEach((r) => { if (!byProto[r.protocol_id]) byProto[r.protocol_id] = []; byProto[r.protocol_id].push(r); });
    setResultsByProtocol(byProto);
    setWpOptions(wpR.data || []);
    setLabTemplates((!tplR.error && tplR.data) ? tplR.data : []);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 7000);
    return () => clearTimeout(t);
  }, [banner]);

  const wpNames = useMemo(() => { const m = {}; wpOptions.forEach((w) => { m[w.id] = w.name || w.code; }); return m; }, [wpOptions]);

  const allRows = useMemo(() => {
    if (!protocols) return [];
    return protocols.map((p) => {
      const results = resultsByProtocol[p.id] || [];
      const exceedCount = results.filter((r) => pdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed').length;
      return { ...p, wpName: wpNames[p.water_point_id] || '—', resultsCount: results.length, exceedCount };
    });
  }, [protocols, resultsByProtocol, wpNames]);

  const years = useMemo(() => {
    const set = new Set();
    (protocols || []).forEach((p) => { if (p.sampled_at) set.add(p.sampled_at.slice(0, 4)); });
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [protocols]);

  const filteredRows = useMemo(() => allRows.filter((p) => {
    if (filterWpId && p.water_point_id !== filterWpId) return false;
    if (filterType && (p.protocol_type || 'sha') !== filterType) return false;
    if (filterYear && (!p.sampled_at || p.sampled_at.slice(0, 4) !== filterYear)) return false;
    if (filterQuarter && String(p.quarter || quarterFromDate(p.sampled_at)) !== filterQuarter) return false;
    if (filterExceedOnly && p.exceedCount === 0) return false;
    return true;
  }), [allRows, filterWpId, filterType, filterYear, filterQuarter, filterExceedOnly]);

  const totalExceed = useMemo(() => allRows.reduce((s, p) => s + p.exceedCount, 0), [allRows]);
  const wpCovered = useMemo(() => new Set(allRows.map((p) => p.water_point_id)).size, [allRows]);

  function handleFormSaved(savedProto, resultRows, exceededNames) {
    setProtocols((prev) => {
      const exists = (prev || []).some((p) => p.id === savedProto.id);
      return exists ? prev.map((p) => p.id === savedProto.id ? savedProto : p) : [savedProto, ...(prev || [])];
    });
    setResultsByProtocol((prev) => ({ ...prev, [savedProto.id]: resultRows }));
    setFormState(null);
    setDetailId(null);
    setBanner(exceededNames.length
      ? { type: 'warning', text: `Протокол сохранён. Превышение ПДК (${exceededNames.length}): ${exceededNames.join(', ')}` }
      : { type: 'success', text: 'Протокол сохранён' });
  }

  function handleDelete(id) { setDeleteId(id); }

  async function confirmDelete() {
    const id = deleteId;
    setDeleteBusy(true);
    await supabase.from('chem_results').delete().eq('protocol_id', id);
    const res = await supabase.from('chem_protocols').delete().eq('id', id);
    setDeleteBusy(false);
    if (res.error) { setBanner({ type: 'warning', text: 'Ошибка удаления: ' + res.error.message }); return; }
    setProtocols((prev) => prev.filter((p) => p.id !== id));
    setResultsByProtocol((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (detailId === id) setDetailId(null);
    setDeleteId(null);
    setBanner({ type: 'success', text: 'Протокол удалён' });
  }

  function toggleCompare(id, checked) {
    setCompareIds((prev) => {
      if (checked) { if (prev.includes(id)) return prev; const next = prev.length >= 2 ? prev.slice(1) : prev.slice(); return [...next, id]; }
      return prev.filter((x) => x !== id);
    });
  }

  function handleImported(result) {
    load();
    setImportOpen(false);
    const parts = [`Импортировано ${result.imported} протоколов`];
    if (result.skipped) parts.push(`пропущено ${result.skipped} (нет в реестре)`);
    if (result.errors) parts.push(`ошибок: ${result.errors}`);
    setBanner({ type: result.errors ? 'warning' : 'success', text: parts.join(', ') });
  }

  const detailProto = detailId ? allRows.find((p) => p.id === detailId) : null;
  const passportWp = passportWpId ? wpOptions.find((w) => w.id === passportWpId) : null;
  const compareProtoA = compareIds[0] ? allRows.find((p) => p.id === compareIds[0]) : null;
  const compareProtoB = compareIds[1] ? allRows.find((p) => p.id === compareIds[1]) : null;

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Хим. мониторинг</div>
          <div class="page-desc">Протоколы химического анализа воды — ${protocols ? protocols.length : '…'} записей. ПДК — по СанПиН (питьевая вода).</div>
        </div>
        <div style=${{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <${Button} variant="outline" onClick=${() => setReportOpen(true)}><${Scale} size=${15} /> Отчёт по превышениям<//>
          <${Button} variant="outline" onClick=${() => setImportOpen(true)}><${Upload} size=${15} /> Импорт Excel<//>
          <${Button} variant="outline" onClick=${() => setWizardOpen(true)}><${Settings2} size=${15} /> Шаблоны лабораторий<//>
          <${Button} onClick=${() => setFormState({ mode: 'new' })}><${Plus} size=${16} /> Новый протокол<//>
        </div>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${error}</div>`}
      ${banner && html`
        <div style=${{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: '12px', fontSize: '13px',
          background: banner.type === 'warning' ? 'var(--amber-100)' : 'var(--green-100)',
          color: banner.type === 'warning' ? 'var(--amber-600)' : 'var(--green-600)',
        }}>
          ${banner.type === 'warning' && html`<${AlertTriangle} size=${14} />`}
          ${banner.text}
        </div>
      `}

      <div style=${{ marginBottom: '16px' }}>
        <${Tabs} tabs=${[{ value: 'protocols', label: 'Протоколы' }, { value: 'trends', label: 'Тренды' }, { value: 'heatmap', label: 'Тепловая карта' }]} value=${tab} onChange=${setTab} />
      </div>

      ${tab === 'trends' && html`<${TrendsPanel} wpOptions=${wpOptions} protocols=${protocols || []} resultsByProtocol=${resultsByProtocol} />`}
      ${tab === 'heatmap' && html`<${HeatmapPanel} wpOptions=${wpOptions} protocols=${protocols || []} resultsByProtocol=${resultsByProtocol} />`}

      ${tab === 'protocols' && html`
      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '14px' }}>
        <${Card}><${CardContent}>
          <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' }}>Протоколов<//>
          <div style=${{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>${protocols ? protocols.length : '…'}<//>
        <//><//>
        <${Card}><${CardContent}>
          <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' }}>Водопунктов охвачено<//>
          <div style=${{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>${wpCovered}<//>
        <//><//>
        <${Card}><${CardContent}>
          <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' }}>Превышений ПДК<//>
          <div style=${{ fontSize: '22px', fontWeight: 700, color: totalExceed > 0 ? 'var(--red-500)' : 'var(--text-primary)' }}>${totalExceed}<//>
        <//><//>
      </div>

      <${Card}>
        <${CardContent} tight>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
            <${Select} value=${filterWpId} onChange=${(e) => setFilterWpId(e.target.value)} style=${{ fontSize: '12px' }}>
              <option value="">Все водопункты</option>
              ${wpOptions.map((w) => html`<option key=${w.id} value=${w.id}>${w.name || w.code}<//>`)}
            <//>
            <${Select} value=${filterType} onChange=${(e) => setFilterType(e.target.value)} style=${{ fontSize: '12px' }}>
              <option value="">Все виды</option>
              ${Object.keys(CHEM_PROTO_TYPE_META).map((k) => html`<option key=${k} value=${k}>${CHEM_PROTO_TYPE_META[k].icon} ${CHEM_PROTO_TYPE_META[k].label}<//>`)}
            <//>
            <${Select} value=${filterYear} onChange=${(e) => setFilterYear(e.target.value)} style=${{ fontSize: '12px' }}>
              <option value="">Все годы</option>
              ${years.map((y) => html`<option key=${y} value=${y}>${y}<//>`)}
            <//>
            <${Select} value=${filterQuarter} onChange=${(e) => setFilterQuarter(e.target.value)} style=${{ fontSize: '12px' }}>
              <option value="">Все кварталы</option>
              ${[1, 2, 3, 4].map((q) => html`<option key=${q} value=${q}>${romanQuarter(q)} кв.<//>`)}
            <//>
            <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked=${filterExceedOnly} onChange=${(e) => setFilterExceedOnly(e.target.checked)} /> Только превышения ПДК
            </label>
            ${compareIds.length > 0 && html`
              <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
                <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Выбрано: ${compareIds.length}/2<//>
                <${Button} variant="outline" size="sm" disabled=${compareIds.length < 2} onClick=${() => setCompareOpen(true)}>≈ Сравнить<//>
                <${Button} variant="ghost" size="sm" icon onClick=${() => setCompareIds([])}>✕<//>
              </div>
            `}
            <span style=${{ marginLeft: compareIds.length > 0 ? '0' : 'auto', fontSize: '11px', color: 'var(--text-tertiary)' }}>Показано: ${filteredRows.length}<//>
          </div>

          <div style=${{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
            ${protocols === null ? [0, 1, 2].map((i) => html`<${Skeleton} key=${i} height="52px" />`) : null}
            ${protocols !== null && !filteredRows.length && html`<${EmptyState} icon=${html`<${FlaskConical} size=${40} />`} title="Протоколов нет" description="Добавьте первый протокол через кнопку «Новый протокол»" />`}
            ${filteredRows.map((p) => html`
              <${ProtocolCard} key=${p.id} p=${p} wpName=${p.wpName} resultsCount=${p.resultsCount} exceedCount=${p.exceedCount}
                compareChecked=${compareIds.includes(p.id)} onToggleCompare=${(checked) => toggleCompare(p.id, checked)}
                onPassport=${() => setPassportWpId(p.water_point_id)}
                onExportCsv=${() => exportProtocolCsv(p, p.wpName, resultsByProtocol[p.id] || [])}
                onOpen=${() => setDetailId(p.id)}
                onEdit=${() => setFormState({ mode: 'edit', proto: p, results: resultsByProtocol[p.id] || [] })}
                onDuplicate=${() => setFormState({ mode: 'duplicate', proto: p })}
                onDelete=${() => handleDelete(p.id)}
              />
            `)}
          </div>
        <//>
      <//>
      `}

      ${detailProto && html`
        <${ProtocolDetailDialog} proto=${detailProto} wpName=${detailProto.wpName} results=${resultsByProtocol[detailProto.id] || []}
          allProtocols=${protocols || []} resultsByProtocol=${resultsByProtocol}
          onClose=${() => setDetailId(null)}
          onEdit=${() => setFormState({ mode: 'edit', proto: detailProto, results: resultsByProtocol[detailProto.id] || [] })}
          onDuplicate=${() => setFormState({ mode: 'duplicate', proto: detailProto })}
          onDelete=${() => handleDelete(detailProto.id)}
        />
      `}

      <${ProtocolFormDialog} open=${!!formState} editing=${formState} wpOptions=${wpOptions} labTemplates=${labTemplates}
        protocols=${protocols || []} resultsByProtocol=${resultsByProtocol} setResultsByProtocol=${setResultsByProtocol}
        onClose=${() => setFormState(null)} onSaved=${handleFormSaved} />

      <${LabTemplateWizardDialog} open=${wizardOpen} onClose=${() => setWizardOpen(false)} labTemplates=${labTemplates} setLabTemplates=${setLabTemplates} />

      <${ExceedanceReportDialog} open=${reportOpen} onClose=${() => setReportOpen(false)} protocols=${protocols || []} resultsByProtocol=${resultsByProtocol} wpNames=${wpNames} />
      <${ExcelImportDialog} open=${importOpen} onClose=${() => setImportOpen(false)} labTemplates=${labTemplates} wpOptions=${wpOptions} onImported=${handleImported} />
      ${compareOpen && html`
        <${CompareDialog} open=${true} onClose=${() => setCompareOpen(false)}
          protoA=${compareProtoA} protoB=${compareProtoB}
          resultsA=${compareProtoA ? (resultsByProtocol[compareProtoA.id] || []) : []} resultsB=${compareProtoB ? (resultsByProtocol[compareProtoB.id] || []) : []}
          wpNameA=${compareProtoA ? compareProtoA.wpName : ''} wpNameB=${compareProtoB ? compareProtoB.wpName : ''}
        />
      `}
      ${passportWp && html`<${PassportDialog} wp=${passportWp} protocols=${protocols || []} resultsByProtocol=${resultsByProtocol} onClose=${() => setPassportWpId('')} />`}
      <${ConfirmDialog} open=${!!deleteId} title="Удалить протокол?" message="Протокол и все его результаты анализа будут удалены без возможности восстановления."
        confirmLabel="Удалить" danger busy=${deleteBusy}
        onCancel=${() => setDeleteId(null)}
        onConfirm=${confirmDelete}
      />
    </div>
  `;
}
