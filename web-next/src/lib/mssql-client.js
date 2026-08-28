// Shim-клиент, повторяющий используемое в проекте подмножество API Supabase
// JS SDK (from/select/eq/.../storage), но обращающийся к собственному
// Node/Express-backend (server/) поверх MS SQL вместо облачного Supabase.
//
// ⚠ ПОКА НЕ ПОДКЛЮЧЁН. Это файл-заготовка для миграции на локальную
// инфраструктуру (IIS + RAYWEBV04) — часть плана из "server/README.md".
// web-next/src/lib/supabase.js по-прежнему указывает на реальный Supabase
// и обслуживает текущее рабочее приложение. Переключение произойдёт одним
// шагом (переименование этого файла в supabase.js), когда:
//   1) server/ задеплоен и отвечает на РЕАЛЬНОМ IIS/RAYWEBV04,
//   2) данные перенесены (задача "Перенести боевые данные и фото"),
//   3) web-next/src/lib/auth.js переведён на /api/whoami (задача #116).
// До этого момента overwrite supabase.js оборвёт работающее приложение —
// не делать этого вне отдельного согласованного шага переключения.
//
// Цель — чтобы ни одна из ~15 страниц web-next не заметила разницы: везде,
// где `import { supabase } from '../lib/supabase.js'`, продолжает работать
// `supabase.from(table).select(...).eq(...)` и т.д. без изменений в самих
// страницах — меняется только этот файл.
//
// Backend понимает синтаксис фильтров PostgREST (col=op.value) — см.
// server/src/query-engine.js. auth.* сюда намеренно не входит: после
// перехода на Windows-аутентификацию (IIS + AD-группа) отдельного входа
// в приложение нет, web-next/src/lib/auth.js обращается к /api/whoami напрямую.

const API_BASE = './api'; // относительный путь — backend и статика web-next на одном IIS-сайте

function qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

async function request(method, path, { query, body } = {}) {
  const url = API_BASE + path + (query ? qs(query) : '');
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    return { data: null, error: { message: 'Нет связи с сервером: ' + netErr.message } };
  }
  let json = null;
  try { json = await res.json(); } catch { /* пустой ответ (204 и т.п.) */ }
  if (!res.ok) {
    return { data: null, error: { message: (json && json.error) || `Ошибка сервера (${res.status})` } };
  }
  return { data: json, error: null };
}

class QueryBuilder {
  constructor(table) {
    this._table = table;
    this._method = 'select';
    this._selectCols = null;
    this._filters = [];
    this._orderParts = [];
    this._limit = null;
    this._range = null;
    this._body = null;
    this._onConflict = null;
    this._single = false;
    this._maybeSingle = false;
  }

  select(cols) { this._selectCols = cols || '*'; return this; }
  eq(col, val) { this._filters.push([col, `eq.${val}`]); return this; }
  neq(col, val) { this._filters.push([col, `neq.${val}`]); return this; }
  gt(col, val) { this._filters.push([col, `gt.${val}`]); return this; }
  gte(col, val) { this._filters.push([col, `gte.${val}`]); return this; }
  lt(col, val) { this._filters.push([col, `lt.${val}`]); return this; }
  lte(col, val) { this._filters.push([col, `lte.${val}`]); return this; }
  is(col, val) { this._filters.push([col, `is.${val === null ? 'null' : 'not.null'}`]); return this; }
  in(col, vals) { this._filters.push([col, `in.(${vals.join(',')})`]); return this; }
  order(col, opts) { this._orderParts.push(`${col}.${opts && opts.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n) { this._limit = n; return this; }
  range(from, to) { this._range = `${from}-${to}`; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }

  insert(rows) { this._method = 'insert'; this._body = rows; return this; }
  update(patch) { this._method = 'update'; this._body = patch; return this; }
  upsert(rows, opts) { this._method = 'upsert'; this._body = rows; this._onConflict = opts && opts.onConflict; return this; }
  delete() { this._method = 'delete'; return this; }

  async _exec() {
    const query = { select: this._selectCols, order: this._orderParts.join(',') || undefined, limit: this._limit, range: this._range };
    this._filters.forEach(([col, val]) => { query[col] = val; });

    if (this._method === 'select') {
      return request('GET', `/${this._table}`, { query });
    }
    if (this._method === 'delete') {
      return request('DELETE', `/${this._table}`, { query });
    }
    if (this._method === 'update') {
      return request('PATCH', `/${this._table}`, { query, body: { patch: this._body, select: this._selectCols } });
    }
    // insert / upsert
    return request('POST', `/${this._table}`, {
      body: { rows: this._body, upsert: this._method === 'upsert', onConflict: this._onConflict, select: this._selectCols },
    });
  }

  then(onFulfilled, onRejected) {
    return this._exec().then((result) => {
      if (result.error) return onFulfilled ? onFulfilled(result) : result;
      let data = result.data;
      if (this._single || this._maybeSingle) {
        if (Array.isArray(data)) {
          if (data.length === 0) {
            if (this._single) {
              result = { data: null, error: { message: 'Строка не найдена (single(): 0 строк)' } };
            } else {
              result = { data: null, error: null };
            }
          } else if (data.length > 1) {
            result = { data: null, error: { message: `Ожидалась одна строка, получено ${data.length}` } };
          } else {
            result = { data: data[0], error: null };
          }
        }
      }
      return onFulfilled ? onFulfilled(result) : result;
    }, onRejected);
  }
}

const storageApi = {
  from(bucket) {
    return {
      async upload(path, fileOrBlob, opts = {}) {
        const form = new FormData();
        form.append('file', fileOrBlob, path.split('/').pop());
        form.append('path', path);
        let res;
        try {
          res = await fetch(`${API_BASE}/storage/${encodeURIComponent(bucket)}`, { method: 'POST', body: form });
        } catch (netErr) {
          return { data: null, error: { message: 'Нет связи с сервером: ' + netErr.message } };
        }
        const json = await res.json().catch(() => null);
        if (!res.ok) return { data: null, error: { message: (json && json.error) || `Ошибка загрузки (${res.status})` } };
        return { data: { path: json.path }, error: null };
      },
      remove(paths) {
        return Promise.all((paths || []).map((p) => request('DELETE', `/storage/${encodeURIComponent(bucket)}`, { body: { path: p } })));
      },
      getPublicUrl(path) {
        const base = (window.FILES_PUBLIC_BASE_URL || './static/files').replace(/\/$/, '');
        return { data: { publicUrl: `${base}/${bucket}/${path}` } };
      },
    };
  },
};

export const supabase = {
  from(table) { return new QueryBuilder(table); },
  storage: storageApi,
};
