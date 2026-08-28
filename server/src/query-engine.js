// Мини-аналог PostgREST поверх MS SQL Server: универсальный CRUD для
// web-next/lib/supabase.js (shim-клиент). Понимает тот же query-синтаксис,
// что PostgREST (col=op.value, order=col.asc,col2.desc, select=col1,col2),
// чтобы shim-клиент оставался максимально похож на настоящий Supabase JS SDK.
//
// Все идентификаторы (таблицы/колонки) валидируются по IDENT_RE и никогда
// не интерполируются из непроверенных значений в SQL-текст напрямую значения
// — только через параметризованные запросы (request.input).
const { sql, getPool } = require('./db.js');

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(name, what) {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) {
    const err = new Error(`Недопустимое имя ${what || 'идентификатора'}: ${JSON.stringify(name)}`);
    err.status = 400;
    throw err;
  }
  return name;
}

function qi(name) { return `[${name}]`; } // quoted identifier

const OP_MAP = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

// Кэш PK-колонок по таблице — схема не меняется во время работы процесса.
const pkCache = new Map();
async function getPrimaryKeyColumns(table) {
  if (pkCache.has(table)) return pkCache.get(table);
  const pool = await getPool();
  const res = await pool.request().input('table', sql.NVarChar, table).query(`
    SELECT c.COLUMN_NAME
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE c
      ON tc.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND tc.TABLE_NAME = c.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_NAME = @table
    ORDER BY c.ORDINAL_POSITION
  `);
  const cols = res.recordset.map((r) => r.COLUMN_NAME);
  pkCache.set(table, cols);
  return cols;
}

// query — req.query (Express). Возвращает [{column, op, value}], игнорируя
// зарезервированные параметры (select/order/limit/range/offset).
const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'range', 'offset']);
function parseFilters(query) {
  const filters = [];
  for (const [key, raw] of Object.entries(query || {})) {
    if (RESERVED_PARAMS.has(key)) continue;
    const val = Array.isArray(raw) ? raw[0] : raw;
    const dot = String(val).indexOf('.');
    if (dot === -1) continue; // не PostgREST-формат — пропускаем
    const op = val.slice(0, dot);
    const value = val.slice(dot + 1);
    if (op === 'in') {
      filters.push({ column: assertIdent(key, 'колонки'), op: 'in', value: value.replace(/^\(|\)$/g, '').split(',').filter(Boolean) });
    } else if (op === 'is') {
      filters.push({ column: assertIdent(key, 'колонки'), op: 'is', value }); // ожидается 'null' | 'not.null'
    } else if (OP_MAP[op]) {
      filters.push({ column: assertIdent(key, 'колонки'), op, value });
    }
  }
  return filters;
}

function applyFilters(request, filters, whereParts) {
  filters.forEach((f, i) => {
    const col = qi(f.column);
    if (f.op === 'is') {
      const isNot = f.value.startsWith('not.');
      whereParts.push(`${col} IS ${isNot ? 'NOT ' : ''}NULL`);
      return;
    }
    if (f.op === 'in') {
      const names = f.value.map((v, j) => {
        const p = `f${i}_${j}`;
        request.input(p, v);
        return `@${p}`;
      });
      whereParts.push(`${col} IN (${names.join(',') || 'NULL'})`);
      return;
    }
    const p = `f${i}`;
    request.input(p, f.value);
    whereParts.push(`${col} ${OP_MAP[f.op]} @${p}`);
  });
}

function parseOrder(orderParam) {
  if (!orderParam) return [];
  return String(orderParam).split(',').map((part) => {
    const [col, dir] = part.split('.');
    return { column: assertIdent(col, 'колонки сортировки'), desc: dir === 'desc' };
  });
}

function parseSelect(selectParam) {
  if (!selectParam || selectParam === '*') return '*';
  return selectParam.split(',').map((c) => assertIdent(c.trim(), 'колонки select')).map(qi).join(', ');
}

async function selectRows({ table, select, filters, order, limit, range }) {
  assertIdent(table, 'таблицы');
  const pool = await getPool();
  const request = pool.request();
  const whereParts = [];
  applyFilters(request, filters, whereParts);
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderCols = parseOrder(order);
  let orderBy = orderCols.length
    ? `ORDER BY ${orderCols.map((o) => `${qi(o.column)} ${o.desc ? 'DESC' : 'ASC'}`).join(', ')}`
    : '';

  let top = '';
  let offsetFetch = '';
  if (range) {
    // Range: "from-to" (включительно), как заголовок Range у PostgREST.
    const [from, to] = range.split('-').map(Number);
    if (!orderBy) orderBy = `ORDER BY (SELECT NULL)`; // OFFSET/FETCH требует ORDER BY
    offsetFetch = `OFFSET ${from} ROWS FETCH NEXT ${Math.max(0, to - from + 1)} ROWS ONLY`;
  } else if (limit) {
    top = `TOP (${parseInt(limit, 10)})`;
  }

  const cols = parseSelect(select);
  const query = `SELECT ${top} ${cols} FROM ${qi(table)} ${where} ${orderBy} ${offsetFetch}`;
  const res = await request.query(query);
  return res.recordset;
}

async function insertRows({ table, rows, select }) {
  assertIdent(table, 'таблицы');
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return [];
  const pool = await getPool();
  const out = [];
  // Построчно (простые транзакции, объём для внутреннего инструмента небольшой) —
  // проще и надёжнее, чем собирать один многострочный INSERT с разным набором колонок.
  for (const row of list) {
    const cols = Object.keys(row).map((c) => assertIdent(c, 'колонки'));
    const request = pool.request();
    cols.forEach((c, i) => request.input(`v${i}`, row[c]));
    const outputClause = select ? 'OUTPUT INSERTED.*' : '';
    const query = `INSERT INTO ${qi(table)} (${cols.map(qi).join(',')}) ${outputClause} VALUES (${cols.map((_, i) => `@v${i}`).join(',')})`;
    const res = await request.query(query);
    if (select) out.push(res.recordset[0]);
  }
  return out;
}

async function updateRows({ table, patch, filters, select }) {
  assertIdent(table, 'таблицы');
  const pool = await getPool();
  const request = pool.request();
  const setCols = Object.keys(patch).map((c) => assertIdent(c, 'колонки'));
  setCols.forEach((c, i) => request.input(`s${i}`, patch[c]));
  const whereParts = [];
  applyFilters(request, filters, whereParts);
  if (!whereParts.length) {
    const err = new Error('UPDATE без фильтра запрещён (защита от массового изменения всей таблицы)');
    err.status = 400;
    throw err;
  }
  const outputClause = select ? 'OUTPUT INSERTED.*' : '';
  const query = `UPDATE ${qi(table)} SET ${setCols.map((c, i) => `${qi(c)}=@s${i}`).join(',')} ${outputClause} WHERE ${whereParts.join(' AND ')}`;
  const res = await request.query(query);
  return select ? res.recordset : [];
}

async function deleteRows({ table, filters }) {
  assertIdent(table, 'таблицы');
  const pool = await getPool();
  const request = pool.request();
  const whereParts = [];
  applyFilters(request, filters, whereParts);
  if (!whereParts.length) {
    const err = new Error('DELETE без фильтра запрещён (защита от очистки всей таблицы)');
    err.status = 400;
    throw err;
  }
  const query = `DELETE FROM ${qi(table)} WHERE ${whereParts.join(' AND ')}`;
  await request.query(query);
  return [];
}

// Upsert = UPDATE по ключу конфликта, если 0 строк затронуто — INSERT.
// Простой (не MERGE) подход — читаемее и достаточно надёжен при небольшой
// конкурентности внутреннего инструмента (см. mssql/schema_hydro_monitoring.sql).
async function upsertRows({ table, rows, onConflict, select }) {
  assertIdent(table, 'таблицы');
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return [];
  const conflictCols = onConflict ? onConflict.split(',').map((c) => assertIdent(c.trim(), 'onConflict')) : await getPrimaryKeyColumns(table);
  if (!conflictCols.length) {
    const err = new Error(`Не удалось определить ключ конфликта для upsert в таблицу ${table} (нет PK и не передан onConflict)`);
    err.status = 400;
    throw err;
  }
  const pool = await getPool();
  const out = [];
  for (const row of list) {
    const keyVals = conflictCols.map((c) => row[c]);
    if (keyVals.some((v) => v === undefined || v === null)) {
      // Нет значения ключа конфликта — это чистый insert (например id генерируется в БД).
      const inserted = await insertRows({ table, rows: [row], select });
      if (select) out.push(inserted[0]);
      continue;
    }
    const otherCols = Object.keys(row).filter((c) => !conflictCols.includes(c)).map((c) => assertIdent(c, 'колонки'));
    const updReq = pool.request();
    otherCols.forEach((c, i) => updReq.input(`s${i}`, row[c]));
    conflictCols.forEach((c, i) => updReq.input(`k${i}`, row[c]));
    const where = conflictCols.map((c, i) => `${qi(c)}=@k${i}`).join(' AND ');
    const setClause = otherCols.length ? otherCols.map((c, i) => `${qi(c)}=@s${i}`).join(',') : `${qi(conflictCols[0])}=${qi(conflictCols[0])}`;
    const outputClause = select ? 'OUTPUT INSERTED.*' : '';
    const updRes = await updReq.query(`UPDATE ${qi(table)} SET ${setClause} ${outputClause} WHERE ${where}`);
    if (updRes.rowsAffected[0] > 0) {
      if (select) out.push(updRes.recordset[0]);
    } else {
      const inserted = await insertRows({ table, rows: [row], select });
      if (select) out.push(inserted[0]);
    }
  }
  return out;
}

module.exports = { parseFilters, selectRows, insertRows, updateRows, deleteRows, upsertRows, assertIdent };
